import { useState, type ReactNode } from 'react';
import { useProjectDbStore } from '../state/projectDbStore';
import { useWebFolderStore } from './folderStore';
import { FREE_MODE } from '../licence/freeMode';
import { WebFolderChooser } from '../components/ProjectDbPanel';

/** The browser edition starts here until a project folder is open, so work is never kept only in memory by accident.
    A returning user opens the folder they used last time with one click (the browser asks permission again each session). */
export function ProjectGate({ children }: { children: ReactNode }) {
  const root = useProjectDbStore((s) => s.root);
  const remembered = useWebFolderStore((s) => s.remembered);
  const [withoutSaving, setWithoutSaving] = useState(false);
  if (FREE_MODE || root || withoutSaving) return <>{children}</>;
  return (
    <main style={{ maxWidth: 560, margin: '12vh auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22 }}>Open your project</h1>
      <p>
        {remembered ? <>Last time you used <b>{remembered.name}</b>. Allow it again to bring back your programmes and models.</> : <>Choose the folder your project is kept in. Programmes, link groups and models are saved there, and come back next time.</>}
      </p>
      <WebFolderChooser busy={false} />
      <p style={{ marginTop: 24 }}>
        <button type="button" className="btn" onClick={() => setWithoutSaving(true)}>Continue without saving</button>
        <span style={{ marginLeft: 8, opacity: 0.7 }}>Nothing is kept when you close the page.</span>
      </p>
    </main>
  );
}
