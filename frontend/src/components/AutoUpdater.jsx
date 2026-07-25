/**
 * Silent auto-update at a safe moment. Renders nothing.
 *
 * When a new build is installed and waiting (swUpdate.isUpdateReady), it is
 * applied on the next ROUTE NAVIGATION — never mid-page. Navigating away
 * discards the current route's transient state anyway (an in-progress add-unit
 * form, a scroll position), so a reload at that boundary loses nothing the user
 * wasn't already leaving behind. This replaces the click-to-reload UpdateBanner:
 * the user never has to notice or act, and a CP typing into a form is never
 * reloaded out from under.
 *
 * Deliberately NOT triggered on tab hide/refocus: reloading a backgrounded tab
 * would silently destroy an unsaved form the user tabbed away from. Navigation
 * is the only unambiguously safe moment, so it's the only trigger.
 *
 * applyUpdate() calls the vite-plugin-pwa updateSW() (skipWaiting); the plugin
 * reloads the page itself on controllerchange — so the fresh build serves the
 * route we just navigated to.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { applyUpdate, isUpdateReady } from '../swUpdate';

export default function AutoUpdater() {
  const { pathname } = useLocation();
  const firstRender = useRef(true);

  useEffect(() => {
    // Skip the initial mount: if an update is already waiting on first load,
    // hold it for the first real navigation rather than reloading immediately
    // (which could interrupt a deep-linked form).
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (isUpdateReady()) applyUpdate();
  }, [pathname]);

  return null;
}
