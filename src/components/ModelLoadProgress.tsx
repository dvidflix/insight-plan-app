import { useEffect, useState } from 'react';
import { useModelLoadStore, type LoadJob } from '../state/modelLoadStore';

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false });

/** What each model being loaded is doing (under the Files list): its stage, a progress bar, the time it has taken, and a log of the steps. */
export function ModelLoadProgress() {
  const jobs = useModelLoadStore((s) => s.jobs);
  const dismiss = useModelLoadStore((s) => s.dismiss);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const list = Object.values(jobs).sort((a, b) => b.startedAt - a.startedAt);
  const running = list.some((j) => !j.endedAt);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  // A load that went well tidies itself away after a while; a failed one stays until it is closed.
  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const j of Object.values(useModelLoadStore.getState().jobs)) if (j.endedAt && !j.error && Date.now() - j.endedAt > 25000) dismiss(j.name);
    }, 26000);
    return () => window.clearTimeout(t);
  }, [jobs, dismiss]);
  if (!list.length) return null;

  const copy = (j: LoadJob) => {
    const text = [`${j.name} (${j.kind})`, ...j.log.map((l) => `${time(l.at)}  ${l.text}`)].join('\n');
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  return (
    <>
      {list.map((j) => {
        const elapsed = (j.endedAt ?? now) - j.startedAt;
        const shown = open[j.name] ?? !!j.error;
        return (
          <div key={j.name} className={j.error ? 'inputs-panel__error' : 'inputs-panel__busy'}>
            <span>
              {j.error ? `${j.name}: failed — ${j.error}` : `${j.name}: ${j.stage}${j.endedAt ? '' : '…'}${j.fraction !== null && !j.endedAt ? ` ${Math.round(j.fraction * 100)}%` : ''}`}
              <span className="scn-dim"> · {clock(elapsed)}</span>
            </span>
            {/* No percentage known: the bar without a value moves on its own. */}
            {!j.error && (j.endedAt ? <progress value={1} max={1} /> : j.fraction !== null ? <progress value={j.fraction} max={1} /> : <progress />)}
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <button type="button" className="btn btn--small" onClick={() => setOpen((o) => ({ ...o, [j.name]: !shown }))}>{shown ? 'Hide log' : 'Log'}</button>
              <button type="button" className="btn btn--small" onClick={() => copy(j)} title="Copy the log to the clipboard">Copy log</button>
              {j.endedAt && <button type="button" className="btn btn--small" onClick={() => dismiss(j.name)} aria-label="Close">×</button>}
            </span>
            {shown && (
              <pre className="scn-dim" style={{ margin: 0, maxHeight: 160, overflow: 'auto', fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {j.log.map((l) => `${time(l.at)}  ${l.text}`).join('\n')}
              </pre>
            )}
          </div>
        );
      })}
    </>
  );
}
