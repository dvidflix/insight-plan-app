import { useEffect, useState } from 'react';

/** External data (SeaTable) and Dashboards (Superset): the program in a frame, already signed in
    (the dev server signs in for you — vite-plugins/externalPlugin.ts). Stays loaded once opened, so
    switching tabs does not reload it. When the program does not allow a frame, or is not running,
    the page says so and opens it in a window instead. */

type Target = 'seatable' | 'superset';
interface Status { url: string; reachable: boolean; frameable: boolean }

const TEXT: Record<Target, { title: string; name: string; fix: string }> = {
  seatable: {
    title: 'External data',
    name: 'SeaTable',
    fix: 'SeaTable sends X-Frame-Options: SAMEORIGIN. In the stack\'s seatable-local.yml replace the X-Frame-Options label of seatable-server with a Content-Security-Policy "frame-ancestors \'self\' http://localhost:5173 http://127.0.0.1:5173", then recreate the seatable-server container.',
  },
  superset: {
    title: 'Dashboards',
    name: 'Superset',
    fix: 'Add this app\'s address (http://localhost:5173) to APP_ORIGINS in Superset\'s docker/.env-local, so its frame-ancestors allows it, then restart Superset.',
  },
};

/** Where in the program the tab opens: External data shows SeaTable's shared "ExternalData" view (a custom external link). */
const LANDING: Record<Target, string> = {
  seatable: '/dtable/links/3691cdb918e848a6a59a/',
  superset: '',
};

export function ExternalPage({ target, active }: { target: Target; active: boolean }) {
  const t = TEXT[target];
  const [status, setStatus] = useState<Status | null>(null);
  const [nonce, setNonce] = useState(0);
  const open = `/api/external/open?target=${target}${LANDING[target] ? `&to=${encodeURIComponent(LANDING[target])}` : ''}`;

  useEffect(() => {
    if (!active) return;
    let live = true;
    void fetch('/api/external/status')
      .then((r) => r.json())
      .then((s: Record<Target, Status>) => live && setStatus(s[target]))
      .catch(() => live && setStatus({ url: '', reachable: false, frameable: false }));
    return () => { live = false; };
  }, [active, target, nonce]);

  return (
    <div className="external-page" style={active ? undefined : { display: 'none' }}>
      <div className="external-page__bar">
        <b>{t.title}</b>
        <span className="external-page__sub">{t.name}{status?.url ? ` · ${status.url}` : ''}</span>
        <span className="external-page__spacer" />
        <button type="button" className="btn btn--small" onClick={() => setNonce((n) => n + 1)} title="Reload and sign in again">Reload</button>
        <button type="button" className="btn btn--small" onClick={() => window.open(open, '_blank', 'noopener')} title={`Open ${t.name} in its own window, signed in`}>Open in a window</button>
      </div>
      {status === null && <div className="external-page__msg">Checking {t.name}…</div>}
      {status && !status.reachable && (
        <div className="external-page__msg">
          {t.name} is not answering{status.url ? ` at ${status.url}` : ''}. Start the stack (Docker Desktop must be running), then Reload.
        </div>
      )}
      {status && status.reachable && !status.frameable && (
        <div className="external-page__msg">
          {t.name} does not allow being shown inside this app yet. <button type="button" className="cols__link" onClick={() => window.open(open, '_blank', 'noopener')}>Open it in a window</button> for now.
          <div className="external-page__fix">{t.fix}</div>
        </div>
      )}
      {status?.reachable && status.frameable && <iframe key={nonce} className="external-page__frame" title={t.name} src={open} />}
    </div>
  );
}
