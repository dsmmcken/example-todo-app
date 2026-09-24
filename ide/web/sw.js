/*
 * Adds the headers that make the IDE cross-origin isolated, which enables
 * SharedArrayBuffer and with it full project-wide TypeScript IntelliSense.
 * Static hosts like GitHub Pages can't be configured to send these headers.
 *
 * The same handler is appended to VS Code's webview service worker by build.mjs,
 * since that worker controls the webview frames instead of this one.
 */

/* COI_HANDLER_START */
function addCrossOriginIsolationHeaders(response) {
  if (response.status === 0 || response.type === "opaqueredirect") return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  const hasBody = ![101, 204, 205, 304].includes(response.status);
  return new Response(hasBody ? response.body : null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  // Cross-origin requests must already be CORS or CORP enabled
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).then(addCrossOriginIsolationHeaders));
});
/* COI_HANDLER_END */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
