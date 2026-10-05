import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBox, Spinner } from './components/ui';
import { PlayerProvider } from './lib/player';
import { useStatus } from './lib/queries';
import { HistoryPage } from './pages/History';
import { LoginPage } from './pages/Login';
import { NotConfiguredPage } from './pages/NotConfigured';
import { SettingsPage } from './pages/Settings';
import { ShowDetailPage } from './pages/ShowDetail';
import { ShowsPage } from './pages/Shows';
import { TodayPage } from './pages/Today';
import { WeekPage } from './pages/Week';

export function App() {
  const { data: status, error, isLoading, refetch } = useStatus();

  if (isLoading) {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  }
  if (error || !status) {
    return (
      <div className="center-screen">
        <ErrorBox error={error ?? 'Keine Verbindung zum Server'} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (!status.configured) return <NotConfiguredPage status={status} />;
  if (!status.authenticated) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage status={status} />} />
      </Routes>
    );
  }
  return (
    <PlayerProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<TodayPage />} />
          <Route path="woche" element={<WeekPage />} />
          <Route path="podcasts" element={<ShowsPage />} />
          <Route path="podcasts/:id" element={<ShowDetailPage />} />
          <Route path="verlauf" element={<HistoryPage />} />
          <Route path="einstellungen" element={<SettingsPage />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </PlayerProvider>
  );
}
