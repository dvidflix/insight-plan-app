import { importXer, makeXer, newDatabase, openBytes } from './shared';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const btn = (id: string) => $(id) as HTMLButtonElement;
const show = (id: string, text: string, cls = '') => { const el = $(id); el.className = `out ${cls}`; el.textContent = text; };
const ms = (a: number) => `${Math.round(performance.now() - a)} ms`;
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
const FILE = 'insight-plan-PROOF-TEST.db'; // never the app's own insight-plan.db

let folder: FileSystemDirectoryHandle | null = null;
let mem: Awaited<ReturnType<typeof newDatabase>> | null = null;
const TASKS = 50000;

btn('b1').onclick = async () => {
  try {
    // ?test: use the browser's private storage instead of a picked folder (for automatic checks).
    if (location.search.includes('test')) folder = await navigator.storage.getDirectory();
    else {
      if (!('showDirectoryPicker' in window)) throw new Error('This browser cannot pick a folder. Use Edge or Chrome.');
      folder = await (window as any).showDirectoryPicker({ id: 'insightplan-proof', mode: 'readwrite' });
    }
    const existing = await folder!.getFileHandle(FILE).then(() => true, () => false);
    show('o1', `Folder: ${folder!.name}${existing ? `\n(${FILE} already exists here and will be replaced in step 3)` : ''}`, 'ok');
    btn('b2').disabled = false;
  } catch (e) {
    show('o1', String((e as Error).message ?? e), 'bad');
  }
};

btn('b2').onclick = async () => {
  try {
    btn('b2').disabled = true;
    show('o2', 'Working…');
    await new Promise((r) => setTimeout(r, 30));
    const s = performance.now();
    mem = await newDatabase();
    const xer = makeXer(TASKS);
    const imp = importXer(mem.db, xer, 'Test programme');
    show('o2', `Imported ${imp.rows.toLocaleString()} rows (${TASKS.toLocaleString()} activities) in ${ms(s)}.`, 'ok');
    btn('b3').disabled = false;
  } catch (e) {
    show('o2', String((e as Error).stack ?? e), 'bad');
    btn('b2').disabled = false;
  }
};

btn('b3').onclick = async () => {
  try {
    const s = performance.now();
    const bytes: Uint8Array = mem!.sqlite3.capi.sqlite3_js_db_export(mem!.raw.pointer as number);
    const handle = await folder!.getFileHandle(FILE, { create: true });
    const w = await (handle as any).createWritable();
    await w.write(bytes);
    await w.close();
    show('o3', `Saved ${FILE} (${mb(bytes.length)}) in ${ms(s)}.\nCheck the folder: the file should be there now.`, 'ok');
    btn('b4').disabled = false;
  } catch (e) {
    show('o3', String((e as Error).stack ?? e), 'bad');
  }
};

btn('b4').onclick = async () => {
  try {
    const keep = mem!.sqlite3;
    mem!.raw.close();
    mem = null;
    const s = performance.now();
    const handle = await folder!.getFileHandle(FILE);
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    const raw = openBytes(keep, bytes);
    const tasks = Number(raw.selectValue('select count(*) from TASK'));
    const integrity = raw.selectValue('pragma integrity_check');
    const ok = tasks === TASKS && integrity === 'ok';
    show('o4', `Reopened ${mb(bytes.length)} in ${ms(s)}.\nActivities found: ${tasks.toLocaleString()}\nIntegrity check: ${integrity}\n${ok ? 'PASS: the database round-trips through your folder.' : 'FAIL'}`, ok ? 'ok' : 'bad');
  } catch (e) {
    show('o4', String((e as Error).stack ?? e), 'bad');
  }
};
