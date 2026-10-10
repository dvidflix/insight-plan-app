/// <reference lib="webworker" />
import { handleDbRequest } from './router';
import { handleModelsRequest } from './modelsRouter';
import { ProjectFolders } from './files';

/** The browser edition's data worker: owns the project database (in memory), answers the app's /api/db calls and writes the
    file into the project folder. A worker, so a big import or a save never freezes the screen. */

export type WorkerIn =
  | { kind: 'folder'; id: number; root: string; folder: FileSystemDirectoryHandle }
  | { kind: 'request'; id: number; method: string; url: string; headers: Record<string, string>; body: ArrayBuffer | string | null }
  | { kind: 'flush'; id: number };
export type WorkerOut = { id: number; status: number; body: string | ArrayBuffer; contentType: string; headers?: Record<string, string> } | { id: number; done: true };

const folders = new ProjectFolders();
const reply = (m: WorkerOut) => self.postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.kind === 'folder') {
    folders.setFolder(m.root, m.folder);
    return reply({ id: m.id, done: true });
  }
  if (m.kind === 'flush') {
    await folders.flush();
    return reply({ id: m.id, done: true });
  }
  const url = new URL(m.url, 'http://local');
  if (url.pathname.startsWith('/api/models')) {
    const route = url.pathname.replace(/^\/api\/models\/?/, '');
    const result = await handleModelsRequest(folders, m.method, route, url.searchParams, m.headers, m.body);
    const body = typeof result.body === 'string' ? result.body : (result.body.buffer.slice(result.body.byteOffset, result.body.byteOffset + result.body.byteLength) as ArrayBuffer);
    self.postMessage({ id: m.id, status: result.status, body, contentType: result.contentType, headers: result.headers } satisfies WorkerOut, typeof body === 'string' ? [] : [body]);
    return;
  }
  const route = url.pathname.replace(/^\/api\/db\/?/, '');
  const result = await handleDbRequest(folders, m.method, route, url.searchParams, m.body);
  reply({ id: m.id, status: result.status, body: result.body, contentType: 'application/json' });
};
