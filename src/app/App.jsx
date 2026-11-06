import { Routes, Route, Navigate } from 'react-router-dom';
import Shell from './Shell.jsx';
import { NAV_ITEMS } from './navigation.js';
import Dashboard from '../features/dashboard/Dashboard.jsx';
import Settings from '../features/settings/Settings.jsx';
import Projects from '../features/projects/Projects.jsx';
import Wells from '../features/wells/Wells.jsx';
import ImportPage from '../features/import/ImportPage.jsx';
import ViewerPage from '../features/viewer/ViewerPage.jsx';
import InterpretationPage from '../features/interpretation/InterpretationPage.jsx';
import ResultsPage from '../features/results/ResultsPage.jsx';
import FormationsPage from '../features/formations/FormationsPage.jsx';
import WaterPage from '../features/water/WaterPage.jsx';
import ReportsPage from '../features/reports/ReportsPage.jsx';
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
        <Route path="/viewer" element={<ViewerPage />} />
        <Route path="/interpretation" element={<InterpretationPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/water" element={<WaterPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/formations" element={<FormationsPage />} />
        {NAV_ITEMS.filter((n) => !['dashboard', 'settings', 'projects', 'wells', 'import', 'viewer', 'interpretation', 'results', 'formations', 'water', 'reports'].includes(n.id)).map((n) => (
          <Route key={n.id} path={n.path} element={<ModulePlaceholder item={n} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
