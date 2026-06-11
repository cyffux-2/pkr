import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
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

const PAGE_TITLES: Record<string, string> = {
  '/': 'PKR - Connexion',
  '/pkr': 'PKR - Connexion',
  '/login': 'PKR - Connexion',
  '/register': 'PKR - Creation de compte',
  '/home': 'PKR - Accueil',
  '/settings': 'PKR - Parametres',
  '/forgot-password': 'PKR - Recuperation du mot de passe',
  '/reset-password': 'PKR - Nouveau mot de passe',
  '/auth/callback': 'PKR - Connexion en cours',
  '/tournaments': 'PKR - Tournois',
  '/sng': 'PKR - Sit&Go',
  '/trio': 'PKR - Triple',
  '/headup': 'PKR - HeadUp',
  '/stats': 'PKR - Statistiques',
  '/lobby': 'PKR - Lobby',
  '/leaderboard': 'PKR - Classement',
};

function getPageTitle(pathname: string) {
  if (pathname.startsWith('/game/')) return 'PKR - Table';
  if (pathname.startsWith('/tournament-lobby/')) return 'PKR - Lobby tournoi';
  return PAGE_TITLES[pathname] ?? 'PKR - Poker en ligne';
}

function PageTitle() {
  const location = useLocation();

  useEffect(() => {
    document.title = getPageTitle(location.pathname);
  }, [location.pathname]);

  return null;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <PageTitle />
      <TableTurnAutoSwitcher />
      <Routes>
        {/* Pages sans Navbar */}
        <Route path="/"               element={<Login />} />
        <Route path="/pkr"            element={<Navigate to="/login" replace />} />
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
