/** Browser side of the file details in SeaTable ("Insight Plan Files", see vite-plugins/seatablePlugin.ts):
    push the files of the Inputs page, read back the details their users fill in. */

export interface FileDetailField {
  name: string;
  type: string;
}

export interface FileDetails {
  fields: FileDetailField[];
  /** file name -> field -> values (a file can have several buildings). */
  values: Record<string, Record<string, string[]>>;
  note?: string;
}

export interface PushFile {
  name: string;
  type: string;
  format: string;
  items: number | null;
  sizeMb: number | null;
  bounds: string;
  /** Details typed in the app before, used only for files that are new in SeaTable. */
  details?: Record<string, string[]>;
}

async function api<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/seatable/${path}`, init ? { method: init.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body ?? {}) } : undefined);
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`SeaTable bridge: ${res.status} ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(json.error ?? `SeaTable bridge: ${res.status}`);
  return json as T;
}

export async function fetchFileDetails(): Promise<FileDetails> {
  const r = await api<{ fields: FileDetailField[]; files: { name: string; values: Record<string, string[]> }[]; note?: string }>('files');
  return { fields: r.fields, values: Object.fromEntries(r.files.map((f) => [f.name, f.values])), note: r.note };
}

export const pushFiles = (files: PushFile[]) => api<{ added: number; updated: number }>('files/push', { method: 'POST', body: { files } });
