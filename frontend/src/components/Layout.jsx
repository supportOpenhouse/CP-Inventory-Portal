import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import BusyOverlay from './BusyOverlay.jsx';
import PageTransition from './PageTransition.jsx';
import Toast from './Toast.jsx';
import CreateTicketButton from './tickets/CreateTicketButton.jsx';
import { useUnreadChat } from '../hooks/useUnreadChat';
import {
  IconHome, IconBoard, IconEye, IconTicket, IconLogs, IconUsers, IconProfile,
  IconSun, IconMoon, IconMenu, IconLogout, IconChevron, IconPlus, IconChat, IconMegaphone,
} from './icons.jsx';

const TITLES = {
  '': 'Home', submissions: 'Submissions', impersonator: 'Impersonator',
  tickets: 'Tickets', logs: 'Activity Logs',
  users: 'Users', profile: 'My Profile', chat: 'Chat',
};

function initials(name, phone) {
  const s = (name || phone || '').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase() || '?';
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('oh_sidebar_collapsed') === '1');
  const [ticketDot, setTicketDot] = useState(0);

  const role = user?.role;
  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const canTickets = role === 'admin' || role === 'manager' || role === 'rm';
  const canAct = canTickets; // admin/manager/rm can perform actions (adds on behalf, etc.)
  // Number of CPs with unread chat — drives the count on the Chat nav icon.
  const chatUnread = useUnreadChat({ people: true, enabled: canTickets });

  // Poll "needs my action" ticket count for the nav dot (skip for roles with no
  // ticket access). 15s while visible; on focus; on local ticket mutations.
  useEffect(() => {
    if (!canTickets) return undefined;
    let alive = true;
    const refresh = () => api.ticketsPendingCount()
      .then((r) => { if (alive) setTicketDot(r?.count || 0); })
      .catch(() => {});
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('tickets:changed', refresh);
    return () => {
      alive = false; clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('tickets:changed', refresh);
    };
  }, [canTickets]);

  const seg = loc.pathname.split('/')[1] || '';
  const title = TITLES[seg] || 'CP Inventory';

  function toggleCollapse() {
    setCollapsed((c) => { const n = !c; localStorage.setItem('oh_sidebar_collapsed', n ? '1' : '0'); return n; });
  }

  const navItem = ({ to, label, Icon, end, count = 0 }) => {
    const show = count > 0;
    return (
      <NavLink key={to} to={to} end={end}
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        onClick={() => setMobileOpen(false)} title={collapsed ? label : undefined}>
        <span className="nav-ic"><Icon />{show && <span className="nav-dot" />}</span>
        <span className="nav-label">{label}</span>
        {show && <span className="nav-count">{count > 99 ? '99+' : count}</span>}
      </NavLink>
    );
  };

  return (
    <div className={`app-shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/openhouse-logo.png" alt="" className="brand-logo" />
          <div className="brand-text">
            <div className="brand-name">Openhouse</div>
            <div className="brand-sub">CP Inventory</div>
          </div>
        </div>
        <button className="sidebar-collapse-btn" onClick={toggleCollapse} aria-label="Toggle sidebar">
          <span className="scb-chev"><IconChevron size={16} /></span>
          <span className="scb-label">Collapse</span>
        </button>

        {navItem({ to: '/', label: 'Home', Icon: IconHome, end: true })}
        {navItem({ to: '/submissions', label: 'Submissions', Icon: IconBoard })}
        {canTickets && navItem({ to: '/tickets', label: 'Tickets', Icon: IconTicket, count: ticketDot })}
        {canTickets && navItem({ to: '/chat', label: 'Chat', Icon: IconChat, count: chatUnread })}

        {isAdmin && (
          <>
            <div className="sidebar-section-label">Admin</div>
            {navItem({ to: '/impersonator', label: 'Impersonator', Icon: IconEye })}
            {navItem({ to: '/users', label: 'Users', Icon: IconUsers })}
            {navItem({ to: '/logs', label: 'Logs', Icon: IconLogs })}
          </>
        )}

        <div className="nav-spacer" />
        <div className="sidebar-foot">
          <button type="button" className="sidebar-user" onClick={() => { nav('/profile'); setMobileOpen(false); }} title="My profile">
            <span className="avatar">{initials(user?.name, user?.phone)}</span>
            <div className="su-text">
              <div className="su-name">{user?.name || user?.phone}</div>
              <div className="su-role">{role}</div>
            </div>
          </button>
        </div>
      </aside>

      {mobileOpen && <div className="modal-backdrop" style={{ zIndex: 400 }} onClick={() => setMobileOpen(false)} />}
      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn topbar-menu" onClick={() => setMobileOpen(true)} aria-label="Menu"><IconMenu /></button>
          <h1>{title}</h1>
          <div className="topbar-spacer" />
          {/* Portal slot: pages inject their own topbar action buttons here so
              they keep their live state (see Submissions' Select / CSV). */}
          <div id="topbar-actions" className="topbar-actions" />
          {seg === 'tickets' && (isAdmin || isManager) && <CreateTicketButton />}
          {seg === 'submissions' && canAct && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.dispatchEvent(new Event('submissions:add-inventory'))}
            >
              <IconPlus size={15} /> Add Inventory
            </button>
          )}
          {seg === 'chat' && isAdmin && (
            <>
              <button type="button" className="btn-soft" onClick={() => window.dispatchEvent(new Event('chat:broadcast'))} title="Broadcast — mass message CPs">
                <IconMegaphone size={15} /> Broadcast
              </button>
              <button type="button" className="btn-soft" onClick={() => window.dispatchEvent(new Event('chat:manage'))} title="Manage chat users">
                <IconUsers size={15} /> Manage users
              </button>
            </>
          )}
          {/* Theme toggle + logout live only on the profile page. */}
          {seg === 'profile' && (
            <>
              <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">
                {theme === 'dark' ? <IconSun /> : <IconMoon />}
              </button>
              <button className="icon-btn" onClick={logout} aria-label="Logout" title="Logout"><IconLogout /></button>
            </>
          )}
        </header>
        <main className="main"><PageTransition /></main>
      </div>
      <BusyOverlay />
      <Toast />
    </div>
  );
}
