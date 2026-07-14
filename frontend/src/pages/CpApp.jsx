import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../contexts/AuthContext.jsx';
import { clearSession } from '../auth';
import Dashboard from '../cp/Dashboard.jsx';
import AddUnit from '../cp/AddUnit/index.jsx';
import Profile from '../cp/Profile.jsx';
import Messages from '../cp/Messages.jsx';
import { IconHome, IconPhone, IconPlus, IconChat, IconUsers } from '../components/icons.jsx';
import { useUnreadChat } from '../hooks/useUnreadChat';

export default function CpApp() {
  const { user } = useAuth();
  const [screen, setScreen] = useState('dashboard');
  // RM lives here (not in Dashboard) so the persistent strip's Call button and
  // the Profile screen share one lookup. No fallback number — the Call button
  // stays inert (href undefined) until getMyRm resolves a real RM phone.
  const [rmPhone, setRmPhone] = useState('');
  const [rmName, setRmName] = useState('Openhouse RM');

  useEffect(() => {
    let alive = true;
    api.getMyRm()
      .then((data) => {
        const rm = data?.rm;
        if (alive && rm?.phone) { setRmPhone(rm.phone); setRmName(rm.name || 'Openhouse RM'); }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const unread = useUnreadChat();
  const goHome = () => setScreen('dashboard');

  return (
    <div className="app-shell-cp">
      {/* Only show the impersonation banner in a standalone tab — when embedded
          in the Impersonator's iframe the exit/identity live in that page. */}
      {user?.impersonated_by && window.self === window.top && (
        <div className="imp-banner">
          👁 Viewing as {user.name} · impersonated by {user.impersonated_by.name || user.impersonated_by.cp_code}
          <button className="btn-link" onClick={() => { clearSession(); window.location.assign('/'); }}>Exit</button>
        </div>
      )}

      {screen === 'addUnit' ? (
        <AddUnit onDone={goHome} />
      ) : screen === 'profile' ? (
        <Profile onBack={goHome} rmPhone={rmPhone} rmName={rmName} />
      ) : screen === 'messages' ? (
        <Messages onBack={goHome} />
      ) : (
        <Dashboard rmPhone={rmPhone} />
      )}

      {/* Persistent bottom strip — always visible: Home · Call · +Add · Messages(soon) · Profile */}
      <nav className="cp-bottombar">
        <button type="button" className={`cp-nav${screen === 'dashboard' ? ' active' : ''}`} onClick={goHome} title="Home">
          <span className="cp-nav-ic"><IconHome size={22} /></span>
          <span className="cp-nav-lbl">Home</span>
        </button>

        <a className="cp-nav" href={rmPhone ? `tel:${rmPhone.replace(/\D/g, '')}` : undefined} title={`Call ${rmName || 'your RM'}`}>
          <span className="cp-nav-ic"><IconPhone size={22} /></span>
          <span className="cp-nav-lbl">Call</span>
        </a>

        <button type="button" className="cp-nav-add" onClick={() => setScreen('addUnit')} title="Add Inventory" aria-label="Add Inventory">
          <IconPlus size={28} />
        </button>

        <button type="button" className={`cp-nav${screen === 'messages' ? ' active' : ''}`} onClick={() => setScreen('messages')} title="Messages">
          <span className="cp-nav-ic">
            <IconChat size={22} />
            {unread > 0 && screen !== 'messages' && (
              <span className="cp-nav-badge">{unread > 99 ? '99+' : unread}</span>
            )}
          </span>
          <span className="cp-nav-lbl">Messages</span>
        </button>

        <button type="button" className={`cp-nav${screen === 'profile' ? ' active' : ''}`} onClick={() => setScreen('profile')} title="Profile">
          <span className="cp-nav-ic"><IconUsers size={22} /></span>
          <span className="cp-nav-lbl">Profile</span>
        </button>
      </nav>
    </div>
  );
}
