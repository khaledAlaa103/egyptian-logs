import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './app/App.jsx';
import { PrefsProvider } from './app/PrefsContext.jsx';
import './design/tokens.css';
import './design/base.css';
import './design/layout.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PrefsProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </PrefsProvider>
  </React.StrictMode>
);
