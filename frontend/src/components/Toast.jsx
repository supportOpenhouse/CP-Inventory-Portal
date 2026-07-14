/**
 * Global toast — one instance mounted in Layout. Any code (even non-React, e.g.
 * api.js) fires a bottom-center pill via `showToast(message, kind)`; it
 * auto-dismisses. Used to confirm a save landed (or failed) so the detail panel
 * can update optimistically instead of re-fetching to "confirm with the DB".
 */
import { useEffect, useState } from 'react';

export function showToast(message, kind = 'ok') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, kind } }));
}

export default function Toast() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let timer;
    const onToast = (e) => {
      setToast(e.detail);
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 2600);
    };
    window.addEventListener('app-toast', onToast);
    return () => { window.removeEventListener('app-toast', onToast); clearTimeout(timer); };
  }, []);

  if (!toast) return null;
  return (
    <div className={`toast${toast.kind === 'err' ? ' toast-err' : ''}`} role="status">
      {toast.message}
    </div>
  );
}
