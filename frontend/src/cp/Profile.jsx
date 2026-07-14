/**
 * CP profile screen — opened from the bottom strip's Profile slot. Shows the
 * channel partner's own details, their assigned Openhouse RM (with a call
 * shortcut), and a log-out action. Read-only; CPs can't edit their identity
 * here (that stays with admin), matching the frozen API surface.
 */
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext.jsx';
import ConfirmDialog from '../components/ConfirmDialog';
import LegalLinks from '../components/LegalLinks';
import { IconPhone, IconLogout, IconChevron, IconSun, IconMoon } from '../components/icons.jsx';

function Row({ label, value }) {
  return (
    <div className="prof-row">
      <span className="prof-lbl">{label}</span>
      <span className="prof-val">{value || '—'}</span>
    </div>
  );
}

export default function Profile({ onBack, rmPhone, rmName }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [showLogout, setShowLogout] = useState(false);

  const initials = (user.name || 'CP').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase() || 'CP';
  const rmDigits = rmPhone ? String(rmPhone).replace(/\D/g, '') : null;
  const rmLocal = rmPhone ? String(rmPhone).replace(/^\+?91/, '') : null;

  return (
    <div className="cp-shell">
      <div className="header" style={{ gap: 12 }}>
        <button className="back-btn" onClick={onBack} aria-label="Back">
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}><IconChevron size={20} /></span>
        </button>
        <div>Profile</div>
        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={toggle} aria-label="Toggle dark mode" title="Toggle dark mode">
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </div>

      <div className="prof-hero">
        <div className="prof-avatar">{initials}</div>
        <div className="prof-name">{user.name || 'Channel Partner'}</div>
        <div className="prof-sub">{user.cp_code}{user.company ? ` · ${user.company}` : ''}</div>
      </div>

      <div className="section-title">Your details</div>
      <div className="form-card prof-card">
        <Row label="Name" value={user.name} />
        <Row label="Phone" value={user.phone ? `+91 ${user.phone}` : null} />
        <Row label="CP Code" value={user.cp_code} />
        <Row label="Company" value={user.company} />
        <Row label="City" value={user.city} />
      </div>

      <div className="section-title">Your Openhouse RM</div>
      <div className="form-card prof-card">
        {rmDigits ? (
          <>
            <Row label="Name" value={rmName} />
            <Row label="Phone" value={rmLocal ? `+91 ${rmLocal}` : null} />
            <a className="primary-btn prof-call" href={`tel:${rmDigits}`}>
              <IconPhone size={18} /> Call RM
            </a>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>No RM assigned yet.</div>
        )}
      </div>

      <div style={{ padding: '4px 20px 12px' }}>
        <button className="secondary-btn prof-logout" onClick={() => setShowLogout(true)}>
          <IconLogout size={18} /> Log out
        </button>
      </div>

      <div style={{ padding: '0 20px 32px' }}>
        <LegalLinks prefix="" />
      </div>

      <ConfirmDialog
        open={showLogout}
        title="Log out?"
        message="You'll need to sign in again to view or add your listings."
        confirmLabel="Log out"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => { setShowLogout(false); logout(); }}
        onCancel={() => setShowLogout(false)}
      />
    </div>
  );
}
