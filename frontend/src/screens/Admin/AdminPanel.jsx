import { useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '../../api';

/**
 * Admin Panel modal — staff user management. Admin-only.
 *
 * Features:
 *   - List staff users (admins from channel_partners + RMs/managers from rms)
 *   - Add new user (phone + name + role + optional email)
 *   - Toggle role between RM and Manager (within rms table only — moving
 *     someone between rms <-> channel_partners admin requires remove + re-add)
 *   - Toggle OH Properties access per user
 *   - Deactivate (soft-remove)
 *   - Force-logout one user, or force-logout ALL active staff
 *
 * Backend: see /admin/staff-users routes in backend/routes/admin.py.
 *
 * Props:
 *   onClose: () => void
 */
const ROLE_OPTIONS = [
  { value: 'rm',      label: 'RM' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin',   label: 'Admin' },
];

export default function AdminPanel({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Add User form
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('rm');

  // Force logout all confirmation
  const [confirmForceAll, setConfirmForceAll] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.adminListStaffUsers();
      setUsers(data?.users || []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load staff users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const handleAdd = async () => {
    setError('');
    if (!newName.trim() || !newPhone.trim()) {
      setError('Name and phone are required');
      return;
    }
    setSaving(true);
    try {
      await api.adminAddStaffUser({
        name: newName.trim(),
        phone: newPhone.trim(),
        role: newRole,
        email: newEmail.trim() || undefined,
      });
      setNewName(''); setNewPhone(''); setNewEmail(''); setNewRole('rm');
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add user');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (u, nextRole) => {
    if (u.role === nextRole) return;
    // Prevent moves that cross the rms <-> channel_partners boundary; backend
    // rejects them but warn here for clarity.
    const isAdmin = nextRole === 'admin';
    const isAdminCurrent = u.role === 'admin';
    if (isAdmin !== isAdminCurrent) {
      alert(
        "To move someone between Admin and RM/Manager, remove them first " +
        "and re-add. (Admins live in channel_partners; RMs/managers live in rms.)"
      );
      return;
    }
    try {
      await api.adminPatchStaffUser(u.source, u.id, { role: nextRole });
      await reload();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Update failed');
    }
  };

  const handleOhToggle = async (u, next) => {
    try {
      await api.adminPatchStaffUser(u.source, u.id, { can_see_oh_properties: next });
      await reload();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Update failed');
    }
  };

  const handleDeactivate = async (u) => {
    if (!confirm(`Deactivate ${u.name || u.phone}? They won't be able to log in.`)) return;
    try {
      await api.adminPatchStaffUser(u.source, u.id, { is_active: false });
      await reload();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Update failed');
    }
  };

  const handleReactivate = async (u) => {
    try {
      await api.adminPatchStaffUser(u.source, u.id, { is_active: true });
      await reload();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Update failed');
    }
  };

  const handleForceLogout = async (u) => {
    if (!confirm(`Force-logout ${u.name || u.phone}? Their next request will redirect them to login.`)) return;
    try {
      await api.adminForceLogoutUser(u.source, u.id);
      await reload();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Force logout failed');
    }
  };

  const handleForceLogoutAll = async () => {
    try {
      const res = await api.adminForceLogoutAll();
      alert(`Force-logout sent to ${res.logged_out_count} active staff. Including you — you'll be redirected to login on the next click.`);
      setConfirmForceAll(false);
      await reload();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Force-logout-all failed');
    }
  };

  // Group: active first, deactivated last
  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      const r = (a.role || '').localeCompare(b.role || '');
      if (r !== 0) return r;
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    });
  }, [users]);

  const activeCount = users.filter((u) => u.is_active).length;

  // ── styles (inline for self-containment) ──────────────────
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  };
  const modal = {
    background: '#fff', borderRadius: 8, width: '100%', maxWidth: 960,
    maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  };
  const header = {
    padding: '18px 24px', borderBottom: '1px solid #eee',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };
  const body = { padding: 24, overflow: 'auto', flex: 1 };
  const sectionTitle = {
    fontSize: 14, fontWeight: 700, marginBottom: 8,
    color: '#222', textTransform: 'uppercase', letterSpacing: 0.4,
  };
  const inputBase = {
    padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4,
    fontSize: 14, fontFamily: 'inherit',
  };
  const tableStyle = { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13, marginTop: 16 };
  const th = {
    textAlign: 'left', padding: '10px 12px',
    background: '#1a1a2e', color: '#fff',
    fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
  };
  const td = {
    padding: '10px 12px', verticalAlign: 'middle',
    borderBottom: '1px solid #F3F2EE',
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modal}>
        <div style={header}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Admin Panel</div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 0, fontSize: 22, cursor: 'pointer', color: '#666' }}
            aria-label="Close"
          >×</button>
        </div>

        <div style={body}>
          {error && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 4, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {/* Add User */}
          <div style={sectionTitle}>Add User</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.2fr 1.5fr 1fr auto', gap: 8, alignItems: 'center' }}>
            <input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={inputBase}
            />
            <input
              placeholder="10-digit phone"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              style={inputBase}
              inputMode="numeric"
            />
            <input
              placeholder="email (optional)"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={inputBase}
              type="email"
            />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)} style={inputBase}>
              {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              onClick={handleAdd}
              disabled={saving}
              style={{
                padding: '8px 16px', border: 0, borderRadius: 4,
                background: saving ? '#ccc' : '#1a1a2e', color: '#fff',
                fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}
            >Add User</button>
          </div>

          {/* Users list header + force logout all */}
          <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={sectionTitle}>Current Staff Users ({activeCount} active{users.length > activeCount ? `, ${users.length - activeCount} inactive` : ''})</div>
            {confirmForceAll ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#991b1b', fontWeight: 600 }}>
                  Are you sure? This logs out <em>everyone</em>, including you.
                </span>
                <button
                  onClick={handleForceLogoutAll}
                  style={{ padding: '6px 12px', border: 0, borderRadius: 4, background: '#DC2626', color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >Yes, logout all</button>
                <button
                  onClick={() => setConfirmForceAll(false)}
                  style={{ padding: '6px 12px', border: '1px solid #ddd', background: '#fff', borderRadius: 4, fontFamily: 'inherit', cursor: 'pointer' }}
                >Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmForceAll(true)}
                style={{
                  padding: '6px 12px', border: '1px solid #DC2626',
                  background: '#fff', color: '#DC2626', borderRadius: 4,
                  fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >🔒 Force logout all</button>
            )}
          </div>

          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Roles: <strong>RM</strong> = relationship manager, scope = own CPs · <strong>Manager</strong> = own + team CPs · <strong>Admin</strong> = full access.
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading…</div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={th}>Name / Phone</th>
                  <th style={th}>Role</th>
                  <th style={th}>OH Properties</th>
                  <th style={th}>Status</th>
                  <th style={th}>Force Logout</th>
                  <th style={th}>Last Logout</th>
                  <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#999', padding: 30 }}>
                      No staff users yet. Add one above.
                    </td>
                  </tr>
                ) : (
                  sortedUsers.map((u) => (
                    <tr key={`${u.source}-${u.id}`} style={{ background: u.is_active ? '#fff' : '#f7f7f7', opacity: u.is_active ? 1 : 0.6 }}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{u.name || '—'}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>
                          {u.phone || '—'}{u.email ? ` · ${u.email}` : ''}
                        </div>
                      </td>
                      <td style={td}>
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value)}
                          disabled={!u.is_active}
                          style={{ ...inputBase, fontSize: 13 }}
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={td}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={u.can_see_oh_properties}
                            onChange={(e) => handleOhToggle(u, e.target.checked)}
                            disabled={!u.is_active}
                          />
                          <span style={{ fontSize: 13 }}>{u.can_see_oh_properties ? 'Allowed' : 'Blocked'}</span>
                        </label>
                      </td>
                      <td style={td}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 3,
                          fontSize: 11, fontWeight: 700,
                          background: u.is_active ? '#ECFDF5' : '#FEE2E2',
                          color:      u.is_active ? '#065F46' : '#991b1b',
                        }}>{u.is_active ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td style={td}>
                        <button
                          onClick={() => handleForceLogout(u)}
                          disabled={!u.is_active}
                          style={{
                            padding: '4px 10px', borderRadius: 3, fontSize: 12,
                            border: '1px solid #DC2626', background: '#fff', color: '#DC2626',
                            cursor: u.is_active ? 'pointer' : 'not-allowed',
                            fontFamily: 'inherit', fontWeight: 600,
                            opacity: u.is_active ? 1 : 0.4,
                          }}
                        >Logout</button>
                      </td>
                      <td style={{ ...td, fontSize: 11, color: '#888' }}>
                        {u.force_logout_at ? new Date(u.force_logout_at).toLocaleString() : '—'}
                      </td>
                      <td style={td}>
                        {u.is_active ? (
                          <button
                            onClick={() => handleDeactivate(u)}
                            style={{
                              padding: '4px 10px', borderRadius: 3, fontSize: 12,
                              border: '1px solid #ddd', background: '#fff', color: '#444',
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >Remove</button>
                        ) : (
                          <button
                            onClick={() => handleReactivate(u)}
                            style={{
                              padding: '4px 10px', borderRadius: 3, fontSize: 12,
                              border: '1px solid #1a1a2e', background: '#1a1a2e', color: '#fff',
                              cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                            }}
                          >Re-activate</button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
