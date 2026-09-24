/**
 * Minimal POSIX path helpers. All project paths are relative to the project
 * root and have no leading slash, e.g. `src/TodoList.tsx`. The root itself is `""`.
 */

export function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

export function join(...segments: string[]): string {
  return normalize(segments.filter(Boolean).join("/"));
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function extname(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index);
}

export function isDescendant(path: string, ancestor: string): boolean {
  return ancestor === "" ? path !== "" : path.startsWith(ancestor + "/");
}

/**
 * Read-only dependencies: `node_modules` for the bundler and `typings` for the TypeScript
 * server, which can't read type definitions from `node_modules` in the browser.
 */
export const DEPENDENCY_DIRS = ["node_modules", "typings"];

/** Files that exist in the workspace for the tooling but are hidden from the candidate. */
export const HIDDEN_ROOT_FILES = ["index.html", "tsconfig.json"];

export function isDependency(path: string): boolean {
  return DEPENDENCY_DIRS.some((dir) => path === dir || path.startsWith(dir + "/"));
}

export function isHidden(path: string): boolean {
  return isDependency(path) || HIDDEN_ROOT_FILES.includes(path);
}
