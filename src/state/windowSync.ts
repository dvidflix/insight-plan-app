import { useScheduleStore } from './scheduleStore';
import { useActivityOverridesStore } from './activityOverridesStore';
import { useSequenceTimelineStore } from './sequenceTimelineStore';
import type { ScheduleModel } from '../schedule/types';
import { IS_SATELLITE, SATELLITE_GROUP, SATELLITE_ID } from './satellite';

/** Windows that talk to each other: the one that opened a satellite window ("Open in a new window") and the satellite,
    over a BroadcastChannel. Programme edits (and undo), the activity picked and the 4D date go both ways, so the Gantt can
    be on one screen and the 3D view on the other. Only the window that opened the others writes to the project database
    (the satellite's edits reach it as messages), so nothing is saved twice. */

const CHANNEL = 'insight-plan.windows';
const GROUPS_KEY = 'insight-plan.windowGroups';
const ME = crypto.randomUUID();

interface Message {
  group: string;
  from: string;
  type: string;
  data: unknown;
}

/** The groups this (opening) window answers for; kept for the browser session, so a reload keeps the link. */
const groups = new Set<string>(
  (() => {
    try {
      return JSON.parse(sessionStorage.getItem(GROUPS_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  })(),
);

const channel = new BroadcastChannel(CHANNEL);
const handlers = new Map<string, Set<(data: unknown) => void>>();

const targets = () => (IS_SATELLITE ? [SATELLITE_GROUP as string] : [...groups]);

/** Sends to the other windows of the group (nothing happens when there are none). */
export function sendToWindows(type: string, data: unknown) {
  for (const group of targets()) channel.postMessage({ group, from: ME, type, data } satisfies Message);
}

/** Listens for a message type from the other windows; returns the way to stop. */
export function onWindowMessage<T>(type: string, fn: (data: T) => void): () => void {
  let set = handlers.get(type);
  if (!set) handlers.set(type, (set = new Set()));
  const h = fn as (data: unknown) => void;
  set.add(h);
  return () => { set.delete(h); };
}

/** Whether this window opened the satellite windows of `group` (it answers for them). */
export const ownsGroup = (group: string) => !IS_SATELLITE && groups.has(group);

/** True while this window has other windows to keep in step. */
export const hasLinkedWindows = () => targets().length > 0;

channel.onmessage = (e: MessageEvent<Message>) => {
  const m = e.data;
  if (m.from === ME || !targets().includes(m.group)) return;
  handlers.get(m.type)?.forEach((fn) => fn(m.data));
};

/** Where a satellite window is on the screen, and what it shows (kept by a workspace, state/workspaces.ts). */
export interface WindowInfo {
  view: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The satellite windows this window opened and that are still open. */
const opened = new Map<string, { win: Window; view: string }>();
export const WINDOWS_EVENT = 'ip-windows';

const bounds = (win: Window) => ({ x: Math.round(win.screenX), y: Math.round(win.screenY), w: Math.round(win.outerWidth), h: Math.round(win.outerHeight) });

/** The satellite windows open now, with where they are. */
export function satelliteWindows(): WindowInfo[] {
  const out: WindowInfo[] = [];
  for (const { win, view } of opened.values()) if (!win.closed) out.push({ view, ...bounds(win) });
  return out;
}

/** Closes the satellite windows this window opened. */
export function closeSatelliteWindows() {
  for (const { win } of opened.values()) if (!win.closed) win.close();
  opened.clear();
}

/** Opens a satellite window on a Programmes view; at `at` when given. False when the browser blocked it. */
export function openSatelliteWindow(view: string, at?: Partial<WindowInfo>): boolean {
  // A window opened from a secondary one joins the same group, so all of them stay in step with the main window.
  const group = IS_SATELLITE ? (SATELLITE_GROUP as string) : crypto.randomUUID();
  const id = crypto.randomUUID();
  if (!IS_SATELLITE) {
    groups.add(group);
    try {
      sessionStorage.setItem(GROUPS_KEY, JSON.stringify([...groups]));
    } catch {
      // the link is lost on reload
    }
  }
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('satellite', group);
  url.searchParams.set('view', view);
  url.searchParams.set('wid', id);
  const w = at?.w ?? Math.round(window.screen.availWidth * 0.8);
  const h = at?.h ?? Math.round(window.screen.availHeight * 0.85);
  const place = at?.x !== undefined && at?.y !== undefined ? `,left=${at.x},top=${at.y}` : '';
  const win = window.open(url.toString(), `insight-plan-${id}`, `popup=yes,width=${w},height=${h}${place}`);
  if (!win) {
    if (!IS_SATELLITE) groups.delete(group);
    if (!at) window.alert('The browser blocked the new window. Allow pop-ups for this site and try again.');
    return false;
  }
  opened.set(id, { win, view });
  window.dispatchEvent(new Event(WINDOWS_EVENT));
  return true;
}

// Windows the user closes or moves: noticed a moment later (a workspace keeps where they are).
let lastWindows = '[]';
setInterval(() => {
  if (opened.size === 0 && lastWindows === '[]') return;
  for (const [group, { win }] of opened) if (win.closed) opened.delete(group);
  const now = JSON.stringify(satelliteWindows());
  if (now === lastWindows) return;
  lastWindows = now;
  window.dispatchEvent(new Event(WINDOWS_EVENT));
}, 1500);

// ---- Programme edits ----

/** What the other windows were last told (or told us): a programme is only sent again when it is a different object. */
const known = new Map<string, ScheduleModel>();
let timer: ReturnType<typeof setTimeout> | null = null;

interface StateMessage {
  ids: string[];
  changed: ScheduleModel[];
  /** Everything is in `changed` (a reply to hello). */
  full?: boolean;
}

function sendState(full = false) {
  if (!hasLinkedWindows()) return;
  const schedules = useScheduleStore.getState().schedules;
  const changed = schedules.filter((m) => full || known.get(m.id) !== m);
  const ids = schedules.map((m) => m.id);
  const gone = [...known.keys()].some((id) => !ids.includes(id));
  if (changed.length === 0 && !gone && !full) return;
  for (const m of changed) known.set(m.id, m);
  for (const id of [...known.keys()]) if (!ids.includes(id)) known.delete(id);
  sendToWindows('state', { ids, changed, full } satisfies StateMessage);
}

useScheduleStore.subscribe((s, prev) => {
  if (s.schedules === prev.schedules || !hasLinkedWindows()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => sendState(), 150);
});

onWindowMessage<StateMessage>('state', (msg) => {
  const local = useScheduleStore.getState().schedules;
  const byId = new Map(local.map((m) => [m.id, m]));
  for (const m of msg.changed) byId.set(m.id, m);
  // A programme named but not sent and not known here: ask for everything.
  if (msg.ids.some((id) => !byId.has(id))) {
    sendToWindows('hello', null);
    return;
  }
  for (const m of msg.changed) known.set(m.id, m);
  const next = msg.ids.map((id) => byId.get(id) as ScheduleModel);
  for (const id of [...known.keys()]) if (!msg.ids.includes(id)) known.delete(id);
  const same = next.length === local.length && next.every((m, i) => m === local[i]);
  if (!same) useScheduleStore.setState((s) => ({ schedules: next, selectedId: next.some((m) => m.id === s.selectedId) ? s.selectedId : (next[0]?.id ?? null) }));
});

// A window that just opened asks; the others reply with everything.
onWindowMessage('hello', () => sendState(true));
if (IS_SATELLITE) {
  // The reply may come before this window's own app has mounted: ask again briefly until the programmes arrive.
  let tries = 0;
  const ask = () => {
    if (useScheduleStore.getState().schedules.length > 0 || tries++ > 20) return;
    sendToWindows('hello', null);
    setTimeout(ask, 1000);
  };
  setTimeout(ask, 300);
}

// ---- Edits kept on top of imported programmes, and the 4D date ----

type Overrides = { byProgramme: unknown; links: unknown };
let lastOverrides: Overrides | null = null;
useActivityOverridesStore.subscribe((s) => {
  if (!hasLinkedWindows() || (lastOverrides && lastOverrides.byProgramme === s.byProgramme && lastOverrides.links === s.links)) return;
  lastOverrides = { byProgramme: s.byProgramme, links: s.links };
  sendToWindows('overrides', lastOverrides);
});
onWindowMessage<Overrides>('overrides', (o) => {
  lastOverrides = o;
  useActivityOverridesStore.setState({ byProgramme: o.byProgramme, links: o.links } as never);
});

let lastDate: number | null = null;
useSequenceTimelineStore.subscribe((s) => {
  if (s.date === lastDate || !hasLinkedWindows()) return;
  lastDate = s.date;
  sendToWindows('date', s.date);
});
onWindowMessage<number | null>('date', (d) => {
  lastDate = d;
  if (d !== null) useSequenceTimelineStore.getState().setDate(d);
});

// ---- What a second window shows (kept with the workspace) ----

/** A second window tells the one that opened it what it shows now: a Programmes view, or a page (page:sequence), so the workspace
    opens it there next time. */
export function reportView(view: string) {
  if (IS_SATELLITE && SATELLITE_ID) sendToWindows('view', { id: SATELLITE_ID, view });
}
onWindowMessage<{ id: string; view: string }>('view', ({ id, view }) => {
  const w = opened.get(id);
  if (!w || w.view === view) return;
  w.view = view;
  window.dispatchEvent(new Event(WINDOWS_EVENT));
});
