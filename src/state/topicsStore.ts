import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** BCF topics (Models > Topics): issues with a status, assignee and comments, a point in the model (shown as a
    marker in the 3D view) and a time window (start / finish) that can follow activities of the programme.
    This store is the source of truth and is saved with the project; the BCF file (BIMcollab, Solibri, Revit…)
    is made from it on export and read back into it on import. */

export interface ActRef {
  id: string;
  code: string;
  name: string;
}

/** Where a topic starts: a date typed in, or the start of an activity. */
export interface TopicStart {
  kind: 'none' | 'date' | 'activity';
  /** yyyy-mm-dd */
  date?: string;
  act?: ActRef;
}

/** Where a topic finishes: a date, the finish of the same activity it starts with, the finish of another
    activity, or a number of days after its start. */
export interface TopicFinish {
  kind: 'none' | 'date' | 'same' | 'activity' | 'duration';
  date?: string;
  act?: ActRef;
  days?: number;
}

export interface TopicPoint {
  x: number;
  y: number;
  z: number;
}

export interface TopicComment {
  id: string;
  author: string;
  /** ISO date-time */
  date: string;
  text: string;
  /** A viewpoint (guid) attached to the comment. */
  viewpoint?: string;
}

export interface Topic {
  id: string;
  /** Running number, like BIMcollab's #. */
  index: number;
  title: string;
  type: string;
  status: string;
  priority: string;
  /** The marker's icon (a marker icon id); none: chosen from the priority and type. */
  icon?: string;
  stage: string;
  assignedTo: string;
  labels: string[];
  description: string;
  createdAt: string;
  createdBy: string;
  modifiedAt: string;
  modifiedBy: string;
  /** Where in the model it is (project axes, metres); shown as a marker. */
  point: TopicPoint | null;
  start: TopicStart;
  finish: TopicFinish;
  /** Viewpoint guids (the viewer's Viewpoints, which carry the camera and what was hidden / selected). */
  viewpoints: string[];
  comments: TopicComment[];
}

export const DEFAULT_TYPES = ['Issue', 'Clash', 'Request', 'Remark', 'Fault', 'Inquiry'];
export const DEFAULT_STATUSES = ['Open', 'In progress', 'Resolved', 'Closed'];
export const DEFAULT_PRIORITIES = ['Critical', 'High', 'Normal', 'Low'];
/** The colour of a status (the topics list bar, the marker in the 3D view). */
export const STATUS_COLORS: Record<string, string> = { Open: '#1c5fb0', 'In progress': '#e09f1f', Resolved: '#1f9d6b', Closed: '#868e96' };

export const CLOSED_STATUSES = ['Closed', 'Resolved'];

const now = () => new Date().toISOString();

export const newTopic = (author: string, t: Partial<Topic> = {}): Topic => ({
  id: crypto.randomUUID(),
  index: 1,
  title: '',
  type: DEFAULT_TYPES[0],
  status: DEFAULT_STATUSES[0],
  priority: 'Normal',
  stage: '',
  assignedTo: '',
  labels: [],
  description: '',
  createdAt: now(),
  createdBy: author,
  modifiedAt: now(),
  modifiedBy: author,
  point: null,
  start: { kind: 'none' },
  finish: { kind: 'none' },
  viewpoints: [],
  comments: [],
  ...t,
});

interface TopicsState {
  topics: Topic[];
  selectedId: string | null;
  /** Who writes the topics and comments (an e-mail in BCF). */
  author: string;
  /** Marker icons of topics are drawn in the 3D view. */
  showMarkers: boolean;
  /** Bumped when something asks for the Topics panel to come up (a topic marker clicked in 3D). */
  openRequest: number;
  setAuthor: (a: string) => void;
  setShowMarkers: (v: boolean) => void;
  select: (id: string | null) => void;
  add: (t?: Partial<Topic>) => string;
  update: (id: string, patch: Partial<Topic>) => void;
  remove: (id: string) => void;
  addComment: (id: string, text: string, viewpoint?: string) => void;
  removeComment: (id: string, commentId: string) => void;
  /** Adds topics read from a BCF file (a topic with a guid already here is replaced). */
  merge: (list: Topic[]) => void;
  clear: () => void;
}

export const useTopicsStore = create<TopicsState>()(
  persist(
    (set, get) => ({
      topics: [],
      selectedId: null,
      author: '',
      showMarkers: true,
      openRequest: 0,
      setAuthor: (author) => set({ author }),
      setShowMarkers: (showMarkers) => set({ showMarkers }),
      select: (selectedId) => set({ selectedId }),
      add: (t) => {
        const s = get();
        const topic = newTopic(s.author, { index: Math.max(0, ...s.topics.map((x) => x.index)) + 1, ...t });
        set({ topics: [...s.topics, topic], selectedId: topic.id });
        return topic.id;
      },
      update: (id, patch) =>
        set((s) => ({ topics: s.topics.map((t) => (t.id === id ? { ...t, ...patch, modifiedAt: now(), modifiedBy: s.author || t.modifiedBy } : t)) })),
      remove: (id) => set((s) => ({ topics: s.topics.filter((t) => t.id !== id), selectedId: s.selectedId === id ? null : s.selectedId })),
      addComment: (id, text, viewpoint) =>
        set((s) => ({
          topics: s.topics.map((t) => (t.id === id ? { ...t, modifiedAt: now(), comments: [...t.comments, { id: crypto.randomUUID(), author: s.author, date: now(), text, viewpoint }] } : t)),
        })),
      removeComment: (id, commentId) => set((s) => ({ topics: s.topics.map((t) => (t.id === id ? { ...t, comments: t.comments.filter((c) => c.id !== commentId) } : t)) })),
      merge: (list) =>
        set((s) => {
          const ids = new Set(list.map((t) => t.id));
          let next = Math.max(0, ...s.topics.filter((t) => !ids.has(t.id)).map((t) => t.index));
          const added = list.map((t) => ({ ...t, index: t.index > 0 ? t.index : ++next }));
          return { topics: [...s.topics.filter((t) => !ids.has(t.id)), ...added] };
        }),
      clear: () => set({ topics: [], selectedId: null }),
    }),
    { name: 'models.topics', partialize: (s) => ({ topics: s.topics, author: s.author, showMarkers: s.showMarkers }) },
  ),
);
