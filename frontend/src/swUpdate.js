/**
 * Bridge between the service-worker registration (module scope, outside React)
 * and the <UpdateBanner /> that offers the reload.
 *
 * A tiny external store rather than context: registerSW() runs in main.jsx
 * before React mounts, so there is no provider to write into at that point.
 *
 * `apply` is the updateSW() function vite-plugin-pwa returns. Calling it tells
 * the waiting service worker to skipWaiting; the plugin's own `controlling`
 * listener then reloads the page — so we never call location.reload() here.
 */

let apply = null;
const subscribers = new Set();

/** Called from registerSW's onNeedRefresh: a new build is installed and waiting. */
export function setUpdateReady(applyFn) {
  apply = applyFn;
  subscribers.forEach((fn) => fn());
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Boolean (not the function) so useSyncExternalStore sees a stable primitive —
// returning `apply` itself would be a new reference only when it changes, but a
// primitive keeps the equality check obvious and cheap.
export function isUpdateReady() {
  return apply !== null;
}

/** Server snapshot — no SW during SSR/prerender, so never "update ready". */
export function isUpdateReadyServer() {
  return false;
}

export function applyUpdate() {
  apply?.();
}
