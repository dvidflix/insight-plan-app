import { buildScheduleModel, parseScheduleFile } from './loadSchedule';
import type { XerIndex } from './parsers/xerStream';
import type { ScheduleModel } from './types';
import type { XerWorkerMessage, XerWorkerRequest } from './xerWorker';

export type { XerIndex, XerProjectInfo } from './parsers/xerStream';

export type ImportProgress = (label: string, fraction: number) => void;

const PHASE_LABEL = { index: 'Scanning', read: 'Reading', build: 'Building' } as const;

/** One worker per call, terminated when done, so its memory (the raw rows)
    is released straight away. */
function runWorker<T>(req: XerWorkerRequest, onProgress?: ImportProgress): Promise<T> {
  const worker = new Worker(new URL('./xerWorker.ts', import.meta.url), { type: 'module' });
  return new Promise<T>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<XerWorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') {
        onProgress?.(PHASE_LABEL[m.phase], m.total ? m.done / m.total : 0);
        return;
      }
      worker.terminate();
      if (m.type === 'done') resolve(m.result as T);
      else reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'XER worker failed'));
    };
    worker.postMessage(req);
  });
}

/** First pass over an .xer: table positions and the project list, for the picker. */
export const indexXerFile = (file: File, onProgress?: ImportProgress) =>
  runWorker<XerIndex>({ op: 'index', file }, onProgress);

/** Second pass: builds one schedule from the chosen projects (all when null). */
export const buildXerSchedule = (file: File, index: XerIndex, projectIds: string[] | null, onProgress?: ImportProgress) =>
  runWorker<ScheduleModel>({ op: 'build', file, index, projectIds }, onProgress);

/** A programme from the project database (its P6 tables, see db/api.ts). */
export const buildDbSchedule = (url: string, fileName: string, projectIds: string[], onProgress?: ImportProgress) =>
  runWorker<ScheduleModel>({ op: 'db', url, fileName, projectIds }, onProgress);

export const isXer = (file: File) => file.name.toLowerCase().endsWith('.xer');

/** Loads a schedule file without a project picker: an .xer goes through the
    worker, keeping the projects in `preferProjectIds` when the file has any
    of them (e.g. a baseline for the programme being compared), else all. */
export async function loadScheduleFile(file: File, preferProjectIds: string[] = [], onProgress?: ImportProgress): Promise<ScheduleModel> {
  if (!isXer(file)) return buildScheduleModel(await parseScheduleFile(file));
  const index = await indexXerFile(file, onProgress);
  const available = new Set(index.projects.map((p) => p.id));
  const wanted = preferProjectIds.filter((id) => available.has(id));
  return buildXerSchedule(file, index, wanted.length ? wanted : null, onProgress);
}
