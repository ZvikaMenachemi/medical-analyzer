import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useDbStore } from './store/dbStore';
import AppShell from './components/layout/AppShell';
import ImportPage    from './pages/ImportPage';
import ResultsPage   from './pages/ResultsPage';
import GraphsPage    from './pages/GraphsPage';
import DashboardPage from './pages/DashboardPage';
import GroupsPage    from './pages/GroupsPage';
import SettingsPage  from './pages/SettingsPage';

export default function App() {
  const { ready, error, init } = useDbStore();

  useEffect(() => { init(); }, []);

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: '#c0392b' }}>
        <h2>שגיאה בטעינת בסיס הנתונים</h2>
        <p style={{ marginTop: 8, fontSize: 13, color: '#666' }}>{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#7f8c8d' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🩺</div>
          <div>טוען...</div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/import" replace />} />
          <Route path="/import"    element={<ImportPage />} />
          <Route path="/results"   element={<ResultsPage />} />
          <Route path="/graphs"    element={<GraphsPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/groups"    element={<GroupsPage />} />
          <Route path="/settings"  element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
