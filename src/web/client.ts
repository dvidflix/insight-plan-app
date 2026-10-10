import type { WorkerIn, WorkerOut } from './worker';

/** The browser edition's side of the project database, on the page: starts the data worker, answers the app's /api/db calls
    from it (so the screens work as they do against the server), and handles which folder the project lives in. */

const KEY_DB = 'insight-plan-web';
const KEY_STORE = 'folders';
export const BROWSER_STORAGE_ROOT = 'browser:storage';

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (m: WorkerOut) => void>();

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

function send(msg: WithoutId<WorkerIn>, transfer: Transferable[] = []): Promise<WorkerOut> {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
  }
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ ...msg, id }, transfer);
  });
}

async function toBody(body: BodyInit | null | undefined): Promise<ArrayBuffer | string | null> {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') return body;
  if (body instanceof Blob) return body.arrayBuffer();
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  return new Response(body).arrayBuffer();
}

/** Makes the app's fetches to /api/db go to the data worker. Other /api paths (server features) answer "not available". */
export function installLocalApi() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const headers = { 'Content-Type': 'application/json' };
    if (!/^\/api\/(db|models)(\/|$)/.test(url.pathname)) {
      return new Response(JSON.stringify({ error: 'This feature is not available in the browser edition.' }), { status: 404, headers });
    }
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = await toBody(init?.body ?? null);
    const sent: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => (sent[k.toLowerCase()] = v));
    const out = await send({ kind: 'request', method, url: url.pathname + url.search, headers: sent, body }, body instanceof ArrayBuffer ? [body] : []);
    if (!('status' in out)) return new Response('{}', { status: 500, headers });
    return new Response(out.body, { status: out.status, headers: { ...out.headers, 'Content-Type': out.contentType, 'Access-Control-Expose-Headers': 'x-layers' } });
  };
  // Save the file when the page is hidden or closed.
  const flush = () => void flushProject();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  window.addEventListener('pagehide', flush);
}

export const flushProject = () => send({ kind: 'flush' });

// ---- the project folder: chosen by the user, remembered for next time ----

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KEY_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function remember(root: string, folder: FileSystemDirectoryHandle) {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite');
    tx.objectStore(KEY_STORE).put({ root, folder }, 'project');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function recall(): Promise<{ root: string; folder: FileSystemDirectoryHandle } | null> {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(KEY_STORE).objectStore(KEY_STORE).get('project');
      req.onsuccess = () => resolve((req.result as { root: string; folder: FileSystemDirectoryHandle } | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export const folderPickerSupported = () => 'showDirectoryPicker' in window;

async function attach(root: string, folder: FileSystemDirectoryHandle) {
  await send({ kind: 'folder', root, folder });
}

/** Lets the user pick the project folder (their disk or OneDrive); the app uses it from now on. Returns the project's name for the app. */
export async function chooseProjectFolder(): Promise<{ root: string; name: string }> {
  const folder: FileSystemDirectoryHandle = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ id: 'insightplan-project', mode: 'readwrite' });
  const root = `browser:${folder.name}`;
  await attach(root, folder);
  await remember(root, folder);
  return { root, name: folder.name };
}

/** The browser's own private storage as the project folder (no folder to pick; kept by the browser, not visible as files). */
export async function useBrowserStorage(): Promise<{ root: string; name: string }> {
  const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('insight-plan-project', { create: true });
  await attach(BROWSER_STORAGE_ROOT, folder);
  await remember(BROWSER_STORAGE_ROOT, folder);
  return { root: BROWSER_STORAGE_ROOT, name: 'Browser storage' };
}

export interface RememberedFolder {
  root: string;
  name: string;
  /** True when the browser still lets the app use it; false when the user has to allow it again (one click). */
  ready: boolean;
}

type Permissioned = FileSystemDirectoryHandle & { queryPermission(o: object): Promise<PermissionState>; requestPermission(o: object): Promise<PermissionState> };

/** The folder used last time. When permission is still granted it is attached at once; otherwise `grantRememberedFolder` asks again. */
export async function restoreProjectFolder(): Promise<RememberedFolder | null> {
  const saved = await recall();
  if (!saved) return null;
  const name = saved.root === BROWSER_STORAGE_ROOT ? 'Browser storage' : saved.folder.name;
  const ready = saved.root === BROWSER_STORAGE_ROOT || (await (saved.folder as Permissioned).queryPermission({ mode: 'readwrite' })) === 'granted';
  if (ready) await attach(saved.root, saved.folder);
  return { root: saved.root, name, ready };
}

/** After a click: asks the browser to allow the remembered folder again. */
export async function grantRememberedFolder(): Promise<RememberedFolder | null> {
  const saved = await recall();
  if (!saved) return null;
  const granted = (await (saved.folder as Permissioned).requestPermission({ mode: 'readwrite' })) === 'granted';
  if (granted) await attach(saved.root, saved.folder);
  return { root: saved.root, name: saved.folder.name, ready: granted };
}
