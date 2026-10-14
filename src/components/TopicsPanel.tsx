import { useMemo, useRef, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { createViewpoint, openViewpoint, thumbnailUrl, useViewpoints, viewpointTitle } from '../viewer/savedViews';
import { useSequenceSchedule } from '../state/scheduleStore';
import { useSequenceTimelineStore } from '../state/sequenceTimelineStore';
import { CLOSED_STATUSES, DEFAULT_PRIORITIES, DEFAULT_STATUSES, DEFAULT_TYPES, useTopicsStore, type Topic } from '../state/topicsStore';
import { dayString, topicWindow } from '../topics/topicDates';
import { exportBcf, formatPoint, importBcf, parsePoint } from '../topics/bcfBridge';
import { downloadBlob } from '../utils/download';
import { ActivityLinkPicker } from './ActivityLinkPicker';
import { InfoTip } from './InfoTip';
import { IconPencil, IconRemove } from './icons';
import { MARKER_ICONS } from '../viewer/markerIcons';
import { RowButtonsChooser, useRowButtons, type RowButtonDef } from './RowButtonsChooser';

/** Models > Topics and 4D Sequencing > 4D > Topics: BCF topics like BIMcollab's — status, priority, assignee,
    comments with viewpoints — plus a point in the model (a marker in the 3D view) and a start / finish that can
    follow activities of the programme. Import and export BCF files. */

const fmtDate = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
const withCurrent = (base: string[], used: string[], current: string) => [...new Set([...base, ...used, ...(current ? [current] : [])])];

const TOPIC_BUTTONS = [
  { id: 'thumb', glyph: '▣', label: 'Thumbnail (the first viewpoint)' },
  { id: 'comments', glyph: '💬', label: 'Number of comments' },
  { id: 'status', glyph: '●', label: 'Status label (the colour on the left stays)' },
  { id: 'edit', glyph: '✎', label: 'Edit' },
  { id: 'delete', glyph: '✕', label: 'Delete' },
] as const satisfies readonly RowButtonDef<string>[];
type TopicButton = (typeof TOPIC_BUTTONS)[number]['id'];

export function TopicsPanel() {
  const engine = useViewerEngine();
  const topics = useTopicsStore((s) => s.topics);
  const selectedId = useTopicsStore((s) => s.selectedId);
  const author = useTopicsStore((s) => s.author);
  const showMarkers = useTopicsStore((s) => s.showMarkers);
  const { add, select, setAuthor, setShowMarkers, merge } = useTopicsStore.getState();
  const schedule = useSequenceSchedule();
  const basis = useSequenceTimelineStore((s) => s.basis);
  const rb = useRowButtons<TopicButton>('topics.hiddenButtons');
  const viewpoints = useViewpoints(engine);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = topics.find((t) => t.id === selectedId) ?? null;
  const statuses = useMemo(() => withCurrent(DEFAULT_STATUSES, topics.map((t) => t.status), ''), [topics]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return topics
      .filter((t) => (!statusFilter || t.status === statusFilter) && (!q || [t.title, t.description, t.assignedTo, t.type, t.labels.join(' ')].some((x) => x.toLowerCase().includes(q)) || `#${t.index}` === q))
      .sort((a, b) => b.index - a.index);
  }, [topics, query, statusFilter]);

  const windowOf = (t: Topic) => topicWindow(t, schedule, basis);

  const needAuthor = () => {
    if (author.trim()) return true;
    const a = window.prompt('Your name or e-mail (written on the topics and comments you make):', '');
    if (!a?.trim()) return false;
    setAuthor(a.trim());
    return true;
  };

  const create = () => {
    if (!needAuthor()) return;
    add({ title: 'New topic', createdBy: useTopicsStore.getState().author, modifiedBy: useTopicsStore.getState().author });
  };

  const doExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await exportBcf(engine, topics, author, windowOf);
      downloadBlob('insight-plan-topics.bcf', blob);
      setMessage(`Exported ${topics.length} topic${topics.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    setMessage(null);
    try {
      const list = await importBcf(engine, new Uint8Array(await file.arrayBuffer()), author);
      merge(list);
      setMessage(`Imported ${list.length} topic${list.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch (e) {
      setMessage(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (selected) return <TopicDetail topic={selected} windowOf={windowOf} needAuthor={needAuthor} onBack={() => select(null)} />;

  return (
    <div className="tpc">
      <div className="tpc__bar">
        <button type="button" className="btn btn--small primary" onClick={create}>+ New topic</button>
        <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()} disabled={busy}>Import BCF</button>
        <button type="button" className="btn btn--small" onClick={() => void doExport()} disabled={busy || topics.length === 0}>Export BCF</button>
        <span className="mkt__spacer" />
        <label className="tpc__switch" title="Show the topics that have a point as markers in the 3D view (in 4D, only while their dates are on)">
          Markers
          <button type="button" role="switch" aria-checked={showMarkers} className={`switch${showMarkers ? ' on' : ''}`} onClick={() => setShowMarkers(!showMarkers)}><span className="switch__thumb" /></button>
        </label>
        <RowButtonsChooser buttons={TOPIC_BUTTONS} rb={rb} title="Choose which buttons show on each topic" />
        <input ref={fileRef} type="file" accept=".bcf,.bcfzip,.zip" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doImport(f); }} />
      </div>
      <div className="tpc__bar">
        <input className="tpc__search" placeholder="Search topics…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} title="Filter by status">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <label className="tpc__author">
        Author
        <input value={author} placeholder="your name or e-mail" onChange={(e) => setAuthor(e.target.value)} />
        <InfoTip>Written on the topics and comments you make, and as the author in a BCF file (BIMcollab expects an e-mail).</InfoTip>
      </label>
      {message && <div className="flt__hint">{message}</div>}
      {topics.length === 0 && <div className="flt__hint">No topics yet. Create one, or import a BCF file from BIMcollab, Solibri or Revit.</div>}
      <div className="tpc__list">
        {shown.map((t) => {
          const w = windowOf(t);
          const closed = CLOSED_STATUSES.includes(t.status);
          const vp = t.viewpoints.length > 0 ? viewpoints.find((v) => v.guid === t.viewpoints[0]) : undefined;
          const url = vp ? thumbnailUrl(engine, vp) : null;
          const statusClass = t.status.toLowerCase().replace(/\s+/g, '-');
          return (
            <div key={t.id} className={`tpc__row tpc__row--${statusClass}${closed ? ' closed' : ''}`}>
              {rb.shown('thumb') && (
                <button type="button" className="tpc__thumb" title="Open the topic" onClick={() => select(t.id)}>
                  {url ? <img src={url} alt="" draggable={false} /> : <span className="tpc__nothumb">—</span>}
                </button>
              )}
              <button type="button" className="tpc__open" onClick={() => select(t.id)}>
                <span className="tpc__num">#{t.index}</span>
                <span className="tpc__main">
                  <span className="tpc__title">{t.title || '(no title)'}</span>
                  <span className="tpc__meta">
                    {t.type}{t.priority ? ` · ${t.priority}` : ''}{t.assignedTo ? ` · ${t.assignedTo}` : ''}
                    {(w.start !== null || w.finish !== null) && ` · ${fmtDate(w.start)} → ${fmtDate(w.finish)}`}
                  </span>
                </span>
              </button>
              {t.point && <span className="tpc__pin" title="Has a point in the model">⌖</span>}
              {rb.shown('comments') && t.comments.length > 0 && <span className="tpc__count" title="Comments">{t.comments.length}</span>}
              {rb.shown('status') && <span className={`tpc__status tpc__status--${statusClass}`}>{t.status}</span>}
              <div className="vp__actions">
                {rb.shown('edit') && <button type="button" className="vp__icon" title="Edit" aria-label="Edit" onClick={() => select(t.id)}><IconPencil /></button>}
                {rb.shown('delete') && <button type="button" className="vp__icon vp__icon--danger" title="Delete" aria-label="Delete" onClick={() => { if (window.confirm(`Delete topic #${t.index} "${t.title}"?`)) useTopicsStore.getState().remove(t.id); }}><IconRemove /></button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children, inline }: { label: string; children: React.ReactNode; inline?: boolean }) {
  return (
    <label className={`tpc__field${inline ? ' tpc__field--inline' : ''}`}>
      <span className="mkt__lbl">{label}</span>
      {children}
    </label>
  );
}

function Choice({ value, base, used, onChange, allowEmpty }: { value: string; base: string[]; used: string[]; onChange: (v: string) => void; allowEmpty?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">—</option>}
      {withCurrent(base, used, value).map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

function TopicDetail({ topic: t, windowOf, needAuthor, onBack }: { topic: Topic; windowOf: (t: Topic) => ReturnType<typeof topicWindow>; needAuthor: () => boolean; onBack: () => void }) {
  const engine = useViewerEngine();
  const all = useTopicsStore((s) => s.topics);
  const { update, remove, addComment, removeComment } = useTopicsStore.getState();
  const viewpoints = useViewpoints(engine);
  const [pointText, setPointText] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [comment, setComment] = useState('');
  const [attachView, setAttachView] = useState(false);
  const [labelText, setLabelText] = useState('');
  const w = windowOf(t);

  const vpOf = (guid: string) => viewpoints.find((v) => v.guid === guid);
  const people = useMemo(() => [...new Set(all.flatMap((x) => [x.assignedTo, x.createdBy]).filter(Boolean))], [all]);

  const setPoint = (text: string) => {
    setPointText(text);
    const p = parsePoint(text);
    if (p) update(t.id, { point: p });
  };

  const pick = async () => {
    setPicking(true);
    const p = await engine.pickProjectPoint();
    setPicking(false);
    if (p) {
      update(t.id, { point: p });
      setPointText(null);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const p = parsePoint(text);
      if (p) {
        update(t.id, { point: p });
        setPointText(null);
      } else setPointText(text);
    } catch {
      // the clipboard can't be read: paste into the box instead
    }
  };

  const addViewpoint = async (): Promise<string> => {
    const vp = await createViewpoint(engine);
    update(t.id, { viewpoints: [...t.viewpoints, vp.guid] });
    return vp.guid;
  };

  const postComment = async () => {
    const text = comment.trim();
    if (!text || !needAuthor()) return;
    let viewpoint: string | undefined;
    if (attachView) {
      const vp = await createViewpoint(engine);
      viewpoint = vp.guid;
      update(t.id, { viewpoints: [...t.viewpoints, vp.guid] });
    }
    addComment(t.id, text, viewpoint);
    setComment('');
    setAttachView(false);
  };

  const addLabel = () => {
    const l = labelText.trim();
    if (l && !t.labels.includes(l)) update(t.id, { labels: [...t.labels, l] });
    setLabelText('');
  };

  const startKinds = [['none', 'Not set'], ['date', 'A date'], ['activity', 'Start of an activity']] as const;
  const finishKinds = [['none', 'Not set'], ['date', 'A date'], ...(t.start.kind === 'activity' ? [['same', 'Finish of the same activity'] as const] : []), ['activity', 'Finish of another activity'], ['duration', 'Days after the start']] as const;

  return (
    <div className="tpc">
      <div className="tpc__bar">
        <button type="button" className="btn btn--small" onClick={onBack}>‹ Topics</button>
        <b className="tpc__idx">#{t.index}</b>
        <span className="mkt__spacer" />
        <button type="button" className="mkt__del" title="Delete this topic" aria-label="Delete this topic" onClick={() => { if (window.confirm(`Delete topic #${t.index} "${t.title}"?`)) remove(t.id); }}><IconRemove /></button>
      </div>

      <Field label="Title"><input value={t.title} onChange={(e) => update(t.id, { title: e.target.value })} /></Field>
      <div className="tpc__grid">
        <Field label="Status"><Choice value={t.status} base={DEFAULT_STATUSES} used={all.map((x) => x.status)} onChange={(v) => update(t.id, { status: v })} /></Field>
        <Field label="Priority"><Choice value={t.priority} base={DEFAULT_PRIORITIES} used={all.map((x) => x.priority)} onChange={(v) => update(t.id, { priority: v })} allowEmpty /></Field>
        <Field label="Type"><Choice value={t.type} base={DEFAULT_TYPES} used={all.map((x) => x.type)} onChange={(v) => update(t.id, { type: v })} /></Field>
        <Field label="Stage"><input value={t.stage} list="tpc-stages" onChange={(e) => update(t.id, { stage: e.target.value })} /></Field>
      </div>
      <div className="tpc__field">
        <span className="mkt__lbl">Marker icon <InfoTip>The icon of its marker in the 3D view. Auto: a warning for High / Critical priority, a flag for a Clash, else a pin. The marker's colour follows the status.</InfoTip></span>
        <div className="tpc__icons">
          <button type="button" className={`tpc__icon${t.icon ? '' : ' on'}`} title="Auto: from the priority and type" onClick={() => update(t.id, { icon: undefined })}>Auto</button>
          {MARKER_ICONS.filter((i) => i.path).map((i) => (
            <button key={i.id} type="button" className={`tpc__icon${t.icon === i.id ? ' on' : ''}`} title={i.label} aria-label={i.label} onClick={() => update(t.id, { icon: i.id })}>
              <svg viewBox="0 0 24 24" width="16" height="16"><path d={i.path!} fill={i.color} /></svg>
            </button>
          ))}
        </div>
      </div>
      <datalist id="tpc-stages">{[...new Set(all.map((x) => x.stage).filter(Boolean))].map((s) => <option key={s} value={s} />)}</datalist>
      <Field label="Assigned to"><input value={t.assignedTo} list="tpc-people" placeholder="name or e-mail" onChange={(e) => update(t.id, { assignedTo: e.target.value })} /></Field>
      <datalist id="tpc-people">{people.map((p) => <option key={p} value={p} />)}</datalist>

      <Field label="Labels">
        <div className="tpc__labels">
          {t.labels.map((l) => <span key={l} className="tpc__label">{l}<button type="button" aria-label={`Remove ${l}`} onClick={() => update(t.id, { labels: t.labels.filter((x) => x !== l) })}>×</button></span>)}
          <input value={labelText} placeholder="add a label" list="tpc-labels" onChange={(e) => setLabelText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } }} onBlur={addLabel} />
        </div>
      </Field>
      <datalist id="tpc-labels">{[...new Set(all.flatMap((x) => x.labels))].map((l) => <option key={l} value={l} />)}</datalist>

      <Field label="Description"><textarea rows={4} value={t.description} onChange={(e) => update(t.id, { description: e.target.value })} /></Field>

      <div className="tpc__section">
        <span className="mkt__lbl">Location in the model <InfoTip>A point in the model's own coordinates (project axes: X east, Y north, Z up, metres). It is drawn as a marker in the 3D view. Pick it in 3D (snaps to a vertex when one is near), or paste it as "1930.020, 5997.976, -5.180" (the Point coordinates tool copies it in that form).</InfoTip></span>
        <div className="tpc__point">
          <input
            value={pointText ?? (t.point ? formatPoint(t.point) : '')}
            placeholder="X, Y, Z — paste here"
            className={pointText !== null && !parsePoint(pointText) ? 'bad' : undefined}
            onChange={(e) => setPoint(e.target.value)}
            onBlur={() => setPointText(null)}
          />
          <button type="button" className="btn btn--small" onClick={() => void pick()} disabled={picking} title="Double-click the point in the 3D view (Esc cancels)">{picking ? 'Double-click in 3D…' : 'Pick in 3D'}</button>
          <button type="button" className="btn btn--small" onClick={() => void pasteFromClipboard()} title="Paste X, Y, Z from the clipboard">Paste</button>
          <button type="button" className="btn btn--small" disabled={!t.point} onClick={() => t.point && void engine.focusMarker(t.point)}>Fly to</button>
          <button type="button" className="btn btn--small" disabled={!t.point} onClick={() => { update(t.id, { point: null }); setPointText(null); }}>Clear</button>
        </div>
      </div>

      <div className="tpc__section">
        <span className="mkt__lbl">Dates <InfoTip>When the topic is on. In 4D Sequencing its marker shows from the start to the finish. Start: a date or the start of an activity. Finish: a date, the finish of the same activity (tick "same activity"), another activity's finish, or a number of days after the start.</InfoTip></span>
        <div className="tpc__dates">
          <Field label="Start" inline>
            <select value={t.start.kind} onChange={(e) => {
              const kind = e.target.value as Topic['start']['kind'];
              update(t.id, { start: { kind, date: t.start.date, act: t.start.act }, ...(kind !== 'activity' && t.finish.kind === 'same' ? { finish: { kind: 'none' } } : {}) });
            }}>
              {startKinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {t.start.kind === 'date' && <input type="date" value={t.start.date ?? ''} onChange={(e) => update(t.id, { start: { ...t.start, date: e.target.value } })} />}
          {t.start.kind === 'activity' && <ActivityLinkPicker value={t.start.act} onChange={(act) => update(t.id, { start: { ...t.start, act }, ...(act ? {} : { finish: t.finish.kind === 'same' ? { kind: 'none' as const } : t.finish }) })} />}
          {t.start.kind === 'activity' && (
            <label className="tpc__check">
              <input type="checkbox" checked={t.finish.kind === 'same'} onChange={(e) => update(t.id, { finish: e.target.checked ? { kind: 'same' } : { kind: 'none' } })} />
              Finish with the same activity
            </label>
          )}
          {t.finish.kind !== 'same' && (
            <Field label="Finish" inline>
              <select value={t.finish.kind} onChange={(e) => update(t.id, { finish: { kind: e.target.value as Topic['finish']['kind'], date: t.finish.date, act: t.finish.act, days: t.finish.days ?? 15 } })}>
                {finishKinds.filter(([k]) => k !== 'same').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          )}
          {t.finish.kind === 'date' && <input type="date" value={t.finish.date ?? ''} onChange={(e) => update(t.id, { finish: { ...t.finish, date: e.target.value } })} />}
          {t.finish.kind === 'activity' && <ActivityLinkPicker value={t.finish.act} onChange={(act) => update(t.id, { finish: { ...t.finish, act } })} />}
          {t.finish.kind === 'duration' && (
            <label className="tpc__check">
              <input type="number" min={1} className="tpc__days" value={t.finish.days ?? 15} onChange={(e) => update(t.id, { finish: { ...t.finish, days: Math.max(1, Number(e.target.value) || 1) } })} /> days after the start
            </label>
          )}
        </div>
        <div className="flt__hint">
          {w.start === null && w.finish === null && !w.missing ? 'No dates: always on.' : <>On from <b>{fmtDate(w.start)}</b> to <b>{fmtDate(w.finish)}</b>{w.start !== null && w.finish !== null && ` (${Math.round((w.finish - w.start) / 86_400_000)} days)`}.</>}
          {w.missing && ' An activity it follows is not in the loaded programmes, so its dates are unknown and the topic stays on.'}
          {t.finish.kind === 'duration' && t.start.kind === 'none' && ' Set a start for the days to count from.'}
        </div>
        {t.start.kind === 'none' && t.finish.kind === 'none' && (
          <div className="flt__hint">Tip: <button type="button" className="tpc__link" onClick={() => update(t.id, { start: { kind: 'date', date: dayString(Date.now()) } })}>start today</button></div>
        )}
      </div>

      <div className="tpc__section">
        <span className="mkt__lbl">Viewpoints ({t.viewpoints.length})</span>
        <div className="tpc__vps">
          {t.viewpoints.map((g) => {
            const vp = vpOf(g);
            if (!vp) return null;
            const url = thumbnailUrl(engine, vp);
            return (
              <div key={g} className="tpc__vp">
                <button type="button" title="Open this viewpoint" onClick={() => void openViewpoint(engine, vp)}>
                  {url ? <img src={url} alt={viewpointTitle(vp)} /> : <span className="tpc__vp-none">{viewpointTitle(vp)}</span>}
                </button>
                <button type="button" className="tpc__vp-x" title="Remove from this topic" aria-label="Remove from this topic" onClick={() => update(t.id, { viewpoints: t.viewpoints.filter((x) => x !== g) })}><IconRemove /></button>
              </div>
            );
          })}
          <button type="button" className="btn btn--small" onClick={() => void addViewpoint()} title="Saves the 3D view as it is now (camera, what is hidden, the selection) with the topic">+ Add current view</button>
        </div>
      </div>

      <div className="tpc__section">
        <span className="mkt__lbl">Comments ({t.comments.length})</span>
        {t.comments.map((c) => {
          const vp = c.viewpoint ? vpOf(c.viewpoint) : undefined;
          return (
            <div key={c.id} className="tpc__comment">
              <div className="tpc__comment-head">
                <b>{c.author || 'Unknown'}</b>
                <span>{new Date(c.date).toLocaleString()}</span>
                <span className="mkt__spacer" />
                {vp && <button type="button" className="tpc__link" onClick={() => void openViewpoint(engine, vp)}>Open view</button>}
                <button type="button" className="mkt__del" title="Delete the comment" aria-label="Delete the comment" onClick={() => removeComment(t.id, c.id)}><IconRemove /></button>
              </div>
              <div className="tpc__comment-text">{c.text}</div>
            </div>
          );
        })}
        <textarea rows={3} placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="tpc__bar">
          <label className="tpc__check"><input type="checkbox" checked={attachView} onChange={(e) => setAttachView(e.target.checked)} /> Attach the current view</label>
          <span className="mkt__spacer" />
          <button type="button" className="btn btn--small primary" disabled={!comment.trim()} onClick={() => void postComment()}>Comment</button>
        </div>
      </div>
      <div className="flt__hint">Created {new Date(t.createdAt).toLocaleString()} by {t.createdBy || 'unknown'} · modified {new Date(t.modifiedAt).toLocaleString()}</div>
    </div>
  );
}
