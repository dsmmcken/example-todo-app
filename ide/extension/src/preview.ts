import * as vscode from "vscode";
import type { Message } from "esbuild-wasm";
import { BundleError, Bundler } from "./bundler";
import { WorkspaceFileSystem } from "./fileSystem";
import { normalize } from "./paths";

/** Source of `client/bridge.ts`, inlined by `ide/build.mjs`. */
declare const __BRIDGE_SOURCE__: string;

export const PREVIEW_VIEW_TYPE = "todoIde.preview";

const FALLBACK_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /></head>
  <body><div id="root"></div><script type="module" src="/src/index.tsx"></script></body>
</html>`;

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'unsafe-inline' https:",
  "font-src https: data:",
  "img-src https: data: blob:",
  "media-src https: data: blob:",
  "connect-src https:",
].join("; ");

const MODULE_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>\s*<\/script>/gi;

/** Finds the app entry point from `index.html`, the way Vite does. */
function findEntry(html: string): { entry: string; tag: string } | undefined {
  for (const tag of html.match(MODULE_SCRIPT) ?? []) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src && !/^[a-z]+:/i.test(src)) return { entry: normalize(src), tag };
  }
  return undefined;
}

const escapeScript = (code: string) => code.replace(/<\/(script)/gi, "<\\/$1");
const escapeStyle = (code: string) => code.replace(/<\/(style)/gi, "<\\/$1");

function insertHead(html: string, content: string): string {
  const match = /<head\b[^>]*>/i.exec(html);
  if (!match) return content + html;
  const index = match.index + match[0].length;
  return html.slice(0, index) + content + html.slice(index);
}

function insertBefore(html: string, closingTag: RegExp, content: string): string {
  const match = closingTag.exec(html);
  if (!match) return html + content;
  return html.slice(0, match.index) + content + html.slice(match.index);
}

export class PreviewController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private hasApp = false;
  private building: Promise<void> | undefined;
  private rebuildRequested = false;
  private buildCount = 0;
  private disposed = false;

  private readonly output = vscode.window.createOutputChannel("Preview Console", { log: true });
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("esbuild");
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly disposables: vscode.Disposable[] = [this.output, this.diagnostics, this.status];

  constructor(
    private readonly fs: WorkspaceFileSystem,
    private readonly bundler: Bundler,
  ) {
    this.status.command = "todoIde.showPreview";
    this.status.name = "Preview";
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }

  showConsole(): void {
    this.output.show(true);
  }

  /** Shows the preview, resolving once it has been built. */
  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      PREVIEW_VIEW_TYPE,
      "Preview",
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      { enableScripts: true, enableForms: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.hasApp = false;
      // The close button is hidden, but it can still be closed with the keyboard or a menu
      if (!this.disposed) setTimeout(() => void this.show(), 0);
    });
    this.panel.webview.onDidReceiveMessage((message) => this.onMessage(message));
    await this.rebuild();
  }

  /** Rebuilds the app and reloads the preview. Coalesces requests made while a build is running. */
  async rebuild(): Promise<void> {
    if (this.building) {
      this.rebuildRequested = true;
      return this.building;
    }
    this.building = (async () => {
      try {
        do {
          this.rebuildRequested = false;
          await this.build();
        } while (this.rebuildRequested);
      } finally {
        this.building = undefined;
      }
    })();
    return this.building;
  }

  private async build(): Promise<void> {
    if (!this.panel) return;
    this.status.text = "$(sync~spin) Building…";
    this.status.tooltip = "Bundling the app";
    this.status.backgroundColor = undefined;
    this.status.show();

    const indexHtml = this.fs.readTextSync("index.html") ?? FALLBACK_INDEX_HTML;
    const found = findEntry(indexHtml);
    const entry = found?.entry ?? "src/index.tsx";
    const pageHtml = found ? indexHtml.replace(found.tag, "") : indexHtml;
    const started = performance.now();

    try {
      const result = await this.bundler.bundle(entry);
      this.setDiagnostics([], result.warnings);
      if (!this.panel) return;

      this.output.clear();
      this.output.info(`Preview reloaded (built in ${Math.round(performance.now() - started)} ms)`);
      for (const warning of await this.bundler.formatMessages(result.warnings, "warning")) {
        this.output.warn(warning.trimEnd());
      }
      this.panel.webview.html = this.composeHtml(pageHtml, result);
      this.hasApp = true;
      this.status.text = "$(check) Preview";
      this.status.tooltip = "The preview is up to date. Click to show it.";
    } catch (e) {
      const errors: Message[] = e instanceof BundleError ? e.errors : [{ text: String(e) } as Message];
      const warnings = e instanceof BundleError ? e.warnings : [];
      this.setDiagnostics(errors, warnings);
      const text = (await this.bundler.formatMessages(errors, "error")).join("\n").trimEnd();
      for (const line of text.split(/\n(?=✘)/)) this.output.error(line);
      if (!this.panel) return;

      if (this.hasApp) {
        // Keep the running app, like Vite, and show the error on top of it
        void this.panel.webview.postMessage({ type: "build-error", text });
      } else {
        this.panel.webview.html = this.composeHtml(pageHtml, { buildError: text });
      }
      this.status.text = "$(error) Build failed";
      this.status.tooltip = "See the Problems panel for details";
      this.status.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    }
  }

  private composeHtml(html: string, content: { js?: string; css?: string; buildError?: string }): string {
    const bridge = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><script>${escapeScript(__BRIDGE_SOURCE__)}</script>`;
    let result = insertHead(html, bridge);
    if (content.css) {
      result = insertBefore(result, /<\/head>/i, `<style>${escapeStyle(content.css)}</style>`);
    }
    const body =
      content.buildError !== undefined
        ? `<script type="application/json" id="build-error">${escapeScript(JSON.stringify(content.buildError))}</script>`
        : `<script type="module">${escapeScript(content.js ?? "")}</script>`;
    result = insertBefore(result, /<\/body>/i, body);
    // Ensures the webview reloads even when the output is unchanged
    return `${result}\n<!-- build ${++this.buildCount} -->`;
  }

  private setDiagnostics(errors: Message[], warnings: Message[]): void {
    this.diagnostics.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    const add = (message: Message, severity: vscode.DiagnosticSeverity) => {
      const location = message.location;
      if (!location?.file) return;
      const path = normalize(location.file);
      if (path.startsWith("node_modules/")) return;
      const line = Math.max(0, location.line - 1);
      const range = new vscode.Range(line, location.column, line, location.column + Math.max(location.length, 1));
      const diagnostic = new vscode.Diagnostic(range, message.text, severity);
      diagnostic.source = "esbuild";
      byFile.set(path, [...(byFile.get(path) ?? []), diagnostic]);
    };
    errors.forEach((m) => add(m, vscode.DiagnosticSeverity.Error));
    warnings.forEach((m) => add(m, vscode.DiagnosticSeverity.Warning));
    for (const [path, diagnostics] of byFile) {
      this.diagnostics.set(this.fs.toUri(path), diagnostics);
    }
  }

  private onMessage(message: { type?: string; level?: string; text?: string }): void {
    if (message.type !== "console" || typeof message.text !== "string") return;
    switch (message.level) {
      case "error":
        this.output.error(message.text);
        break;
      case "warn":
        this.output.warn(message.text);
        break;
      default:
        this.output.info(message.text);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.panel?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
