/// <reference lib="webworker" />
import { buildScheduleModel } from './loadSchedule';
import { indexXer, readXerTables, type XerIndex } from './parsers/xerStream';
import type { XerTables } from './parsers/xer';

/** Runs the large-XER passes (see xerStream.ts) off the main thread; the
    raw tables never leave the worker — only the index or the finished
    ScheduleModel is posted back. op "db": the same build from a programme's
    P6 tables in the project database (url: /api/db/programmes/tables…). */
export type XerWorkerRequest =
  | { op: 'index'; file: File }
  | { op: 'build'; file: File; index: XerIndex; projectIds: string[] | null }
  | { op: 'db'; url: string; fileName: string; projectIds: string[] };

export type XerWorkerMessage =
  | { type: 'progress'; phase: 'index' | 'read' | 'build'; done: number; total: number }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string };

const post = (m: XerWorkerMessage) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<XerWorkerRequest>) => {
  const req = e.data;
  try {
    if (req.op === 'index') {
      const index = await indexXer(req.file, (done, total) => post({ type: 'progress', phase: 'index', done, total }));
      post({ type: 'done', result: index });
      return;
    }
    if (req.op === 'db') {
      post({ type: 'progress', phase: 'read', done: 0, total: 1 });
      const res = await fetch(req.url);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error ?? `Reading the programme from the project database failed (${res.status}).`);
      const tables: XerTables = {};
      for (const [name, t] of Object.entries(body.tables as Record<string, { columns: string[]; rows: string[][] }>)) {
        tables[name] = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
      }
      post({ type: 'progress', phase: 'build', done: 0, total: 1 });
      const model = buildScheduleModel({ format: 'xer', tables, fileName: req.fileName, projects: [] }, req.projectIds.length ? req.projectIds : undefined);
      post({ type: 'done', result: model });
      return;
    }
    const tables = await readXerTables(req.file, req.index, req.projectIds, (done, total) => post({ type: 'progress', phase: 'read', done, total }));
    post({ type: 'progress', phase: 'build', done: 0, total: 1 });
    const model = buildScheduleModel({ format: 'xer', tables, fileName: req.file.name, projects: [] }, req.projectIds ?? undefined);
    post({ type: 'done', result: model });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
