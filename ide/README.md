# Browser IDE

A static site that runs the exercise entirely in the browser: VS Code for the web, with
the app's source in the editor and a live preview that rebuilds on every save. It's
deployed to GitHub Pages by `.github/workflows/deploy-ide.yml`, so candidates only need
the URL. Nothing is installed and there's no server.

```bash
npm run ide:build   # builds ide/dist
npm run ide:serve   # serves it like GitHub Pages at http://localhost:8080/example-todo-app/
```

## Running an interview

- Changes are saved in the candidate's browser (IndexedDB), so refreshing keeps their work.
- The **Source Control** view works like a minimal git. It lists files that differ from the
  original exercise, clicking one opens a diff, and you can revert a file or everything.
  Changed lines are also marked in the editor gutter.
- **Exercise: Reset Exercise** in the command palette discards all changes.
- `console` output and errors from the app appear in the **Preview Console** output panel.
- Deploying a change to the exercise files resets everyone's saved changes, so avoid
  deploying during an interview.

## How it works

| Piece | Where |
| --- | --- |
| VS Code for the web ([`vscode-web`](https://www.npmjs.com/package/vscode-web), a build of the MIT-licensed Code - OSS) | `node_modules/vscode-web` → `dist/vscode/` |
| Boot page and workbench configuration | `web/index.html`, `build.mjs` |
| Extension: file system, search, bundler, preview | `extension/src/` |
| In-browser bundler | [`esbuild-wasm`](https://esbuild.github.io/) in `extension/src/bundler.ts` |

`build.mjs` seeds the editor with `src/`, `index.html` and `tsconfig.json` from the repo
root, plus the dependencies from `node_modules`. Only `src/` is visible to the candidate.
When a file is saved, the extension bundles the app from `index.html`'s entry point, the
same way Vite would, and reloads the preview.

A few details exist to work around running on a static host:

- **Cross-origin isolation.** The TypeScript server needs `SharedArrayBuffer` for project-wide
  IntelliSense, which requires COOP/COEP headers. GitHub Pages can't send them, so `web/sw.js`,
  a service worker, adds them. The first visit reloads the page once to install it.
- **Webviews on the same origin.** VS Code normally serves webviews from `vscode-cdn.net`.
  `build.mjs` patches the webview host page to accept the site's own origin, and patches
  the webview's service worker to add the same headers.
- **Type definitions live in `typings/`, not `node_modules/`.** The browser TypeScript server
  routes every `node_modules` path to its npm auto-installer. The workspace's
  `tsconfig.json` therefore maps modules to `typings/` with `paths`, while the bundler keeps
  using `node_modules`.
- **No `package.json` in the workspace.** If one is present, TypeScript tries to install
  packages from the npm registry.

To upgrade VS Code, bump `vscode-web`. `build.mjs` fails loudly if the files it patches have
changed.
