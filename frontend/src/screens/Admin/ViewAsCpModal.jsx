import { useState } from 'react';

import { api, ApiError } from '../../api';
import CpSelector from './CpSelector';

/**
 * Admin "View as CP" picker. Pick a CP → mint a short-lived impersonation token
 * → open the CP's own app in a NEW TAB. That tab keeps the CP token in
 * sessionStorage (per-tab), so this admin session is untouched. The CP-side app
 * shows a "viewing as … impersonated by …" banner; every write is audited.
 */
export default function ViewAsCpModal({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async (cp) => {
    if (!cp || busy) return;
    setBusy(true);
    setError('');
    try {
      const { token } = await api.adminImpersonateCp(cp.id);
      // Token handed off via the URL hash; the new tab captures it into
      // sessionStorage and strips the hash on boot (see auth.js bootstrap).
      window.open('/?impersonate=1#it=' + encodeURIComponent(token), '_blank', 'noopener');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open CP view');
      setBusy(false);
    }
  };

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '60px 20px', backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, padding: 20, maxWidth: 440, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>👁 View as CP</div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', fontSize: 24, color: '#888', cursor: 'pointer', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>
          Opens the selected CP's own app in a new tab so you can see and act exactly as they do.
          Your admin session stays open in this tab.
        </div>
        <CpSelector value={null} onChange={start} city="" />
        {busy && <div style={{ marginTop: 12, fontSize: 13, color: '#666' }}>Opening…</div>}
        {error && (
          <div style={{
            marginTop: 12, padding: '8px 10px', background: '#FEF2F2', color: '#991B1B',
            border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13,
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
