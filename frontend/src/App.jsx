import { useState } from 'react';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import InstallPrompt from './components/InstallPrompt';
import Login from './screens/Login';
import Dashboard from './screens/Dashboard';
import AddUnit from './screens/AddUnit';
import Admin from './screens/Admin';
import { css, fonts } from './styles';

function Shell() {
  const { user, bootstrapping } = useAuth();
  const [screen, setScreen] = useState('dashboard');

  // A token exists but the user isn't hydrated yet (e.g. an impersonation tab
  // fetching /me). Hold a blank frame instead of flashing Login.
  if (bootstrapping) {
    return <div style={{ minHeight: '100vh', background: '#fff' }} />;
  }

  if (!user) return <Login />;

  // Staff (RM / manager / admin / viewer) all go to admin dashboard.
  // Viewers see the same UI but every action button is hidden — they have
  // read-only city-wide access.
  if (['rm', 'manager', 'admin', 'viewer'].includes(user.role)) {
    return <Admin />;
  }

  // CPs get original flow
  if (screen === 'addUnit') {
    return <AddUnit onDone={() => setScreen('dashboard')} />;
  }
  return <Dashboard onAdd={() => setScreen('addUnit')} />;
}

export default function App() {
  return (
    <AuthProvider>
      <style>{fonts}{css}</style>
      <Shell />
      <InstallPrompt />
    </AuthProvider>
  );
}