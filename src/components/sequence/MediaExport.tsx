import { useMemo, useState } from 'react';
import { useRecordingStore } from '../../state/recordingStore';
import { useSequenceUiStore } from '../../state/sequenceUiStore';
import { useSidePaneStore } from '../../state/sidePaneStore';
import { useFlythroughStore } from '../../state/flythroughStore';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { ScheduleModel } from '../../schedule/types';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { captureFrame, type TasksFrame, type TimelineBar } from '../../viewer/frameCapture';
import { buildColumnContext, buildColumns, resolveColumns } from '../../schedule/columns';
import { defaultColumnIds, periodLabel, tasksInPeriod, type TasksMode } from './TasksPanel';
import { alignDown } from '../../schedule/period';
import { usePersistedState } from '../../utils/persistedState';
import { useSequenceTimelineStore, STEP_UNIT_LABELS } from '../../state/sequenceTimelineStore';
import { scheduleRange } from '../../schedule/linking';
import { nextBoundary } from '../../schedule/period';

const QUALITY = { standard: 0.08, high: 0.18, max: 0.35 } as const;
type Quality = keyof typeof QUALITY;
/** H.264 High profile levels 5.2 / 6.0 / 6.2 — larger frames need higher levels. */
const CODECS = ['avc1.640034', 'avc1.64003C', 'avc1.64003E'];

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
import { downloadBlob } from '../../utils/download';
import { InfoTip } from '../InfoTip';

type Output = 'mp4' | 'png';

const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 4D Sequencing > Export > Images & video: steps the timeline over a date
    range and records each step as shown — the 3D view(s) with the date
    label and tags, optionally a timeline bar — to PNG files in a folder or
    to an MP4 (encoded in the browser, WebCodecs H.264). */
export function MediaExport({ schedule }: { schedule: ScheduleModel }) {
  const engine = useViewerEngine();
  const basis = useSequenceTimelineStore((s) => s.basis);
  const stepUnit = useSequenceTimelineStore((s) => s.stepUnit);
  const range = useMemo(() => scheduleRange(schedule, basis), [schedule, basis]);

  const [output, setOutput] = useState<Output>('mp4');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fps, setFps] = useState(4);
  const [framesPerStep, setFramesPerStep] = useState(1);
  const [scale, setScale] = usePersistedState('export.scale', 2);
  const [quality, setQuality] = usePersistedState<Quality>('export.quality', 'high');
  const [timeline, setTimeline] = usePersistedState('export.timeline', true);
  const [withTasks, setWithTasks] = usePersistedState('export.tasks', false);
  const flyKeyCount = useFlythroughStore((s) => s.keys.length);
  const followPath = useFlythroughStore((s) => s.followInExport);
  const setFollowPath = useFlythroughStore((s) => s.setFollowInExport);
  const catalog = useMemo(() => buildColumns(schedule), [schedule]);
  const columnCtx = useMemo(() => buildColumnContext(schedule), [schedule]);
  const phase = useRecordingStore((s) => s.phase);
  const done = useRecordingStore((s) => s.done);
  const total = useRecordingStore((s) => s.total);
  const message = useRecordingStore((s) => s.message);
  const cancel = useRecordingStore((s) => s.cancel);

  const fromMs = from ? Date.parse(from) : range?.min ?? 0;
  const toMs = to ? Date.parse(to) : range?.max ?? 0;
  const dates = useMemo(() => {
    if (!range || !(toMs >= fromMs)) return [];
    const out: number[] = [];
    let d = Math.max(fromMs, range.min);
    for (let guard = 0; d <= toMs && guard < 20000; guard++) {
      out.push(d);
      d = nextBoundary(d, stepUnit);
    }
    return out;
  }, [range, fromMs, toMs, stepUnit]);

  const unitLabel = STEP_UNIT_LABELS.find((u) => u.value === stepUnit)?.label ?? stepUnit;
  const mp4Supported = typeof window !== 'undefined' && 'VideoEncoder' in window;
  const folderSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  /** Moves the timeline to `d` and waits until the 4D driver has applied it. */
  const showDate = async (d: number) => {
    const store = useSequenceTimelineStore;
    if (store.getState().date !== d) store.getState().setDate(d);
    const t0 = performance.now();
    while (store.getState().appliedDate !== d && performance.now() - t0 < 30000) await sleep(30);
    // Let tag callouts resolve their objects and the views repaint.
    await sleep(120);
    await nextFrame();
    await nextFrame();
  };

  const bar = (d: number): TimelineBar | null =>
    timeline && range
      ? { progress: (d - range.min) / Math.max(1, range.max - range.min), left: fmt(range.min), right: fmt(range.max), label: fmt(d) }
      : null;

  /** The Tasks table for step `d`, as the Tasks panel shows it (same mode,
      columns, WBS grouping and 4D colours). */
  const tasksFrame = (d: number): TasksFrame | null => {
    if (!withTasks) return null;
    const period = { start: alignDown(d, stepUnit), end: nextBoundary(d, stepUnit) };
    const mode = readJson<TasksMode>('sequence.tasksMode', 'active');
    const byWbs = readJson('sequence.tasksGroupByWbs', true);
    const columns = resolveColumns(catalog, readJson<string[]>('sequence.taskColumns', defaultColumnIds(catalog)));
    const colorOf = useSequenceUiStore.getState().taskColorOf;
    const tasks = tasksInPeriod(schedule, period, basis, mode);
    const row = (a: (typeof tasks)[number]) => ({ kind: 'row' as const, cells: columns.map((c) => c.text(a, columnCtx)), color: colorOf?.(a) ?? null });
    const rows: TasksFrame['rows'] = [];
    if (byWbs) {
      const groups = new Map<string, typeof tasks>();
      for (const a of tasks) {
        const k = a.wbsPath.split(' / ').pop() || '(no WBS)';
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
      }
      for (const [label, list] of groups) {
        rows.push({ kind: 'group', label, count: list.length });
        rows.push(...list.map(row));
      }
    } else rows.push(...tasks.map(row));
    const modeLabel = mode === 'starting' ? 'starting' : mode === 'finishing' ? 'finishing' : 'active';
    return {
      title: periodLabel(period.start, period.end, stepUnit),
      subtitle: `${tasks.length} task${tasks.length === 1 ? '' : 's'} ${modeLabel}`,
      columns: columns.map((c) => ({ label: c.label, width: c.width, align: c.align })),
      rows,
      widthFraction: 0.5,
    };
  };

  const run = async () => {
    if (!dates.length) return;
    const rec = useRecordingStore;
    const setProgress = (p: { done: number; total: number } | null) => rec.setState(p ?? { done: 0, total: 0 });
    const setMessage = (message: string | null) => rec.setState({ message });
    const cancelled = () => rec.getState().cancelRequested;
    rec.setState({ message: null, cancelRequested: false });
    const pane = useSidePaneStore.getState();
    const configWasOpen = pane.open;
    // The folder picker needs the click itself, so it comes before the countdown.
    let dir: FileSystemDirectoryHandle | null = null;
    if (output === 'png') {
      try {
        dir = await (window as unknown as { showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        return; // picker dismissed
      }
    }
    // Full-width capture: hide the side pane, then count down 3-2-1
    // (also lets the view settle at its new size) before recording.
    pane.setOpen(false);
    for (let c = 3; c > 0 && !cancelled(); c--) {
      rec.setState({ phase: 'countdown', count: c });
      await sleep(1000);
    }
    if (cancelled()) {
      rec.setState({ phase: 'idle', message: 'Cancelled.' });
      pane.setOpen(configWasOpen);
      return;
    }
    rec.setState({ phase: 'recording', done: 0, total: dates.length });
    // Render the 3D view(s) at the output resolution — real detail, not an upscale.
    engine.setCaptureScale(scale);
    await nextFrame();
    useSequenceTimelineStore.getState().setPlaying(false);
    const startDate = useSequenceTimelineStore.getState().date;
    const canvas = document.createElement('canvas');
    // Growth simulations follow the frames, not the clock, while recording.
    engine.growth.manual = true;
    // Fly-through: the camera travels the whole path over the recording
    // (frame n of N at n / (N - 1)); the path line itself stays out of shot.
    const fly = followPath && engine.flythrough?.canPlay ? engine.flythrough : null;
    const frameCount = output === 'png' ? dates.length : dates.length * framesPerStep;
    const pathWasShown = fly?.object.visible ?? false;
    fly?.pause();
    fly?.setPathVisible(false);
    const placeCamera = async (n: number) => {
      if (!fly) return;
      fly.seek(frameCount > 1 ? n / (frameCount - 1) : 0);
      await engine.forceUpdate();
      await nextFrame();
    };
    try {
      if (output === 'png' && dir) {
        setProgress({ done: 0, total: dates.length });
        for (let i = 0; i < dates.length && !cancelled(); i++) {
          await showDate(dates[i]);
          engine.growth.setPhase(1);
          await placeCamera(i);
          await nextFrame();
          captureFrame(engine, canvas, { scale, timeline: bar(dates[i]), tasks: tasksFrame(dates[i]) });
          const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode PNG'))), 'image/png'));
          const file = await dir.getFileHandle(`frame_${String(i + 1).padStart(5, '0')}_${toInput(dates[i])}.png`, { create: true });
          const w = await file.createWritable();
          await w.write(blob);
          await w.close();
          setProgress({ done: i + 1, total: dates.length });
        }
        setMessage(cancelled() ? 'Cancelled.' : `Saved ${dates.length} PNG frames to "${dir.name}".`);
      } else {
        await showDate(dates[0]);
        engine.growth.setPhase(1);
        await placeCamera(0);
        await nextFrame();
        captureFrame(engine, canvas, { scale, timeline: bar(dates[0]), tasks: tasksFrame(dates[0]) });
        const { width, height } = canvas;
        const bitrate = Math.min(120_000_000, Math.round(width * height * fps * QUALITY[quality]));
        let config: VideoEncoderConfig | null = null;
        for (const codec of CODECS) {
          const candidate: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, bitrateMode: 'variable' };
          if ((await VideoEncoder.isConfigSupported(candidate)).supported) {
            config = candidate;
            break;
          }
        }
        if (!config) throw new Error(`This browser cannot encode ${width}×${height} H.264 — choose a lower resolution.`);
        const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' });
        let encodeError: Error | null = null;
        const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encodeError = e) });
        encoder.configure(config);
        const frameDur = 1e6 / fps;
        let n = 0;
        setProgress({ done: 0, total: dates.length });
        for (let i = 0; i < dates.length && !cancelled(); i++) {
          if (i > 0) await showDate(dates[i]);
          for (let k = 0; k < framesPerStep; k++) {
            // Growth simulations (drop, slide, bottom-to-top) play across the
            // step's frames; one frame per step shows the settled state.
            engine.growth.setPhase(framesPerStep > 1 ? k / (framesPerStep - 1) : 1);
            await placeCamera(n);
            await nextFrame();
            captureFrame(engine, canvas, { scale, timeline: bar(dates[i]), tasks: tasksFrame(dates[i]) });
            const frame = new VideoFrame(canvas, { timestamp: n * frameDur, duration: frameDur });
            encoder.encode(frame, { keyFrame: n % (fps * 2) === 0 });
            frame.close();
            n++;
          }
          while (encoder.encodeQueueSize > 8) await sleep(10);
          if (encodeError) throw encodeError;
          setProgress({ done: i + 1, total: dates.length });
        }
        await encoder.flush();
        encoder.close();
        muxer.finalize();
        const name = `${schedule.sourceFileName.replace(/\.(xml|xer)$/i, '')}_4D.mp4`;
        downloadBlob(name, new Blob([muxer.target.buffer], { type: 'video/mp4' }));
        setMessage(cancelled() ? `Cancelled — saved the ${n} frames made so far.` : `Saved ${name} (${n} frames, ${(n / fps).toFixed(1)} s).`);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      engine.growth.manual = false;
      if (fly) fly.setPathVisible(pathWasShown);
      engine.setCaptureScale(null);
      rec.setState({ phase: 'idle' });
      useSidePaneStore.getState().setOpen(configWasOpen);
      if (startDate !== null) useSequenceTimelineStore.getState().setDate(startDate);
    }
  };

  return (
    <>
      <div className="info-tip-row" style={{ margin: '6px 0' }}>
      <div className="segmented-choice">
        <button type="button" className={output === 'mp4' ? 'active' : ''} onClick={() => setOutput('mp4')} disabled={!mp4Supported}>MP4 video</button>
        <button type="button" className={output === 'png' ? 'active' : ''} onClick={() => setOutput('png')} disabled={!folderSupported}>PNG images to folder</button>
      </div>
      <InfoTip>
        <p>Records the view as shown (3D view(s), date label and tags), stepping {unitLabel.toLowerCase()}: the Step in the status bar.</p>
        <p>Recording hides the side pane and starts after a 3-second countdown; keep this browser tab visible while it records.</p>
      </InfoTip>
      </div>
      <label className="disp__row">
        <span>From</span>
        <input type="date" value={from || (range ? toInput(range.min) : '')} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="disp__row">
        <span>To</span>
        <input type="date" value={to || (range ? toInput(range.max) : '')} onChange={(e) => setTo(e.target.value)} />
      </label>
      {output === 'mp4' && (
        <>
          <label className="disp__row">
            <span>Frames per second</span>
            <input type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} style={{ width: 64 }} />
          </label>
          <label className="disp__row">
            <span>Frames per step</span>
            <input type="number" min={1} max={60} value={framesPerStep} onChange={(e) => setFramesPerStep(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} style={{ width: 64 }} />
          </label>
        </>
      )}
      <label className="disp__row">
        <span>Resolution</span>
        <select value={scale} onChange={(e) => setScale(Number(e.target.value))} title="The 3D view is rendered at this multiple of its on-screen size">
          <option value={1}>View size ×1</option>
          <option value={1.5}>×1.5</option>
          <option value={2}>×2 (sharp)</option>
          <option value={3}>×3 (very sharp, large)</option>
        </select>
      </label>
      {output === 'mp4' && (
        <label className="disp__row">
          <span>Quality</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
            <option value="standard">Standard (smaller file)</option>
            <option value="high">High</option>
            <option value="max">Maximum</option>
          </select>
        </label>
      )}
      <div className="disp__row" title="Draws the Tasks table (same columns, grouping and colours as the Tasks panel) beside the 3D view">
        <span>Tasks table beside the view</span>
        <button type="button" role="switch" aria-checked={withTasks} className={`switch${withTasks ? ' on' : ''}`} onClick={() => setWithTasks(!withTasks)}>
          <span className="switch__thumb" />
        </button>
      </div>
      <div className="disp__row">
        <span>Timeline bar</span>
        <button type="button" role="switch" aria-checked={timeline} className={`switch${timeline ? ' on' : ''}`} onClick={() => setTimeline(!timeline)}>
          <span className="switch__thumb" />
        </button>
      </div>
      <div className="disp__row" title={flyKeyCount < 2 ? 'Add at least two keyframes in the Fly-through tab' : 'The camera travels the whole fly-through path over the recording'}>
        <span>Camera follows fly-through</span>
        <button type="button" role="switch" aria-checked={followPath && flyKeyCount >= 2} disabled={flyKeyCount < 2} className={`switch${followPath && flyKeyCount >= 2 ? ' on' : ''}`} onClick={() => setFollowPath(!followPath)}>
          <span className="switch__thumb" />
        </button>
      </div>
      <div className="flt__hint">
        {dates.length} steps{output === 'mp4' ? ` → ${((dates.length * framesPerStep) / fps).toFixed(1)} s of video` : ' → one PNG each'}.
        {output === 'mp4' && framesPerStep < 4 ? ' Growth simulations (drop, slide) need 4+ frames per step to show.' : ''}
      </div>
      {phase !== 'idle' ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <progress value={done} max={total || 1} style={{ flex: 1 }} />
          <span className="flt__hint">{done}/{total}</span>
          <button type="button" className="btn btn--small" onClick={cancel}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="btn primary" style={{ marginTop: 8, width: '100%' }} disabled={!dates.length} onClick={() => void run()}>
          {output === 'mp4' ? 'Record MP4' : 'Choose folder & save PNGs'}
        </button>
      )}
      {message && <div className="flt__hint" style={{ marginTop: 6 }}>{message}</div>}
    </>
  );
}
