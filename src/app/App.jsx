import { Routes, Route, Navigate } from 'react-router-dom';
import Shell from './Shell.jsx';
import { NAV_ITEMS } from './navigation.js';
import Dashboard from '../features/dashboard/Dashboard.jsx';
import Settings from '../features/settings/Settings.jsx';
import Projects from '../features/projects/Projects.jsx';
import Wells from '../features/wells/Wells.jsx';
import ImportPage from '../features/import/ImportPage.jsx';
import ModulePlaceholder from '../features/ModulePlaceholder.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/wells" element={<Wells />} />
        <Route path="/import" element={<ImportPage />} />
        {NAV_ITEMS.filter((n) => !['dashboard', 'settings', 'projects', 'wells', 'import'].includes(n.id)).map((n) => (
          <Route key={n.id} path={n.path} element={<ModulePlaceholder item={n} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
