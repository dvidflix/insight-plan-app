import { useEffect, useRef, useState } from 'react';

/** Top bar of the packaged app: "Update available" once a newer, signed version has been downloaded in the background
    (server/packageUpdater.ts). "Restart and update" restarts the app; this page waits for the new version to answer, then
    reloads. Starting the app again later installs it too. */

interface UpdateStatus {
  configured: boolean;
  current: { version: string };
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  available: { version: string; published: string; notes: string[]; requiresFullInstall: boolean } | null;
  error: string | null;
}

const CHECK_EVERY = 30 * 60 * 1000;

async function getStatus(check: boolean): Promise<UpdateStatus | null> {
  try {
    const res = await fetch(`/api/app/version${check ? '?check=1' : ''}`);
    return res.ok ? ((await res.json()) as UpdateStatus) : null;
  } catch {
    return null;
  }
}

export function PackageUpdateChip() {
  const [info, setInfo] = useState<UpdateStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' | 'updating' | 'error'; text?: string }>({ kind: 'idle' });
  const boxRef = useRef<HTMLDivElement>(null);
  const phase = info?.phase;

  useEffect(() => {
    const check = () => void getStatus(true).then((v) => v && setInfo(v));
    const first = setTimeout(check, 5000);
    const every = setInterval(check, CHECK_EVERY);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  // While the app looks or downloads, ask again soon, so "ready" shows without waiting half an hour.
  useEffect(() => {
    if (phase !== 'checking' && phase !== 'downloading') return;
    const t = setInterval(() => void getStatus(false).then((v) => v && setInfo(v)), 4000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const restart = async () => {
    if (!info) return;
    setState({ kind: 'updating', text: 'Installing the update and restarting…' });
    try {
      const res = await fetch('/api/app/update', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Update failed (${res.status}).`);
      const from = info.current.version;
      const started = Date.now();
      const poll = async () => {
        const v = await getStatus(false);
        if (v && v.current.version && v.current.version !== from) return window.location.reload();
        if (Date.now() - started > 3 * 60 * 1000) {
          setState({ kind: 'error', text: 'The app did not come back after updating. Look at the black Insight Plan window, or start it again from its shortcut.' });
          return;
        }
        setTimeout(poll, 2000);
      };
      setTimeout(poll, 4000);
    } catch (e) {
      setState({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const a = info?.available;
  if (!a) return null;
  const ready = info?.phase === 'ready';
  if (!ready && !a.requiresFullInstall) {
    // Found, still downloading: a quiet chip, no action yet.
    return info?.phase === 'downloading' ? <div className="update-chip"><span className="update-chip__note">Downloading update {a.version}…</span></div> : null;
  }
  return (
    <div className="update-chip" ref={boxRef}>
      <button type="button" className="update-chip__btn" onClick={() => setOpen((v) => !v)} title={`Version ${a.version} of Insight Plan is available`}>
        <span className="update-chip__dot" aria-hidden="true" />
        Update available
      </button>
      {open && (
        <div className="update-chip__panel" role="dialog" aria-label="Update Insight Plan">
          <div className="update-chip__title">
            Version {a.version} ({new Date(a.published).toLocaleDateString()}). You have {info?.current.version}.
          </div>
          <ul className="update-chip__list">
            {a.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          {a.requiresFullInstall ? (
            <div className="update-chip__note">This version needs a full download: ask for the new package and unzip it next to this one. Your project folders carry over.</div>
          ) : (
            <>
              <div className="update-chip__note">Downloaded and checked. Save your work first: the app restarts and this page reloads in about 10 seconds. Or do nothing: it installs the next time you start the app.</div>
              <button type="button" className="btn primary update-chip__go" disabled={state.kind === 'updating'} onClick={() => void restart()}>
                {state.kind === 'updating' ? 'Updating…' : 'Restart and update'}
              </button>
            </>
          )}
          {state.text && <div className={state.kind === 'error' ? 'update-chip__error' : 'update-chip__note'}>{state.text}</div>}
        </div>
      )}
    </div>
  );
}
