import { useEffect, useState, type ReactNode } from 'react';
import { useLicenceModules } from './modulesStore';
import { checkLicence, forgetLicenceKey, saveLicenceKey, savedLicenceKey, type LicenceCheck } from './licence';

/** Shows the app once a valid licence key is saved in this browser; otherwise asks for one. Everything is checked on this
    computer, so it works offline. */
export function LicenceGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LicenceCheck | 'checking'>('checking');
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = savedLicenceKey();
    if (!saved) return setState({ ok: false, reason: '' });
    void checkLicence(saved).then((r) => {
      if (!r.ok) setError(r.reason);
      else useLicenceModules.getState().set(r.licence.modules);
      setState(r);
    });
  }, []);

  if (state === 'checking') return null;
  if (state.ok) {
    return (
      <>
        {state.daysLeft <= 30 && (
          <div role="status" style={{ background: '#fff4d6', color: '#5c4400', padding: '4px 12px', fontSize: 13, textAlign: 'center' }}>
            The licence for {state.licence.customer} runs out in {state.daysLeft} day{state.daysLeft === 1 ? '' : 's'} ({state.licence.expires}).
          </div>
        )}
        {children}
      </>
    );
  }

  const activate = async () => {
    const r = await checkLicence(text);
    if (!r.ok) return setError(r.reason);
    saveLicenceKey(text);
    useLicenceModules.getState().set(r.licence.modules);
    setError('');
    setState(r);
  };

  return (
    <main style={{ maxWidth: 520, margin: '12vh auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22 }}>Insight Plan</h1>
      <p>Enter your licence key to start. It is checked on this computer and kept in this browser, so the app then works offline.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} spellCheck={false} aria-label="Licence key" placeholder="IP1.…" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} />
      {error && <p role="alert" style={{ color: '#b00020' }}>{error}</p>}
      <button type="button" className="btn primary" disabled={!text.trim()} onClick={() => void activate()}>Activate</button>{' '}
      {savedLicenceKey() && <button type="button" className="btn" onClick={() => { forgetLicenceKey(); setError(''); setText(''); }}>Forget saved key</button>}
    </main>
  );
}
