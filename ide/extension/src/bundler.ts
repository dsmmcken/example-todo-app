import * as esbuild from "esbuild-wasm";
import { resolve as resolveExports } from "resolve.exports";
import { WorkspaceFileSystem } from "./fileSystem";
import { dirname, extname, join, normalize } from "./paths";

/**
 * Bundles the project with esbuild running in the browser, resolving imports
 * against the in-memory workspace (including `node_modules`) much like Vite does.
 */

export interface BundleResult {
  js: string;
  css: string;
  warnings: esbuild.Message[];
}

export class BundleError extends Error {
  constructor(readonly errors: esbuild.Message[], readonly warnings: esbuild.Message[]) {
    super(`Build failed with ${errors.length} error${errors.length === 1 ? "" : "s"}`);
  }
}

const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json", ".css"];

const LOADERS: Record<string, esbuild.Loader> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
  ".json": "json",
  ".css": "css",
  ".txt": "text",
  ".svg": "dataurl",
  ".png": "dataurl",
  ".jpg": "dataurl",
  ".jpeg": "dataurl",
  ".gif": "dataurl",
  ".webp": "dataurl",
  ".woff": "dataurl",
  ".woff2": "dataurl",
};

interface PackageJson {
  main?: string;
  module?: string;
  browser?: string | Record<string, string | false>;
  exports?: unknown;
}

/** Converts esbuild's absolute paths (`/src/x.tsx`) to project paths (`src/x.tsx`). */
const toProjectPath = (path: string) => normalize(path);
const toBuildPath = (path: string) => "/" + path;

let initialized: Promise<void> | undefined;

export class Bundler {
  private context: esbuild.BuildContext | undefined;
  private contextEntry: string | undefined;

  constructor(
    private readonly fs: WorkspaceFileSystem,
    private readonly wasmURL: string,
  ) {}

  async bundle(entry: string): Promise<BundleResult> {
    initialized ??= esbuild.initialize({ wasmURL: this.wasmURL, worker: false });
    await initialized;

    if (!this.context || this.contextEntry !== entry) {
      await this.context?.dispose();
      this.context = await esbuild.context(this.options(entry));
      this.contextEntry = entry;
    }

    let result: esbuild.BuildResult<{ write: false }>;
    try {
      result = (await this.context.rebuild()) as esbuild.BuildResult<{ write: false }>;
    } catch (e) {
      const failure = e as esbuild.BuildFailure;
      if (Array.isArray(failure.errors)) throw new BundleError(failure.errors, failure.warnings ?? []);
      throw e;
    }
    const output = (ext: string) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? "";
    return { js: output(".js"), css: output(".css"), warnings: result.warnings };
  }

  async formatMessages(messages: esbuild.Message[], kind: "error" | "warning"): Promise<string[]> {
    return esbuild.formatMessages(messages, { kind, color: false });
  }

  async dispose(): Promise<void> {
    await this.context?.dispose();
    this.context = undefined;
  }

  private options(entry: string): esbuild.BuildOptions & { write: false } {
    return {
      entryPoints: [toBuildPath(entry)],
      absWorkingDir: "/",
      outdir: "/dist",
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      sourcemap: "inline",
      jsxDev: true,
      tsconfigRaw: this.fs.readTextSync("tsconfig.json") ?? "{}",
      define: {
        "process.env.NODE_ENV": '"development"',
        "import.meta.env": '{"DEV":true,"PROD":false,"MODE":"development","BASE_URL":"/","SSR":false}',
      },
      logLevel: "silent",
      plugins: [this.workspacePlugin()],
    };
  }

  private workspacePlugin(): esbuild.Plugin {
    return {
      name: "workspace",
      setup: (build) => {
        build.onResolve({ filter: /.*/ }, (args) => {
          const fromDir = args.resolveDir ? toProjectPath(args.resolveDir) : "";
          const spec = args.path;

          if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) {
            // http(s): and data: URLs are left for the browser to load
            return { path: spec, external: true };
          }

          let resolved: string | false | undefined;
          if (spec.startsWith("/")) {
            resolved = this.resolveFile(normalize(spec));
          } else if (spec.startsWith(".")) {
            resolved = this.resolveFile(join(fromDir, spec));
          } else {
            const pkg = this.resolvePackage(spec, fromDir, args.kind);
            if (typeof pkg === "object") return { errors: [{ text: pkg.error }] };
            resolved = pkg;
          }

          if (resolved === false) return { path: spec, namespace: "empty" };
          // Returning nothing lets esbuild report its usual "Could not resolve" error
          if (resolved === undefined) return undefined;
          return { path: toBuildPath(resolved), namespace: "file" };
        });

        build.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "", loader: "js" }));

        build.onLoad({ filter: /.*/, namespace: "file" }, (args) => {
          const path = toProjectPath(args.path);
          const contents = this.fs.readSync(path);
          if (!contents) return { errors: [{ text: `File not found: ${path}` }] };
          return {
            contents,
            loader: LOADERS[extname(path).toLowerCase()] ?? "text",
            resolveDir: toBuildPath(dirname(path)),
          };
        });
      },
    };
  }

  /** Resolves a path to a file, trying extensions and `index` files like Node and Vite do. */
  private resolveFile(path: string): string | undefined {
    if (this.fs.isFile(path)) return path;
    for (const ext of RESOLVE_EXTENSIONS) {
      if (this.fs.isFile(path + ext)) return path + ext;
    }
    // TypeScript allows importing `./foo.js` to refer to `./foo.ts`
    const ext = extname(path);
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
      const base = path.slice(0, -ext.length);
      for (const tsExt of [".ts", ".tsx", ".mts", ".cts"]) {
        if (this.fs.isFile(base + tsExt)) return base + tsExt;
      }
    }
    if (this.fs.isDirectory(path)) {
      const pkg = this.readPackageJson(join(path, "package.json"));
      if (pkg) {
        const main = this.legacyEntry(pkg);
        const resolved = main && main !== "." ? this.resolveFile(join(path, main)) : undefined;
        if (resolved) return resolved;
      }
      for (const ext of RESOLVE_EXTENSIONS) {
        if (this.fs.isFile(join(path, "index" + ext))) return join(path, "index" + ext);
      }
    }
    return undefined;
  }

  /** Resolves a bare import like `react-dom/client` from `node_modules`. */
  private resolvePackage(
    spec: string,
    fromDir: string,
    kind: esbuild.ImportKind,
  ): string | false | undefined | { error: string } {
    const segments = spec.split("/");
    const name = spec.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
    const subpath = "." + spec.slice(name.length);

    for (let dir = fromDir; ; dir = dirname(dir)) {
      const packageDir = join(dir, "node_modules", name);
      const pkg = this.readPackageJson(join(packageDir, "package.json"));
      if (pkg) {
        let target: string | undefined;
        if (pkg.exports) {
          try {
            target = resolveExports(pkg, subpath, {
              browser: true,
              require: kind === "require-call" || kind === "require-resolve",
              conditions: ["module", "development"],
            })?.[0];
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        } else {
          target = subpath === "." ? this.legacyEntry(pkg) ?? "index.js" : subpath;
        }
        if (!target) return undefined;
        const resolved = this.resolveFile(join(packageDir, target));
        return resolved && this.applyBrowserField(pkg, packageDir, resolved);
      }
      if (dir === "") return undefined;
    }
  }

  private legacyEntry(pkg: PackageJson): string | undefined {
    if (typeof pkg.browser === "string") return pkg.browser;
    return pkg.module ?? pkg.main;
  }

  /** Applies `"browser": { "./node.js": "./browser.js" }` style replacements. */
  private applyBrowserField(pkg: PackageJson, packageDir: string, resolved: string): string | false {
    if (!pkg.browser || typeof pkg.browser !== "object") return resolved;
    for (const [from, to] of Object.entries(pkg.browser)) {
      if (join(packageDir, from) !== resolved && this.resolveFile(join(packageDir, from)) !== resolved) continue;
      if (to === false) return false;
      return this.resolveFile(join(packageDir, to)) ?? resolved;
    }
    return resolved;
  }

  private readPackageJson(path: string): PackageJson | undefined {
    const text = this.fs.readTextSync(path);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
}
