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
import { FEATURES } from './features';
import { useProjectDbStore } from './state/projectDbStore';
import { useWebFolderStore } from './web/folderStore';

installTableColumnResize();

async function start() {
  if (FEATURES.browserData) {
    // The browser edition: the project database is answered in this browser, in the folder the user chose last time.
    const web = await import('./web/client');
    web.installLocalApi();
    const folder = location.search.includes('opfs') ? await web.useBrowserStorage().then((f) => ({ ...f, ready: true })) : await web.restoreProjectFolder();
    useWebFolderStore.setState({ remembered: folder });
    useProjectDbStore.setState({ root: folder?.ready ? folder.root : '' });
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
