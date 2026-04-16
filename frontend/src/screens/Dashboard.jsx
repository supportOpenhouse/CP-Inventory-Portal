import { useAuth } from '../contexts/AuthContext';

/**
 * Placeholder dashboard — Step 2.3 will add the real submissions list,
 * stats cards, and the FAB to add a new unit.
 */
export default function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <div className="header">
        <div>
          <div className="header-brand">
            open<span className="header-brand-accent">house</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
            Channel Partner Portal
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="header-user">
            <div className="header-avatar">{user.name?.[0] || '?'}</div>
            <span>{user.name?.split(' ')[0] || 'CP'}</span>
          </div>
          <button className="logout-btn" onClick={logout} title="Log out">⏻</button>
        </div>
      </div>

      <div style={{ padding: '14px 20px 6px', fontSize: 13, color: 'var(--oh-gray)', fontWeight: 500 }}>
        {user.cp_code} · {user.company || '—'} · {user.city || 'No city'}
      </div>

      <div className="section-title">Your Inventory</div>
      <div className="empty-state">
        <div className="empty-state-icon">🏠</div>
        <p>
          Dashboard is a placeholder for now.<br />
          Real submissions + Add Unit flow land in Step 2.3.
        </p>
      </div>
    </div>
  );
}
