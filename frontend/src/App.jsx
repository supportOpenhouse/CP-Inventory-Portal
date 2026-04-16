import { useState } from 'react';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './screens/Login';
import Dashboard from './screens/Dashboard';
import AddUnit from './screens/AddUnit';
import { css, fonts } from './styles';

function Shell() {
  const { user } = useAuth();
  const [screen, setScreen] = useState('dashboard');

  if (!user) return <Login />;
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
    </AuthProvider>
  );
}