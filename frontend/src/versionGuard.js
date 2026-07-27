/* global __BUILD_TIME__ */
/**
 * Closes the "tab open forever, never navigates" gap that AutoUpdater (which
 * only flips on route change) can't reach. Two levers:
 *
 *  A. Auto-force after grace — once a new build has been waiting GRACE_MS, apply
 *     it at the next SAFE IDLE moment (tab visible, nothing focused, no recent
 *     input) even without a navigation. Won't reload someone mid-form.
 *
 *  B. Server kill-switch — poll GET /api/version for `force_reload_after` (an
 *     epoch-ms threshold set via the backend FORCE_RELOAD_AFTER env var). If
 *     this build predates it, force the update NOW (aggressive — for hotfixes).
 *
 * Both route through applyUpdate() (skipWaiting + plugin reload), which is a
 * no-op unless a newer worker is actually waiting — so a misconfigured
 * threshold can never cause a reload loop.
 */
import { api } from './api';
import { isUpdateReady, applyUpdate, subscribe } from './swUpdate';

const GRACE_MS = 10 * 60 * 1000; // how long a waiting update sits before auto-force
const IDLE_MS = 60 * 1000;       // "idle" = no user input for this long
const POLL_MS = 5 * 60 * 1000;   // server kill-switch poll cadence

// Build stamp (epoch ms), injected by vite `define`. Falsy in the unlikely
// case it wasn't replaced — treat as "always stale" would be wrong, so guard.
const BUILD_TIME = typeof __BUILD_TIME__ === 'number' ? __BUILD_TIME__ : 0;

let lastActivity = Date.now();
for (const ev of ['keydown', 'pointerdown', 'input', 'scroll']) {
  window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true });
}

// True while the user is (or just was) actively working — a text field is
// focused, or there was input within IDLE_MS. Deliberately conservative for the
// auto-force path so a half-filled form is never reloaded away.
function typingNow() {
  const el = document.activeElement;
  const tag = el && el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!(el && el.isContentEditable);
}
function idleSafe() {
  return document.visibilityState === 'visible'
    && !typingNow()
    && Date.now() - lastActivity > IDLE_MS;
}

/** Pure: is this build old enough that the server's threshold forces a reload? */
export function isBuildStale(buildTime, forceReloadAfter) {
  return !!forceReloadAfter && !!buildTime && buildTime < forceReloadAfter;
}

let registration = null;
let forcing = false;   // server kill-switch fired — apply the moment one is ready
let graceTimer = null;

export function initVersionGuard(reg) {
  registration = reg || null;

  // A + trigger: when a build starts waiting, arm the grace timer; if a
  // kill-switch is already pending, apply immediately.
  subscribe(() => {
    if (forcing) applyUpdate();
    else armGrace();
  });
  if (isUpdateReady()) armGrace();

  // B: poll the server kill-switch.
  const poll = async () => {
    if (document.visibilityState !== 'visible') return; // can't act on a hidden tab
    try {
      const data = await api.version();
      if (isBuildStale(BUILD_TIME, data && data.force_reload_after)) forceNow();
    } catch { /* offline / transient — try again next tick */ }
  };
  poll();
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', poll);
}

function armGrace() {
  if (graceTimer) return;
  graceTimer = setTimeout(() => { graceTimer = null; tryIdleApply(); }, GRACE_MS);
}
function tryIdleApply() {
  if (!isUpdateReady()) return;
  if (idleSafe()) applyUpdate();
  else setTimeout(tryIdleApply, 15 * 1000); // not safe yet — re-check shortly
}

// Aggressive path (kill-switch): apply a waiting update now, or fetch the newest
// worker and apply as soon as it installs (the `forcing` flag in subscribe()).
function forceNow() {
  forcing = true;
  if (isUpdateReady()) applyUpdate();
  else if (registration) registration.update().catch(() => {});
}
