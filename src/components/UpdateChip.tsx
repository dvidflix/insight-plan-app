import { useEffect, useRef, useState } from 'react';

/** Top bar: "Update available" when GitHub has a newer version of the app
    (vite-plugins/appUpdate.ts). Checked a little after start, then every
    two hours. Update now runs Autorun.bat update, which restarts the
    server; this page waits for the new version to answer, then reloads. */

interface VersionInfo {
  commit: string;
  date: string;
  behind: number | null;
  changes: { commit: string; date: string; subject: string }[];
  dirty: boolean;
  error: string | null;
}

const CHECK_EVERY = 2 * 60 * 60 * 1000;

async function getVersion(fetchRemote: boolean): Promise<VersionInfo | null> {
  try {
    const res = await fetch(`/api/app/version${fetchRemote ? '?fetch=1' : ''}`);
    return res.ok ? ((await res.json()) as VersionInfo) : null;
  } catch {
    return null;
  }
}

export function UpdateChip() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' | 'updating' | 'error'; text?: string }>({ kind: 'idle' });
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => void getVersion(true).then((v) => v && setInfo(v));
    const first = setTimeout(check, 5000);
    const every = setInterval(check, CHECK_EVERY);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const update = async () => {
    if (!info) return;
    setState({ kind: 'updating', text: 'Downloading the update and restarting…' });
    try {
      const res = await fetch('/api/app/update', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Update failed (${res.status}).`);
      if (!body.started) {
        setState({ kind: 'idle' });
        setInfo({ ...info, behind: 0, changes: [] });
        return;
      }
      // The server stops, updates and starts again: wait for the new commit.
      const from = info.commit;
      const started = Date.now();
      const poll = async () => {
        const v = await getVersion(false);
        if (v && v.commit && v.commit !== from) return window.location.reload();
        if (Date.now() - started > 10 * 60 * 1000) {
          setState({ kind: 'error', text: 'The app did not come back after updating — check the "Insight Plan update" window, or start it again from its shortcut.' });
          return;
        }
        setTimeout(poll, 3000);
      };
      setTimeout(poll, 6000);
    } catch (e) {
      setState({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  if (!info?.behind) return null;
  return (
    <div className="update-chip" ref={boxRef}>
      <button type="button" className="update-chip__btn" onClick={() => setOpen((v) => !v)} title="A newer version of Insight Plan is available">
        <span className="update-chip__dot" aria-hidden="true" />
        Update available
      </button>
      {open && (
        <div className="update-chip__panel" role="dialog" aria-label="Update Insight Plan">
          <div className="update-chip__title">
            {info.behind} new change{info.behind === 1 ? '' : 's'} since your version ({info.commit}, {new Date(info.date).toLocaleDateString()})
          </div>
          <ul className="update-chip__list">
            {info.changes.map((c) => (
              <li key={c.commit}>
                <span className="update-chip__date">{new Date(c.date).toLocaleDateString()}</span> {c.subject}
              </li>
            ))}
            {info.behind > info.changes.length && <li className="update-chip__date">…and {info.behind - info.changes.length} more</li>}
          </ul>
          {info.dirty ? (
            <div className="update-chip__note">This copy has local changes (a developer's copy), so it is not updated from here — pull with git.</div>
          ) : (
            <>
              <div className="update-chip__note">Save your work first: the app restarts and this page reloads. Takes about a minute.</div>
              <button type="button" className="btn primary update-chip__go" disabled={state.kind === 'updating'} onClick={() => void update()}>
                {state.kind === 'updating' ? 'Updating…' : 'Update now'}
              </button>
            </>
          )}
          {state.text && <div className={state.kind === 'error' ? 'update-chip__error' : 'update-chip__note'}>{state.text}</div>}
        </div>
      )}
    </div>
  );
}
