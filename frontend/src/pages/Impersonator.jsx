import { useState } from 'react';
import { api } from '../api';
import CpSelector from '../components/CpSelector.jsx';
import { IconMobile, IconEye } from '../components/icons.jsx';

export default function Impersonator() {
  const [embed, setEmbed] = useState(null); // { picked, token } — embedded CP view
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function open(picked) {
    setError(null);
    setBusy(true);
    try {
      const { token } = await api.adminImpersonateCp(picked.id);
      // Embedded, in-memory token only — never touches the shared sessionStorage,
      // so this admin session stays intact (see auth.js). Actions are audited.
      setEmbed({ picked, token });
    } catch (e) {
      setError(e?.data?.error || 'Could not start impersonation');
    } finally {
      setBusy(false);
    }
  }

  function openNewTab() {
    if (!embed) return;
    const w = window.open(`/?impersonate=1#it=${encodeURIComponent(embed.token)}`, '_blank');
    if (w) { try { w.opener = null; } catch { /* harmless */ } }
  }

  return (
    <div className="imp-stage">
      {/* Left: the always-on CP picker, then who you're viewing + exit beneath. */}
      <aside className="imp-side imp-side-left">
        <div className="card-block">
          <div className="imp-picker-label">Pick a channel partner</div>
          <CpSelector city="" onSelect={open} />
          {busy && <div style={{ marginTop: 10 }}><span className="inv-skel" style={{ display: 'inline-block', width: 120, height: 12 }} /></div>}
          {error && <div className="modal-error" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        {embed && (
          <>
            <div className="imp-identity card-block">
              <div className="imp-identity-eye"><IconEye size={22} /></div>
              <div className="imp-identity-label muted">Viewing as</div>
              <div className="imp-identity-name">{embed.picked.name}</div>
              <div className="imp-identity-meta muted">{embed.picked.cp_code}</div>
              <div className="imp-identity-meta muted">{embed.picked.phone}</div>
              <button type="button" className="btn-soft imp-exit" onClick={() => setEmbed(null)}>← Exit view</button>
            </div>
            <button type="button" className="btn-ghost imp-newtab" onClick={openNewTab}>Open in new tab</button>
          </>
        )}
      </aside>

      {/* Center: the phone — always shown. */}
      <div className="imp-frame-wrap">
        {embed ? (
          <iframe
            key={embed.token}
            title={`CP view — ${embed.picked.name}`}
            src={`/?impersonate=1#it=${encodeURIComponent(embed.token)}`}
            className="imp-frame"
          />
        ) : (
          <div className="imp-frame-empty muted">
            <span className="imp-frame-empty-icon"><IconMobile size={40} /></span>
            Pick a channel partner to preview their app here.
          </div>
        )}
      </div>

      {/* Right: resize hint. */}
      <aside className="imp-side imp-side-right">
        <div className="imp-frame-hint muted">Drag the bottom-right corner to resize the phone. Every action is audited to you.</div>
      </aside>
    </div>
  );
}
