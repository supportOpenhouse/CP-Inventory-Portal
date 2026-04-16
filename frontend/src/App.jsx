import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './screens/Login';
import Dashboard from './screens/Dashboard';
import { css, fonts } from './styles';

function Shell() {
  const { user } = useAuth();
  return user ? <Dashboard /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <style>{fonts}{css}</style>
      <Shell />
    </AuthProvider>
  );
}
