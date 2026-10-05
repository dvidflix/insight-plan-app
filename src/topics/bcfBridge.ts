import * as OBC from '@thatopen/components';
import type { ViewerEngine } from '../viewer/ViewerEngine';
import { newTopic, type ActRef, type Topic } from '../state/topicsStore';
import { dayString, type TopicWindow } from './topicDates';

/** The store's topics <-> a BCF file. BCF has no field for a topic's start, its place in the model or the task it
    follows, so those travel as labels ("Start: 2026-10-05", "Location: 1930.020, 5997.976, -5.180",
    "Start task: A1000", "Finish task: A1040") that BIMcollab and others show as ordinary labels and that are read
    back into the fields on import. The finish is the standard Due date. */

const START = 'Start: ';
const LOCATION = 'Location: ';
const START_TASK = 'Start task: ';
const FINISH_TASK = 'Finish task: ';

const fmt = (n: number) => n.toFixed(3);

/** "1930.020, 5997.976, -5.180" (also with semicolons / spaces, or a decimal comma between ; separated values) -> a point. */
export function parsePoint(text: string): { x: number; y: number; z: number } | null {
  const t = text.trim();
  if (!t) return null;
  const parts = (t.includes(';') ? t.split(';') : t.includes('\t') ? t.split('\t') : /,\s/.test(t) || (t.match(/,/g) ?? []).length === 2 ? t.split(',') : t.split(/\s+/)).map((p) => p.trim().replace(',', '.'));
  if (parts.length !== 3) return null;
  const n = parts.map(Number);
  return n.every((v) => parts[n.indexOf(v)] !== '' && Number.isFinite(v)) ? { x: n[0], y: n[1], z: n[2] } : null;
}

export const formatPoint = (p: { x: number; y: number; z: number }) => `${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)}`;

export async function exportBcf(engine: ViewerEngine, topics: Topic[], author: string, windowOf: (t: Topic) => TopicWindow): Promise<Blob> {
  const bcf = engine.components.get(OBC.BCFTopics);
  bcf.config.author = author || 'user@insight-plan.local';
  bcf.list.clear();
  for (const t of topics) {
    const w = windowOf(t);
    const labels = new Set(t.labels);
    if (w.start !== null) labels.add(`${START}${dayString(w.start)}`);
    if (t.point) labels.add(`${LOCATION}${formatPoint(t.point)}`);
    if (t.start.kind === 'activity' && t.start.act) labels.add(`${START_TASK}${t.start.act.code}`);
    if (t.finish.kind === 'activity' && t.finish.act) labels.add(`${FINISH_TASK}${t.finish.act.code}`);
    const topic = bcf.create({
      guid: t.id,
      title: t.title || `Topic ${t.index}`,
      type: t.type || 'Issue',
      status: t.status || 'Open',
      priority: t.priority || undefined,
      stage: t.stage || undefined,
      assignedTo: t.assignedTo || undefined,
      description: t.description || undefined,
      labels,
      creationDate: new Date(t.createdAt),
      creationAuthor: t.createdBy || author || 'user@insight-plan.local',
      modifiedDate: new Date(t.modifiedAt),
      modifiedAuthor: t.modifiedBy || undefined,
      dueDate: w.finish !== null ? new Date(w.finish) : undefined,
      index: t.index,
    });
    bcf.list.set(topic.guid, topic);
    for (const vp of t.viewpoints) if (engine.viewpoints.list.has(vp)) topic.viewpoints.add(vp);
    for (const c of t.comments) {
      const made = topic.createComment(c.text, c.viewpoint && engine.viewpoints.list.has(c.viewpoint) ? c.viewpoint : undefined);
      made.author = c.author || author;
      made.date = new Date(c.date);
    }
  }
  bcf.updateExtensions();
  bcf.updateViewpointReferences();
  try {
    return await bcf.export();
  } finally {
    bcf.list.clear();
  }
}

/** Reads a BCF file into topics (their viewpoints are added to the viewer's Viewpoints). */
export async function importBcf(engine: ViewerEngine, bytes: Uint8Array, author: string): Promise<Topic[]> {
  const bcf = engine.components.get(OBC.BCFTopics);
  const { topics } = await bcf.load(bytes);
  const out: Topic[] = topics.map((o) => {
    const labels: string[] = [];
    let point: Topic['point'] = null;
    let startDate: string | undefined;
    let startTask: string | undefined;
    let finishTask: string | undefined;
    for (const l of o.labels) {
      if (l.startsWith(LOCATION)) {
        const p = parsePoint(l.slice(LOCATION.length));
        if (p) point = p;
      } else if (l.startsWith(START_TASK)) startTask = l.slice(START_TASK.length).trim();
      else if (l.startsWith(FINISH_TASK)) finishTask = l.slice(FINISH_TASK.length).trim();
      else if (l.startsWith(START)) startDate = l.slice(START.length).trim();
      else labels.push(l);
    }
    const ref = (code: string): ActRef => ({ id: '', code, name: '' });
    const t = newTopic(author, {
      id: o.guid,
      index: o.index ?? 0,
      title: o.title,
      type: o.type,
      status: o.status,
      priority: o.priority ?? '',
      stage: o.stage ?? '',
      assignedTo: o.assignedTo ?? '',
      labels,
      description: o.description ?? '',
      createdAt: o.creationDate.toISOString(),
      createdBy: o.creationAuthor,
      modifiedAt: (o.modifiedDate ?? o.creationDate).toISOString(),
      modifiedBy: o.modifiedAuthor ?? o.creationAuthor,
      point,
      start: startTask ? { kind: 'activity', act: ref(startTask) } : startDate ? { kind: 'date', date: startDate } : { kind: 'none' },
      finish: finishTask ? { kind: 'activity', act: ref(finishTask) } : o.dueDate ? { kind: 'date', date: dayString(o.dueDate.getTime()) } : { kind: 'none' },
      viewpoints: [...o.viewpoints],
      comments: [...o.comments.values()].map((c) => ({ id: c.guid, author: c.author, date: c.date.toISOString(), text: c.comment, viewpoint: c.viewpoint })),
    });
    return t;
  });
  bcf.list.clear();
  return out;
}
