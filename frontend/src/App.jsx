import { useState } from 'react';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import InstallPrompt from './components/InstallPrompt';
import Login from './screens/Login';
import Dashboard from './screens/Dashboard';
import AddUnit from './screens/AddUnit';
import Admin from './screens/Admin';
import { css, fonts } from './styles';

function Shell() {
  const { user } = useAuth();
  const [screen, setScreen] = useState('dashboard');

  if (!user) return <Login />;

  // Staff (RM + admin) go to admin dashboard
  if (user.role === 'rm' || user.role === 'admin') {
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