import { useEffect, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useFlythroughStore } from '../state/flythroughStore';
import { InfoTip } from './InfoTip';

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="disp__row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

/** The Fly-through tab (Models and 4D Sequencing): camera keyframes
    captured from the view, played back as a smooth camera path. */
export function FlythroughPanel() {
  const engine = useViewerEngine();
  const fly = engine.flythrough;
  const { keys, setKeys, duration, setDuration, loop, setLoop, showPath, setShowPath } = useFlythroughStore();
  const [playing, setPlaying] = useState(fly?.isPlaying ?? false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!fly) return;
    const onPlaying = (p: boolean) => setPlaying(p);
    const onProgress = (t: number) => setProgress(t);
    fly.onPlayingChange.add(onPlaying);
    fly.onProgress.add(onProgress);
    return () => {
      fly.onPlayingChange.remove(onPlaying);
      fly.onProgress.remove(onProgress);
    };
  }, [fly]);

  if (!fly) return <div className="flt__hint">Starting viewer…</div>;

  const add = () => setKeys([...keys, fly.currentKey()]);
  const replace = (i: number) => setKeys(keys.map((k, j) => (j === i ? fly.currentKey() : k)));
  const remove = (i: number) => setKeys(keys.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => {
    const next = [...keys];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setKeys(next);
  };
  const canPlay = keys.length >= 2;

  return (
    <div className="disp fly">
      <div className="fly__actions">
        <button type="button" className="btn primary" onClick={add}>+ Add keyframe</button>
        <button type="button" className="btn" disabled={!canPlay} onClick={() => (playing ? fly.pause() : fly.play(duration, loop))}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      </div>
      <label className="disp__row" title="Drag to move the camera along the path">
        <span>Position</span>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          disabled={!canPlay}
          onChange={(e) => {
            fly.pause();
            fly.seek(Number(e.target.value) / 1000);
          }}
        />
      </label>

      <div className="cols__heading"><span>Playback</span></div>
      <label className="disp__row">
        <span>Duration (s)</span>
        <input type="number" min={1} max={3600} step={1} value={duration} onChange={(e) => setDuration(Math.min(3600, Math.max(1, Number(e.target.value) || 1)))} style={{ width: 72 }} />
      </label>
      <Switch label="Loop" on={loop} onChange={setLoop} />
      <Switch label="Show path" on={showPath} onChange={setShowPath} />

      <div className="cols__heading">
        <span>
          Keyframes <b>{keys.length}</b>{' '}
          <InfoTip>Frame the view, then add it as a keyframe; the camera flies smoothly through every keyframe in order. Grabbing the view stops playback.</InfoTip>
        </span>
        {keys.length > 0 && <button type="button" className="btn btn--small" onClick={() => setKeys([])}>Clear all</button>}
      </div>
      {keys.length === 0 ? (
        <div className="flt__hint">No keyframes yet — add at least two to play.</div>
      ) : (
        <ol className="fly__keys">
          {keys.map((k, i) => (
            <li key={i} className="fly__key">
              <button type="button" className="fly__go" onClick={() => fly.goTo(i)} title="Move the camera to this keyframe">
                <span className="fly__num">{i + 1}</span>
                <span className="fly__coords">X {k.position[0].toFixed(1)} · Y {k.position[1].toFixed(1)} · Z {k.position[2].toFixed(1)}</span>
              </button>
              <button type="button" className="fly__icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="fly__icon" title="Move down" disabled={i === keys.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="fly__icon" title="Replace with the current view" onClick={() => replace(i)}>⟳</button>
              <button type="button" className="fly__icon" title="Remove" onClick={() => remove(i)}>✕</button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
