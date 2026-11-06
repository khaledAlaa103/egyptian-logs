// Single source of truth for the 11 main sections.
// `phase` = development phase in which the module becomes fully functional.
export const NAV_ITEMS = [
  { id: 'dashboard', path: '/', icon: 'grid', phase: 1 },
  { id: 'projects', path: '/projects', icon: 'folder', phase: 2 },
  { id: 'wells', path: '/wells', icon: 'well', phase: 2 },
  { id: 'import', path: '/import', icon: 'upload', phase: 3 },
  { id: 'viewer', path: '/viewer', icon: 'tracks', phase: 4 },
  { id: 'interpretation', path: '/interpretation', icon: 'flask', phase: 6 },
  { id: 'formations', path: '/formations', icon: 'layers', phase: 7 },
  { id: 'water', path: '/water', icon: 'drop', phase: 8 },
  { id: 'results', path: '/results', icon: 'table', phase: 7 },
  { id: 'reports', path: '/reports', icon: 'file', phase: 9 },
  { id: 'settings', path: '/settings', icon: 'gear', phase: 1 },
];
