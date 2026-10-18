import { useDataTableStore } from '../state/dataTableStore';
import { scopeOf } from './externalRows';
import { kindOfFile } from './parsers';
import { tableOf, useDataSourcesStore, type FileHandle } from './store';

export const DATA_FILE_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,.xlsb,.xls,.ods,.db,.sqlite,.sqlite3,.db3';

interface Picker { showOpenFilePicker?: (o: unknown) => Promise<(FileHandle & { name?: string })[]> }

/** Adds files as data sources (the table of the last one shows in the Data table). Returns the names that are not data files. */
export async function addDataFiles(files: { file: File; handle?: FileHandle }[]): Promise<string[]> {
  const skipped: string[] = [];
  let last: string | null = null;
  for (const { file, handle } of files) {
    const id = await useDataSourcesStore.getState().add(file, handle);
    if (id) last = id; else skipped.push(file.name);
  }
  if (last) showSource(last);
  return skipped;
}

/** Makes the Data table list a source's (first) table. */
export function showSource(sourceId: string) {
  const st = useDataSourcesStore.getState();
  const meta = st.sources.find((x) => x.id === sourceId);
  const shown = meta ? tableOf(meta, st.data[sourceId]) : null;
  if (meta && shown) useDataTableStore.getState().setScope(scopeOf(sourceId, shown.name));
}

/** The browser's file picker where it can keep each file's handle (so Refresh needs no asking); else the plain one. */
export async function chooseDataFiles(): Promise<string[]> {
  const picker = (window as unknown as Picker).showOpenFilePicker;
  if (picker) {
    try {
      const handles = await picker({ multiple: true, types: [{ description: 'Data files', accept: { 'application/octet-stream': DATA_FILE_ACCEPT.split(',') } }] });
      return await addDataFiles(await Promise.all(handles.map(async (h) => ({ file: await h.getFile(), handle: h }))));
    } catch {
      return [];
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = DATA_FILE_ACCEPT;
    input.onchange = () => void addDataFiles(Array.from(input.files ?? []).map((file) => ({ file }))).then(resolve);
    input.click();
  });
}

/** Chooses a source's file again (when the browser cannot read it from where it was), and reads it. */
export async function chooseFileFor(sourceId: string): Promise<void> {
  const picker = (window as unknown as Picker).showOpenFilePicker;
  if (picker) {
    try {
      const [h] = await picker({ multiple: false, types: [{ description: 'Data files', accept: { 'application/octet-stream': DATA_FILE_ACCEPT.split(',') } }] });
      if (h) await useDataSourcesStore.getState().refresh(sourceId, await h.getFile(), h);
    } catch {
      // cancelled
    }
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = DATA_FILE_ACCEPT;
  input.onchange = () => { const f = input.files?.[0]; if (f) void useDataSourcesStore.getState().refresh(sourceId, f); };
  input.click();
}

/** Files dropped on the table: added as sources, with their handles where the browser gives them. (A drop's items are only readable
    while the event is handled, so each one's file and handle are asked for before anything is awaited.) */
export async function addDroppedFiles(items: DataTransferItemList): Promise<string[]> {
  const pending: { file: File; handle: Promise<FileHandle | null | undefined> }[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (!file || !kindOfFile(file.name)) continue;
    const ask = (item as unknown as { getAsFileSystemHandle?: () => Promise<FileHandle | null> }).getAsFileSystemHandle;
    pending.push({ file, handle: ask ? ask.call(item).catch(() => null) : Promise.resolve(null) });
  }
  const out: { file: File; handle?: FileHandle }[] = [];
  for (const { file, handle } of pending) {
    const h = await handle;
    out.push({ file, handle: h && 'getFile' in h ? h : undefined });
  }
  return addDataFiles(out);
}

/** Whether a drag carries files a data source can read. */
export const dragHasFiles = (e: { dataTransfer: DataTransfer }) => e.dataTransfer.types.includes('Files');
