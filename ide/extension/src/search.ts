import * as vscode from "vscode";
import { WorkspaceFileSystem } from "./fileSystem";

/*
 * Quick Open (Ctrl+P) and Search (Ctrl+Shift+F) need search providers for
 * custom file systems. These are proposed APIs, enabled for this extension via
 * `extensionEnabledApiProposals` in the workbench configuration, so the types
 * are declared loosely here.
 */

interface TextSearchQuery {
  pattern: string;
  isRegExp?: boolean;
  isCaseSensitive?: boolean;
  isWordMatch?: boolean;
}

interface TextSearchOptions {
  maxResults: number;
}

interface TextSearchMatch {
  uri: vscode.Uri;
  ranges: vscode.Range[];
  preview: { text: string; matches: vscode.Range[] };
}

interface ProposedWorkspace {
  registerFileSearchProvider(
    scheme: string,
    provider: { provideFileSearchResults(query: { pattern: string }): vscode.ProviderResult<vscode.Uri[]> },
  ): vscode.Disposable;
  registerTextSearchProvider(
    scheme: string,
    provider: {
      provideTextSearchResults(
        query: TextSearchQuery,
        options: TextSearchOptions,
        progress: vscode.Progress<TextSearchMatch>,
        token: vscode.CancellationToken,
      ): vscode.ProviderResult<{ limitHit?: boolean }>;
    },
  ): vscode.Disposable;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegExp(query: TextSearchQuery): RegExp {
  let source = query.isRegExp ? query.pattern : escapeRegExp(query.pattern);
  if (query.isWordMatch) source = `\\b${source}\\b`;
  return new RegExp(source, query.isCaseSensitive ? "g" : "gi");
}

export function registerSearchProviders(fs: WorkspaceFileSystem, scheme: string): vscode.Disposable[] {
  const workspace = vscode.workspace as unknown as ProposedWorkspace;
  const disposables: vscode.Disposable[] = [];

  try {
    disposables.push(
      workspace.registerFileSearchProvider(scheme, {
        async provideFileSearchResults() {
          await fs.ready;
          // Quick Open does its own fuzzy matching on the results
          return fs.visibleFiles().map((path) => fs.toUri(path));
        },
      }),
    );

    disposables.push(
      workspace.registerTextSearchProvider(scheme, {
        async provideTextSearchResults(query, options, progress, token) {
          await fs.ready;
          const regExp = buildRegExp(query);
          let count = 0;
          for (const path of fs.visibleFiles()) {
            if (token.isCancellationRequested) break;
            const lines = (fs.readTextSync(path) ?? "").split(/\r?\n/);
            for (let line = 0; line < lines.length; line++) {
              const text = lines[line];
              regExp.lastIndex = 0;
              const ranges: vscode.Range[] = [];
              for (let match = regExp.exec(text); match; match = regExp.exec(text)) {
                if (match[0].length === 0) {
                  regExp.lastIndex++;
                  continue;
                }
                ranges.push(new vscode.Range(line, match.index, line, match.index + match[0].length));
              }
              if (ranges.length === 0) continue;
              if (count >= options.maxResults) return { limitHit: true };
              count++;
              // Preview ranges are relative to the preview text rather than the file
              const matches = ranges.map((r) => new vscode.Range(0, r.start.character, 0, r.end.character));
              progress.report({ uri: fs.toUri(path), ranges, preview: { text, matches } });
            }
          }
          return { limitHit: false };
        },
      }),
    );
  } catch (e) {
    console.warn("Search providers unavailable", e);
  }

  return disposables;
}
