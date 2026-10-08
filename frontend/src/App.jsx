import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Submissions from './pages/Submissions.jsx';
import CpApp from './pages/CpApp.jsx';
import DotLoader from './components/DotLoader.jsx';

const Impersonator = lazy(() => import('./pages/Impersonator.jsx'));
const Logs = lazy(() => import('./pages/Logs.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Tickets = lazy(() => import('./pages/Tickets.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
// CHAT REMOVED 2026-10-08 — CometChat retired; page lives in src/_disabled/chat/.
// const Chat = lazy(() => import('./pages/Chat.jsx'));

const STAFF = ['admin', 'manager', 'rm', 'viewer'];

// Shareable deep link: /OHLGHC0009 opens that submission's detail popup.
// public_id is OHL + city letter(s) + C + digits (OHLNC0091 / OHLGC0537 /
// OHLGHC0009 — see backend/public_id.py). Anything that doesn't match falls
// through to the catch-all home redirect, so a typo'd path behaves as before.
const PUBLIC_ID_RE = /^OHL[A-Z]{1,2}C\d+$/i;

function PublicIdRoute() {
  const { publicId } = useParams();
  if (!PUBLIC_ID_RE.test(publicId || '')) return <Navigate to="/" replace />;
  // Hand off to Submissions rather than re-hosting the modal here: that page
  // already owns CardDetailModal and the board behind it. `replace` keeps the
  // bare link out of history, so closing the modal doesn't bounce back into
  // this redirect.
  return <Navigate to={`/submissions?open=${encodeURIComponent(publicId.toUpperCase())}`} replace />;
}

// roles=undefined → any authenticated staff; roles=[] → admin only;
// roles=[...] → those roles (admin always passes).
function RequireRole({ user, roles, children }) {
  if (roles && !roles.includes(user.role) && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  const { user, bootstrapping } = useAuth();
  // Bouncing-dots loader during the session probe + while a lazy route chunk
  // loads — the two most visible loading moments.
  const pageLoader = (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'grid', placeItems: 'center' }}>
      <DotLoader />
    </div>
  );
  if (bootstrapping) return pageLoader;
  if (!user) return <Login />;
  if (!STAFF.includes(user.role)) return <CpApp />;   // role === 'cp'

  return (
    <Suspense fallback={pageLoader}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/submissions" element={<Submissions />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/tickets" element={<RequireRole user={user} roles={['manager', 'rm']}><Tickets /></RequireRole>} />
          <Route path="/impersonator" element={<RequireRole user={user} roles={[]}><Impersonator /></RequireRole>} />
          <Route path="/users" element={<RequireRole user={user} roles={[]}><Users /></RequireRole>} />
          <Route path="/logs" element={<RequireRole user={user} roles={[]}><Logs /></RequireRole>} />
          {/* CHAT REMOVED 2026-10-08 — /chat now falls through to the catch-all home redirect. */}
          {/* <Route path="/chat" element={<RequireRole user={user} roles={['manager', 'rm']}><Chat /></RequireRole>} /> */}
        </Route>
        {/* Single-segment catch-all, ranked BELOW every static route above
            (React Router scores static segments higher), so /submissions and
            friends are unaffected. */}
        <Route path="/:publicId" element={<PublicIdRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
