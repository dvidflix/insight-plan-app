/** Client for the project's model store (vite-plugins/modelsPlugin.ts):
    <project folder>/insight-plan-models.db holds each model's IFC, its converted
    .frag (a cache of the IFC) and a short history of earlier IFCs. */

/** Bump when the IFC-to-fragments conversion changes: stored .frag files from before are ignored. */
export const FRAG_CACHE_VERSION = 'frag-3.4-1';

export interface StoredModel {
  name: string;
  ifcSize: number;
  ifcHash: string;
  /** A converted copy that fits the IFC is stored: opening skips the conversion. */
  cached: boolean;
  note: string | null;
  updatedAt: string;
  versions: number;
}

export interface StoredVersion {
  id: number;
  createdAt: string;
  ifcSize: number;
  note: string | null;
}

const enc = encodeURIComponent;

async function fail(res: Response): Promise<never> {
  const body = await res.json().catch(() => null);
  throw new Error(body?.error ?? `The model store failed (${res.status}).`);
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api/models/${path}`, init);
  } catch {
    throw new Error('Could not reach the model store: run the app with Autorun.bat / npm run dev.');
  }
  return res;
}

export async function listStoredModels(root: string): Promise<StoredModel[]> {
  const res = await call(`list?root=${enc(root)}&fragVersion=${enc(FRAG_CACHE_VERSION)}`);
  if (!res.ok) return fail(res);
  return ((await res.json()) as { models: StoredModel[] }).models;
}

export async function saveStoredIfc(root: string, name: string, bytes: ArrayBuffer | Uint8Array, note?: string): Promise<{ hash: string; changed: boolean }> {
  const res = await call(`ifc?root=${enc(root)}&name=${enc(name)}${note ? `&note=${enc(note)}` : ''}`, { method: 'POST', body: new Blob([bytes as BlobPart]) });
  if (!res.ok) return fail(res);
  return res.json();
}

export async function getStoredIfc(root: string, name: string, version?: number): Promise<ArrayBuffer> {
  const res = await call(`ifc?root=${enc(root)}&name=${enc(name)}${version ? `&version=${version}` : ''}`);
  if (!res.ok) return fail(res);
  return res.arrayBuffer();
}

export async function saveStoredFrag(root: string, name: string, hash: string, frag: ArrayBuffer | Uint8Array, layers: [string, number[]][]): Promise<boolean> {
  const res = await call(`frag?root=${enc(root)}&name=${enc(name)}&hash=${enc(hash)}&fragVersion=${enc(FRAG_CACHE_VERSION)}`, {
    method: 'POST',
    headers: { 'x-layers': enc(JSON.stringify(layers)) },
    body: new Blob([frag as BlobPart]),
  });
  if (!res.ok) return fail(res);
  return ((await res.json()) as { stored: boolean }).stored;
}

/** The converted copy, or null when none fits the stored IFC. */
export async function getStoredFrag(root: string, name: string): Promise<{ buffer: ArrayBuffer; layers: [string, number[]][] } | null> {
  const res = await call(`frag?root=${enc(root)}&name=${enc(name)}&fragVersion=${enc(FRAG_CACHE_VERSION)}`);
  if (res.status === 404) return null;
  if (!res.ok) return fail(res);
  const header = res.headers.get('x-layers');
  let layers: [string, number[]][] = [];
  try {
    layers = header ? (JSON.parse(decodeURIComponent(header)) as [string, number[]][]) : [];
  } catch {
    layers = [];
  }
  return { buffer: await res.arrayBuffer(), layers };
}

export async function listStoredVersions(root: string, name: string): Promise<StoredVersion[]> {
  const res = await call(`versions?root=${enc(root)}&name=${enc(name)}`);
  if (!res.ok) return fail(res);
  return ((await res.json()) as { versions: StoredVersion[] }).versions;
}

async function post(path: string, body: unknown) {
  const res = await call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return fail(res);
}

export const restoreStoredVersion = (root: string, name: string, id: number) => post('restore', { root, name, id });
export const deleteStoredModel = (root: string, name: string) => post('delete', { root, name });
