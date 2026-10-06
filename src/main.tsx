// First, so the active scene follows every change to the saved settings from the start.
import { startScenes } from './state/scenes';
startScenes();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import { installTableColumnResize } from './utils/tableResize';
// Opens the project database and keeps link groups, capacities and settings in it.
import './db/dbSync';
import './db/uiSettingsSync';

installTableColumnResize();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
