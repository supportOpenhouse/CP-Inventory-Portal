import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
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
const Chat = lazy(() => import('./pages/Chat.jsx'));

const STAFF = ['admin', 'manager', 'rm', 'viewer'];

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
          <Route path="/chat" element={<RequireRole user={user} roles={['manager', 'rm']}><Chat /></RequireRole>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
