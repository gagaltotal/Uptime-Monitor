import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Setup from './pages/Setup';
import Dashboard from './pages/Dashboard';
import MonitorDetail from './pages/MonitorDetail';
import Incidents from './pages/Incidents';
import StatusPages from './pages/StatusPages';
import PublicStatusPage from './pages/PublicStatusPage';
import Settings from './pages/Settings';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public, unauthenticated */}
        <Route path="/status/:slug" element={<PublicStatusPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />

        {/* Authenticated dashboard */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/monitors/:id" element={<MonitorDetail />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/status-pages" element={<StatusPages />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>

        <Route path="*" element={<Login />} />
      </Routes>
    </AuthProvider>
  );
}
