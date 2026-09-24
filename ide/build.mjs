/**
 * Builds the browser-based IDE into `ide/dist`, a static site that can be
 * hosted anywhere (e.g. GitHub Pages):
 *
 *   index.html          Boots VS Code for the web
 *   sw.js               Service worker adding cross-origin isolation headers
 *   vscode/             VS Code for the web (from the `vscode-web` package), with webview patches
 *   extension/          The exercise extension: file system, bundler and preview
 *     workspace.json    The exercise files and their dependencies, seeded into the editor
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ideDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(ideDir, "..");
const outDir = path.join(ideDir, "dist");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const EXTENSION_ID = "deephaven.todo-ide";
const WORKSPACE_ROOT = "/example-todo-app";

/**
 * Project files seeded into the workspace, in addition to `src/`. Only `src/` is visible.
 * `package.json` is left out: dependencies are already in `node_modules`, and its presence
 * makes the TypeScript extension try to install packages from the npm registry.
 */
const PROJECT_FILES = ["index.html", "tsconfig.json"];

/** Files kept from each dependency in `node_modules`, for bundling and type checking. */
const DEPENDENCY_FILE = /\.(js|mjs|cjs|json|css|d\.ts|d\.mts|d\.cts)$/;
const TYPES_FILE = /\.d\.[mc]?ts$/;
const EXCLUDED_DEPENDENCY_DIRS = new Set(["umd", "test", "tests", "__tests__", ".bin"]);

/** Editor settings. Users can still change them; they're stored in the browser. */
const CONFIGURATION_DEFAULTS = {
  "files.exclude": {
    "**/node_modules": true,
    "typings": true,
    "index.html": true,
    "tsconfig.json": true,
  },
  "search.exclude": { "**/node_modules": true, "typings": true },
  "files.autoSave": "off",
  "workbench.colorTheme": "Default Dark Modern",
  "typescript.tsserver.web.projectWideIntellisense.enabled": true,
  "typescript.tsserver.web.projectWideIntellisense.suppressSemanticErrors": false,
  "typescript.tsserver.web.typeAcquisition.enabled": false,
  "typescript.disableAutomaticTypeAcquisition": true,
  // Keep the preview's reload and console buttons visible when the code editor has focus
  "workbench.editor.alwaysShowEditorActions": true,
  // Code never opens in the preview's group; keeping empty groups means there's always
  // another group for it to open in
  "workbench.editor.autoLockGroups": { "mainThreadWebview-todoIde.preview": true },
  "workbench.editor.closeEmptyGroups": false,
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.enableExperiments": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "extensions.ignoreRecommendations": true,
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.showReleaseNotes": false,
  "window.title": "${activeEditorShort}${separator}Todo Exercise",
};

const WORKBENCH_CONFIG = {
  // An authority avoids path mapping bugs in the TypeScript server for URIs without one
  folderUri: { scheme: "todo", authority: "exercise", path: WORKSPACE_ROOT },
  productConfiguration: {
    nameShort: "Todo Exercise",
    nameLong: "Todo Exercise",
    applicationName: "todo-exercise",
    dataFolderName: ".todo-exercise",
    extensionEnabledApiProposals: {
      [EXTENSION_ID]: ["fileSearchProvider", "textSearchProvider"],
    },
  },
  configurationDefaults: CONFIGURATION_DEFAULTS,
  initialColorTheme: { themeType: "dark" },
  windowIndicator: { label: "$(beaker) Todo Exercise", tooltip: "Todo list interview exercise" },
};

function walk(dir, filter = () => true) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (filter(full, true)) results.push(...walk(full, filter));
    } else if (filter(full, false)) {
      results.push(full);
    }
  }
  return results;
}

const toPosix = (p) => p.split(path.sep).join("/");

/**
 * The workspace's tsconfig.json: the project's own, pointed at `typings/`. The TypeScript
 * server in VS Code for the web routes every `node_modules` path to its npm auto-installer,
 * so type definitions are served from a separate folder instead.
 */
function workspaceTsconfig() {
  const text = fs.readFileSync(path.join(projectDir, "tsconfig.json"), "utf8");
  const tsconfig = JSON.parse(text.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  tsconfig.compilerOptions = {
    ...tsconfig.compilerOptions,
    // Global types come in through imports; scanning type roots trips over the same routing
    types: [],
    paths: { "*": ["./typings/@types/*", "./typings/*"] },
  };
  return JSON.stringify(tsconfig, null, 2) + "\n";
}

/**
 * The files in `node_modules` that bundling the app actually uses, found with a real esbuild
 * build using the same settings as the in-browser bundler. This leaves out things like React's
 * production, server and test builds, which would otherwise be most of the download.
 */
async function usedDependencyFiles() {
  const result = await esbuild.build({
    entryPoints: [path.join(projectDir, "src/index.tsx")],
    absWorkingDir: projectDir,
    bundle: true,
    write: false,
    outdir: "out",
    metafile: true,
    platform: "browser",
    conditions: ["module", "development"],
    jsxDev: true,
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "silent",
  });
  return new Set(Object.keys(result.metafile.inputs).filter((p) => p.startsWith("node_modules/")));
}

/**
 * Collects the exercise sources plus the dependencies needed to bundle them (`node_modules/`)
 * and type check them (`typings/`).
 */
async function collectWorkspace() {
  const files = {};
  const add = (absolute, relative = toPosix(path.relative(projectDir, absolute))) => {
    files[relative] = fs.readFileSync(absolute, "utf8");
  };

  walk(path.join(projectDir, "src")).forEach((f) => add(f));
  PROJECT_FILES.forEach((f) => add(path.join(projectDir, f)));
  files["tsconfig.json"] = workspaceTsconfig();

  const pkg = readJson(path.join(projectDir, "package.json"));
  const dependencies = Object.keys(pkg.dependencies ?? {});
  // Type definitions for the runtime dependencies, e.g. @types/react
  const typeName = (name) => `@types/${name.replace(/^@/, "").replace("/", "__")}`;
  const types = dependencies.map(typeName).filter((name) => name in (pkg.devDependencies ?? {}));
  const queue = [...dependencies, ...types];
  const used = await usedDependencyFiles();
  const packages = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    if (packages.has(name)) continue;
    const packageDir = path.join(projectDir, "node_modules", name);
    if (!fs.existsSync(path.join(packageDir, "package.json"))) {
      throw new Error(`Dependency ${name} is not installed, run npm install`);
    }
    packages.add(name);
    queue.push(...Object.keys(readJson(path.join(packageDir, "package.json")).dependencies ?? {}));

    const packageFiles = walk(packageDir, (p, isDir) =>
      isDir ? !EXCLUDED_DEPENDENCY_DIRS.has(path.basename(p)) : DEPENDENCY_FILE.test(p) && !p.endsWith(".map"),
    );
    for (const file of packageFiles) {
      const relative = toPosix(path.relative(packageDir, file));
      const isTypes = TYPES_FILE.test(file);
      if (isTypes || relative === "package.json") add(file, `typings/${name}/${relative}`);
      const runtimePath = `node_modules/${name}/${relative}`;
      // package.json files are kept for module resolution
      if (!isTypes && !name.startsWith("@types/") && (used.has(runtimePath) || relative === "package.json")) {
        add(file, runtimePath);
      }
    }
  }

  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const version = createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
  return { version, files: sorted, packages: [...packages] };
}

function replaceOrThrow(text, search, replacement, description) {
  if (!text.includes(search)) throw new Error(`Unable to patch ${description}: VS Code build has changed`);
  return text.replace(search, replacement);
}

/**
 * VS Code normally serves webviews from a separate origin (vscode-cdn.net). A
 * static host only has one origin, so allow webviews on the same origin and make
 * the webview service worker add cross-origin isolation headers.
 */
function patchWebviews(vscodeDir) {
  const preDir = path.join(vscodeDir, "out/vs/workbench/contrib/webview/browser/pre");

  // Firefox gets a variant without a CSP; the inline script in the other is allowed by hash
  for (const name of ["index.html", "index-no-csp.html"]) {
    const pagePath = path.join(preDir, name);
    let page = replaceOrThrow(
      fs.readFileSync(pagePath, "utf8"),
      "if (hostname === parentOriginHash || hostname.startsWith(parentOriginHash + '.')) {",
      "if (parentOrigin === location.origin || hostname === parentOriginHash || hostname.startsWith(parentOriginHash + '.')) {",
      `webview origin check in ${name}`,
    );
    const script = /<script async type="module">([\s\S]*?)<\/script>/.exec(page);
    if (!script) throw new Error(`Unable to find the webview script in ${name}`);
    const hash = createHash("sha256").update(script[1]).digest("base64");
    page = page.replace(/'sha256-[A-Za-z0-9+/=]+'/, `'sha256-${hash}'`);
    fs.writeFileSync(pagePath, page);
  }

  const handler = /\/\* COI_HANDLER_START \*\/([\s\S]*?)\/\* COI_HANDLER_END \*\//.exec(
    fs.readFileSync(path.join(ideDir, "web/sw.js"), "utf8"),
  )[1];
  const workerPath = path.join(preDir, "service-worker.js");
  fs.appendFileSync(workerPath, `\n;(() => {${handler}})();\n`);
}

async function buildExtension(extensionOutDir) {
  const bridge = await esbuild.build({
    entryPoints: [path.join(ideDir, "extension/src/client/bridge.ts")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify: true,
  });

  await esbuild.build({
    entryPoints: [path.join(ideDir, "extension/src/extension.ts")],
    outfile: path.join(extensionOutDir, "dist/extension.js"),
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2022",
    external: ["vscode"],
    sourcemap: true,
    define: { __BRIDGE_SOURCE__: JSON.stringify(bridge.outputFiles[0].text) },
    logLevel: "warning",
  });

  fs.copyFileSync(
    path.join(projectDir, "node_modules/esbuild-wasm/esbuild.wasm"),
    path.join(extensionOutDir, "dist/esbuild.wasm"),
  );
  fs.copyFileSync(path.join(ideDir, "extension/package.json"), path.join(extensionOutDir, "package.json"));
}

async function main() {
  const started = Date.now();
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const vscodeDir = path.join(outDir, "vscode");
  fs.cpSync(path.join(projectDir, "node_modules/vscode-web/dist"), vscodeDir, { recursive: true });
  patchWebviews(vscodeDir);

  const extensionOutDir = path.join(outDir, "extension");
  await buildExtension(extensionOutDir);

  const { version, files, packages } = await collectWorkspace();
  fs.writeFileSync(path.join(extensionOutDir, "workspace.json"), JSON.stringify({ version, files }));

  const extensionManifest = readJson(path.join(ideDir, "extension/package.json"));
  if (`${extensionManifest.publisher}.${extensionManifest.name}` !== EXTENSION_ID) {
    throw new Error(`Extension id must be ${EXTENSION_ID}`);
  }

  const html = replaceOrThrow(
    fs.readFileSync(path.join(ideDir, "web/index.html"), "utf8"),
    "/*CONFIG*/ {}",
    JSON.stringify(WORKBENCH_CONFIG, null, 2).replace(/\n/g, "\n        "),
    "index.html",
  );
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  fs.copyFileSync(path.join(ideDir, "web/sw.js"), path.join(outDir, "sw.js"));
  // Serve files as-is on GitHub Pages
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "");

  const size = Buffer.byteLength(JSON.stringify(files));
  console.log(
    `Built ide/dist in ${Date.now() - started} ms: ${Object.keys(files).length} workspace files ` +
      `(${(size / 1024 / 1024).toFixed(1)} MB, version ${version}) including ${packages.join(", ")}`,
  );
}

await main();
