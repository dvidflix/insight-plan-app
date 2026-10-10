import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';
import { BrowserProjectDb } from '../../src/web/browserDb';
import { ProjectFolders } from '../../src/web/files';
import { handleDbRequest } from '../../src/web/router';

/** The browser edition's project database (SQLite in WebAssembly) against the server's (node:sqlite): the same code on both,
    the same file in both directions. */

function xer(tasks: number): string {
  const out = ['ERMHDR\t20.12\t2029-01-01\tProject\tadmin\tadmin\tdb\tProject Management\tUSD'];
  out.push('%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date', '%R\t1\tDEMO\t2029-01-01 08:00');
  out.push('%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttarget_start_date\ttarget_end_date\ttask_type\tstatus_code\ttarget_drtn_hr_cnt');
  for (let i = 1; i <= tasks; i++) out.push(`%R\t${i}\t1\tA${String(i).padStart(4, '0')}\tPour ${i}\t2029-03-${(i % 28) + 1} 08:00\t2029-04-${(i % 28) + 1} 16:00\tTT_Task\tTK_NotStart\t${8 + (i % 5) * 8}`);
  out.push('%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt');
  for (let i = 2; i <= tasks; i++) out.push(`%R\t${i}\t${i}\t${i - 1}\t1\t1\tPR_FS\t0`);
  out.push('%E');
  return out.join('\n');
}
const meta = { name: 'Test', sourceFile: 'programme.xer', sourceFormat: 'xer' as const, kind: 'import' as const, scenario: null, stem: null, projectIds: null };
const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** A folder kept in memory, with the part of FileSystemDirectoryHandle the app uses. */
function fakeFolder(): FileSystemDirectoryHandle & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    name: 'Test project',
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name) && !opts?.create) throw new DOMException('not found', 'NotFoundError');
      return {
        async getFile() {
          const data = files.get(name)!;
          return { arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
        },
        async createWritable() {
          let data = new Uint8Array(0);
          return {
            async write(bytes: Uint8Array) {
              data = new Uint8Array(bytes);
            },
            async close() {
              files.set(name, data);
            },
          };
        },
      };
    },
  } as unknown as FileSystemDirectoryHandle & { files: Map<string, Uint8Array> };
}

describe('project database in the browser edition', () => {
  it('imports a programme exactly as the server does', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-web-'));
    const file = path.join(dir, 'programme.xer');
    fs.writeFileSync(file, xer(60));
    const server = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
    const browser = await BrowserProjectDb.open('browser:test', null);
    try {
      const a = server.importXer(file, meta);
      const b = browser.importXerBytes(bytesOf(xer(60)), meta);
      expect({ ...b, importedAt: '' }).toEqual({ ...a, importedAt: '' });
      expect(browser.programmeTables(b.id).tables).toEqual(server.programmeTables(a.id).tables);
    } finally {
      server.close();
      browser.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers the app’s /api/db calls and saves the file in the folder', async () => {
    const folder = fakeFolder();
    const host = new ProjectFolders();
    host.setFolder('browser:test', folder);
    const call = async (method: string, route: string, query: Record<string, string> = {}, body: ArrayBuffer | string | null = null) => {
      const r = await handleDbRequest(host, method, route, new URLSearchParams(query), body);
      return { status: r.status, json: JSON.parse(r.body) };
    };
    const opened = await call('POST', 'open', {}, JSON.stringify({ root: 'browser:test' }));
    expect(opened.status).toBe(200);
    const imported = await call('POST', 'programmes/import', { root: 'browser:test', name: 'Big', file: 'big.xer', format: 'xer', kind: 'import' }, bytesOf(xer(500)));
    expect(imported.json.programme.activityCount).toBe(500);
    await call('POST', 'settings', {}, JSON.stringify({ root: 'browser:test', key: 'ui:a', value: { x: 1 } }));
    expect((await call('GET', 'save-status', { root: 'browser:test' })).json.dirty).toBe(true);
    await host.flush();
    const saved = folder.files.get('insight-plan.db')!;
    expect(new TextDecoder().decode(saved.slice(0, 15))).toBe('SQLite format 3');

    // A new session opens the saved file and finds everything.
    const next = new ProjectFolders();
    next.setFolder('browser:test', folder);
    const programmes = await handleDbRequest(next, 'GET', 'programmes', new URLSearchParams({ root: 'browser:test' }), null);
    expect(JSON.parse(programmes.body).programmes.map((p: { name: string }) => p.name)).toEqual(['Big']);
    const settings = await handleDbRequest(next, 'GET', 'settings', new URLSearchParams({ root: 'browser:test' }), null);
    expect(JSON.parse(settings.body).settings).toEqual({ 'ui:a': { x: 1 } });
    const tables = await handleDbRequest(next, 'GET', 'programmes/tables', new URLSearchParams({ root: 'browser:test', id: '1' }), null);
    expect(JSON.parse(tables.body).tables.TASK.rows).toHaveLength(500);
    const bad = await call('GET', 'programmes', { root: 'nowhere' });
    expect(bad.status).toBe(400);
  });

  it('opens a file the desktop edition left behind, and the desktop edition opens the browser file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-cross-'));
    try {
      // The server (WAL mode) makes a project, then closes it.
      fs.writeFileSync(path.join(dir, 'p.xer'), xer(30));
      const server = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
      server.importXer(path.join(dir, 'p.xer'), meta);
      server.writeCapacities({ LAB: 8 });
      server.close();

      const browser = await BrowserProjectDb.open('browser:cross', new Uint8Array(fs.readFileSync(path.join(dir, 'insight-plan.db'))));
      expect(browser.programmes()).toHaveLength(1);
      expect(browser.capacities()).toEqual({ LAB: 8 });
      browser.importXerBytes(bytesOf(xer(10)), { ...meta, name: 'Added in the browser' });
      const out = path.join(dir, 'from-browser');
      fs.mkdirSync(out);
      fs.writeFileSync(path.join(out, 'insight-plan.db'), browser.exportFile());
      browser.close();

      const again = new ProjectDb(out, path.join(out, 'insight-plan.db'));
      expect(again.programmes().map((p) => p.name)).toEqual(['Test', 'Added in the browser']);
      expect(again.programmeTables(2).tables.TASK.rows).toHaveLength(10);
      again.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
