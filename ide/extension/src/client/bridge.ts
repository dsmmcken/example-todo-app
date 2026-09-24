/**
 * Runs inside the preview webview before the app. Forwards console output and
 * uncaught errors to the extension (shown in the "Preview Console" output) and
 * renders build/runtime error overlays, similar to Vite's dev server.
 */

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

type Level = "log" | "info" | "warn" | "error" | "debug";

const vscode = acquireVsCodeApi();

// VS Code injects default styles (e.g. body padding) into webviews; the app should look like it does in a browser
document.getElementById("_defaultStyles")?.remove();

function inspect(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (typeof value === "string") return depth === 0 ? value : `'${value}'`;
  if (typeof value === "function") return `ƒ ${value.name || "anonymous"}()`;
  if (typeof value === "symbol" || typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return String(value);
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof Node !== "undefined" && value instanceof Element) {
    const id = value.id ? `#${value.id}` : "";
    const classes = value.classList.length ? "." + [...value.classList].join(".") : "";
    return `<${value.tagName.toLowerCase()}${id}${classes}>`;
  }
  if (seen.has(value)) return "[Circular]";
  if (depth > 3) return Array.isArray(value) ? "[Array]" : "{…}";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((v) => inspect(v, depth + 1, seen)).join(", ")}]`;
    }
    if (value instanceof Map) {
      const items = [...value].map(([k, v]) => `${inspect(k, depth + 1, seen)} => ${inspect(v, depth + 1, seen)}`);
      return `Map(${value.size}) {${items.join(", ")}}`;
    }
    if (value instanceof Set) {
      return `Set(${value.size}) {${[...value].map((v) => inspect(v, depth + 1, seen)).join(", ")}}`;
    }
    const name = value.constructor && value.constructor !== Object ? value.constructor.name + " " : "";
    const entries = Object.keys(value).map(
      (key) => `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`}: ${inspect((value as Record<string, unknown>)[key], depth + 1, seen)}`,
    );
    return `${name}{${entries.join(", ")}}`;
  } catch {
    return String(value);
  } finally {
    seen.delete(value);
  }
}

/** Formats console arguments the way browsers do, including `%s`-style substitutions. */
function format(args: unknown[]): string {
  const rest = [...args];
  let out = "";
  if (typeof rest[0] === "string" && /%[sdifoOc%]/.test(rest[0])) {
    const template = rest.shift() as string;
    out = template.replace(/%([sdifoOc%])/g, (match, type: string) => {
      if (type === "%") return "%";
      if (rest.length === 0) return match;
      const arg = rest.shift();
      switch (type) {
        case "s":
          return typeof arg === "string" ? arg : inspect(arg, 1);
        case "d":
        case "i":
          return String(parseInt(String(arg), 10));
        case "f":
          return String(parseFloat(String(arg)));
        case "c":
          return "";
        default:
          return inspect(arg, 1);
      }
    });
  }
  return [out, ...rest.map((arg) => inspect(arg))].filter((s, i) => i > 0 || s !== "").join(" ");
}

function post(message: Record<string, unknown>) {
  try {
    vscode.postMessage(message);
  } catch {
    // Ignore messages that can't be cloned
  }
}

for (const level of ["log", "info", "warn", "error", "debug"] as Level[]) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    post({ type: "console", level, text: format(args) });
    original(...args);
  };
}

// --- Overlays ---

let overlayRoot: ShadowRoot | undefined;

function getOverlayRoot(): ShadowRoot {
  if (!overlayRoot) {
    const host = document.createElement("preview-error-overlay");
    host.style.cssText = "position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    overlayRoot = host.attachShadow({ mode: "open" });
    overlayRoot.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.66); pointer-events: auto;
          display: flex; align-items: flex-start; justify-content: center; overflow: auto; }
        .panel { margin: 40px 16px; max-width: 900px; width: 100%; background: #181818; color: #d8d8d8;
          border-top: 6px solid #f33666; border-radius: 6px; padding: 20px 24px; box-shadow: 0 8px 30px rgba(0,0,0,0.5);
          font: 13px/1.5 ui-monospace, "Fira Code", Menlo, Consolas, monospace; }
        .title { color: #ff5555; font-weight: 600; font-size: 15px; margin: 0 0 12px; }
        pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }
        .hint { margin-top: 16px; color: #999; font-size: 12px; }
        .banner { position: fixed; left: 8px; right: 8px; bottom: 8px; pointer-events: auto; cursor: pointer;
          background: #3b1219; color: #ffb3c1; border: 1px solid #f33666; border-radius: 4px; padding: 8px 12px;
          font: 12px/1.4 ui-monospace, "Fira Code", Menlo, Consolas, monospace; white-space: pre-wrap; max-height: 40vh; overflow: auto; }
      </style>
      <div class="content"></div>`;
    document.documentElement.appendChild(host);
  }
  return overlayRoot;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function showBuildError(text: string) {
  const content = getOverlayRoot().querySelector(".content")!;
  content.innerHTML = `
    <div class="backdrop"><div class="panel">
      <p class="title">Build failed</p>
      <pre>${escapeHtml(text)}</pre>
      <p class="hint">Fix the error and save the file to rebuild.</p>
    </div></div>`;
}

function showRuntimeError(text: string) {
  const content = getOverlayRoot().querySelector(".content")!;
  if (content.querySelector(".backdrop")) return;
  content.innerHTML = `<div class="banner" title="Click to dismiss">${escapeHtml(text)}</div>`;
  content.querySelector(".banner")!.addEventListener("click", () => (content.innerHTML = ""));
}

window.addEventListener("error", (event) => {
  const text = event.error ? inspect(event.error) : `${event.message} (${event.filename}:${event.lineno})`;
  post({ type: "console", level: "error", text: `Uncaught ${text}` });
  showRuntimeError(`Uncaught ${text.split("\n")[0]}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const text = inspect(event.reason);
  post({ type: "console", level: "error", text: `Uncaught (in promise) ${text}` });
  showRuntimeError(`Uncaught (in promise) ${text.split("\n")[0]}`);
});

window.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type === "build-error") showBuildError(data.text);
});

// When the very first build fails there is no app to show, so the error is embedded in the page
window.addEventListener("DOMContentLoaded", () => {
  const initialError = document.querySelector<HTMLScriptElement>("script#build-error");
  if (initialError?.textContent) showBuildError(JSON.parse(initialError.textContent));
});
