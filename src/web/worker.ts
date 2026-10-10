/// <reference lib="webworker" />
import { handleDbRequest } from './router';
import { ProjectFolders } from './files';

/** The browser edition's data worker: owns the project database (in memory), answers the app's /api/db calls and writes the
    file into the project folder. A worker, so a big import or a save never freezes the screen. */

export type WorkerIn =
  | { kind: 'folder'; id: number; root: string; folder: FileSystemDirectoryHandle }
  | { kind: 'request'; id: number; method: string; url: string; body: ArrayBuffer | string | null }
  | { kind: 'flush'; id: number };
export type WorkerOut = { id: number; status: number; body: string } | { id: number; done: true };

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
  const route = url.pathname.replace(/^\/api\/db\/?/, '');
  const result = await handleDbRequest(folders, m.method, route, url.searchParams, m.body);
  reply({ id: m.id, status: result.status, body: result.body });
};
