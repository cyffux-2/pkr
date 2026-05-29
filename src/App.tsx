import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ActiveTablesPreloader } from './components/ActiveTablesPreloader';
import { TableTurnAutoSwitcher } from './components/TableTurnAutoSwitcher';
import Layout from './components/layout/Layout';
import Home from './pages/HomeModule/Home';
import Settings from './pages/SettingsModule/Settings';
import Lobby from './pages/Lobby';
import Game from './pages/Game';
import Sng from './pages/Sng';
import Trio from './pages/Trio';
import Headup from './pages/Headup';
import Tournaments from './pages/Tournaments';
import TournamentLobby from './pages/TournamentLobby';
import Stats from './pages/Stats';
import Leaderboard from './pages/Leaderboard';
import Login from './pages/LoginModule/Login';
import Register from './pages/LoginModule/Register';
import ForgotPassword from './pages/LoginModule/ForgotPassword';
import ResetPassword from './pages/LoginModule/ResetPassword';
import AuthCallback from './pages/LoginModule/AuthCallback';
import NotFound from './pages/NotFound';

function getRouterBaseName() {
  const publicUrl = process.env.PUBLIC_URL ?? '';
  if (!publicUrl) return undefined;

  try {
    const parsed = new URL(publicUrl);
    return parsed.pathname === '/' ? undefined : parsed.pathname;
  } catch {
    return publicUrl;
  }
}

function AppRoutes() {
  return (
    <BrowserRouter basename={getRouterBaseName()}>
      <TableTurnAutoSwitcher />
      <Routes>
        {/* Pages sans Navbar */}
        <Route path="/"               element={<Login />} />
        <Route path="/home"           element={<Home />} />
        <Route path="/settings"       element={<Settings />} />
        <Route path="/login"          element={<Login />} />
        <Route path="/register"       element={<Register />} />
        <Route path="/confirm-email"  element={<Navigate to="/home" replace />} />
        <Route path="/auth/callback"  element={<AuthCallback />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/tournaments"    element={<Tournaments />} />
        <Route path="/sng"            element={<Sng />} />
        <Route path="/trio"           element={<Trio />} />
        <Route path="/headup"         element={<Headup />} />
        <Route path="/stats"          element={<Stats />} />
        <Route path="/tournament-lobby/:tournamentId" element={<TournamentLobby />} />
        <Route path="/game/:tableId"  element={<Game />} />

        {/* Pages avec Navbar */}
        <Route path="/*" element={
          <Layout>
            <Routes>
              <Route path="/lobby"          element={<Lobby />} />
              <Route path="/leaderboard"    element={<Leaderboard />} />
              <Route path="*"              element={<NotFound />} />
            </Routes>
          </Layout>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ActiveTablesPreloader />
      <AppRoutes />
    </AuthProvider>
  );
}
