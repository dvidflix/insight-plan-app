import { useEffect, useRef, useState } from 'react';
import { useTimelineSettingsStore } from '../state/timelineSettingsStore';
import { IconFirstPage, IconLastPage, IconPauseCircle, IconPlayCircle, IconRewind, IconStopCircle } from './icons';

type Ids = Record<string, number[]>;

const union = (list: Ids[]): Ids => {
  const out: Record<string, Set<number>> = {};
  for (const ids of list) for (const [m, l] of Object.entries(ids)) for (const id of l) (out[m] ??= new Set()).add(id);
  return Object.fromEntries(Object.entries(out).map(([m, s]) => [m, [...s]]));
};
const minus = (a: Ids, b: Ids): Ids => {
  const out: Ids = {};
  for (const [m, l] of Object.entries(a)) {
    const drop = new Set(b[m] ?? []);
    const rest = l.filter((id) => !drop.has(id));
    if (rest.length) out[m] = rest;
  }
  return out;
};

/** Plays a folder of search sets like phasing: the sets are its steps, in the order listed. Step k
    has the first k sets shown and the rest hidden (0 = all hidden, all = all shown). Nothing happens
    until a folder is chosen; then the same shortcuts as the 4D timeline drive it (Ctrl+. / Ctrl+,
    forward / back, Ctrl+Alt+3 play / pause, Ctrl+Alt+0 start, Ctrl+Alt+4 end). */
export function useFolderPlayer({ steps, setShown, shownCount }: {
  /** The objects of each set of the folder, in order (sets that find nothing left out). */
  steps: (folder: string) => Ids[];
  setShown: (ids: Ids, visible: boolean) => Promise<void>;
  /** How many leading sets of the folder are fully shown right now. */
  shownCount: (folder: string) => number;
}) {
  const [folder, setFolderState] = useState('');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const intervalMs = useTimelineSettingsStore((s) => s.stepIntervalMs);

  const total = folder ? steps(folder).length : 0;
  // Latest values for the timer and the key handler.
  const live = useRef({ folder, step, total, steps, setShown, shownCount });
  live.current = { folder, step, total, steps, setShown, shownCount };
  const chain = useRef<Promise<void>>(Promise.resolve());

  const goTo = (target: number) => {
    const { folder: f, total: n, steps: stepsOf, setShown: show } = live.current;
    if (!f) return;
    const k = Math.max(0, Math.min(n, target));
    live.current.step = k;
    setStep(k);
    const list = stepsOf(f);
    const shown = union(list.slice(0, k));
    const hidden = minus(union(list.slice(k)), shown);
    chain.current = chain.current.then(async () => {
      await show(hidden, false);
      await show(shown, true);
    });
  };
  const go = (delta: number) => goTo(live.current.step + delta);
  const stop = () => { setPlaying(false); goTo(0); };
  const togglePlay = () => {
    if (live.current.step >= live.current.total) goTo(0);
    setPlaying((p) => !p);
  };

  const setFolder = (f: string) => {
    setPlaying(false);
    setFolderState(f);
    const k = f ? live.current.shownCount(f) : 0;
    live.current.folder = f;
    live.current.total = f ? live.current.steps(f).length : 0;
    live.current.step = k;
    setStep(k);
  };

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (live.current.step >= live.current.total - 1) setPlaying(false);
      go(1);
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, intervalMs]);

  // The shortcuts, ahead of the 4D timeline's (capture phase) while a folder is chosen.
  useEffect(() => {
    if (!folder) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement | null)?.tagName ?? '')) return;
      let run: (() => void) | null = null;
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        if (e.code === 'Period') run = () => go(1);
        else if (e.code === 'Comma') run = () => go(-1);
      } else if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey) {
        if (e.code === 'Digit3') run = e.repeat ? () => {} : togglePlay;
        else if (e.code === 'Digit0') run = () => goTo(0);
        else if (e.code === 'Digit4') run = () => goTo(live.current.total);
      }
      if (!run) return;
      e.preventDefault();
      e.stopPropagation();
      run();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  // Leaving the panel stops a running play.
  useEffect(() => () => setPlaying(false), []);

  return { folder, setFolder, step, total, playing, goTo, go, stop, togglePlay };
}

/** The player's controls: pick a folder, then the same buttons as the 4D timeline. */
export function FolderPlayerBar({ player, folders }: { player: ReturnType<typeof useFolderPlayer>; folders: string[] }) {
  const { folder, setFolder, step, total, playing, goTo, go, stop, togglePlay } = player;
  const on = folder !== '';
  return (
    <div className="ss__player" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', position: 'sticky', bottom: 0, marginTop: 'auto', marginLeft: -10, marginRight: -10, padding: '6px 10px', background: 'var(--bg-panel)', borderTop: '1px solid var(--border)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Play a folder like phasing: its sets are the steps, shown one after another. The 4D timeline's shortcuts then drive it.">
        <span>Play</span>
        <select value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">Off</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <div className="sequence-statusbar__transport" style={{ opacity: on ? 1 : 0.4, pointerEvents: on ? undefined : 'none' }}>
        <button className="transport-btn" type="button" title="Go to start: hides every set (Ctrl+Alt+0)" aria-label="Go to start" onClick={() => goTo(0)}><IconFirstPage /></button>
        <button className="transport-btn" type="button" title="Back one set: hides the last shown (Ctrl+,)" aria-label="Back one set" onClick={() => go(-1)}><IconRewind /></button>
        <button className={`transport-btn transport-btn--play${playing ? ' is-playing' : ''}`} type="button" title={playing ? 'Pause (Ctrl+Alt+3)' : 'Play (Ctrl+Alt+3)'} aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>{playing ? <IconPauseCircle /> : <IconPlayCircle />}</button>
        <button className="transport-btn" type="button" title="Stop (back to the start)" aria-label="Stop" onClick={stop}><IconStopCircle /></button>
        <button className="transport-btn transport-btn--mirror" type="button" title="Forward one set: shows the next (Ctrl+.)" aria-label="Forward one set" onClick={() => go(1)}><IconRewind /></button>
        <button className="transport-btn" type="button" title="Go to end: shows every set (Ctrl+Alt+4)" aria-label="Go to end" onClick={() => goTo(total)}><IconLastPage /></button>
      </div>
      {on && <span className="scn-dim">{step} / {total}</span>}
    </div>
  );
}
