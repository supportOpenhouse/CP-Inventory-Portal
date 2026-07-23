/**
 * "New version available" bar, shown once a new build has been downloaded and
 * is waiting to take over.
 *
 * Deliberately non-blocking: a CP can be eight fields into the add-unit form or
 * mid photo-upload, and a forced reload would destroy that work. The user picks
 * the moment.
 *
 * Dismiss is per-page-load, not persisted — if they dismiss and then leave the
 * tab open for another day, the next detected build shows it again.
 */
import { useState, useSyncExternalStore } from 'react';

import { applyUpdate, isUpdateReady, isUpdateReadyServer, subscribe } from '../swUpdate';

export default function UpdateBanner() {
  const ready = useSyncExternalStore(subscribe, isUpdateReady, isUpdateReadyServer);
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  if (!ready || dismissed) return null;

  return (
    <div className="update-bar" role="status">
      {/* Short on purpose: at 320px anything longer ellipsises to nothing
          meaningful, and the Reload button must stay fully visible. */}
      <span className="update-bar-text">New version available</span>
      <button
        type="button"
        className="update-bar-btn"
        disabled={applying}
        onClick={() => { setApplying(true); applyUpdate(); }}
      >
        {applying ? 'Updating…' : 'Reload'}
      </button>
      <button
        type="button"
        className="update-bar-x"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
