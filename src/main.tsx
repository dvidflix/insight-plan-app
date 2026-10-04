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
