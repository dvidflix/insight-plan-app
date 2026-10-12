import { useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { captureFrame } from '../viewer/frameCapture';
import { usePersistedState } from '../utils/persistedState';
import { downloadBlob } from '../utils/download';

type Format = 'png' | 'jpg';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Models > Views > Output: the 3D view(s) as shown, saved as a picture (PNG or JPG) at the chosen resolution, or copied
    to the clipboard. The 4D page's Output adds video and a frame per date; this is the picture alone. */
export function ModelImageExport() {
  const engine = useViewerEngine();
  const [scale, setScale] = usePersistedState('export.imageScale', 2);
  const [format, setFormat] = usePersistedState<Format>('export.imageFormat', 'png');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  /** Renders the view at the output resolution and returns it as an image file. */
  const capture = async (type: 'image/png' | 'image/jpeg'): Promise<Blob> => {
    engine.setCaptureScale(scale);
    try {
      await nextFrame();
      await nextFrame();
      const canvas = document.createElement('canvas');
      captureFrame(engine, canvas, { scale, timeline: null });
      return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the picture'))), type, type === 'image/jpeg' ? 0.92 : undefined));
    } finally {
      engine.setCaptureScale(null);
    }
  };

  const run = async (what: 'save' | 'copy') => {
    setBusy(true);
    setMessage(null);
    try {
      if (what === 'save') {
        const blob = await capture(format === 'png' ? 'image/png' : 'image/jpeg');
        downloadBlob(`view_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${format}`, blob);
        setMessage({ text: 'Saved.' });
      } else {
        // The clipboard takes PNG.
        const blob = await capture('image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setMessage({ text: 'Copied to the clipboard.' });
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className="disp__row">
        <span>Format</span>
        <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
          <option value="png">PNG</option>
          <option value="jpg">JPG</option>
        </select>
      </label>
      <label className="disp__row">
        <span>Resolution</span>
        <select value={scale} onChange={(e) => setScale(Number(e.target.value))} title="The 3D view is rendered at this multiple of its on-screen size">
          <option value={1}>View size ×1</option>
          <option value={1.5}>×1.5</option>
          <option value={2}>×2 (sharp)</option>
          <option value={3}>×3 (very sharp, large)</option>
        </select>
      </label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
        <button type="button" className="btn" disabled={busy} onClick={() => void run('save')} title="Save the 3D view(s) as shown (the split too) as a picture">Save image</button>
        <button type="button" className="btn" disabled={busy || !('ClipboardItem' in window)} onClick={() => void run('copy')} title="Copy the 3D view(s) as shown to the clipboard, to paste into a document or an email">Copy</button>
      </div>
      {message && <div className="flt__hint" style={message.error ? { color: 'var(--danger)' } : undefined}>{message.text}</div>}
    </>
  );
}
