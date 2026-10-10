import { describe, expect, it } from 'vitest';
import { FolderModelStore } from '../../src/web/modelStore';
import { handleModelsRequest } from '../../src/web/modelsRouter';

/** A folder kept in memory, with the part of FileSystemDirectoryHandle the model store uses. */
class FakeDir {
  kind = 'directory' as const;
  files = new Map<string, Uint8Array>();
  dirs = new Map<string, FakeDir>();
  constructor(public name = 'project') {}
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
      d = new FakeDir(name);
      this.dirs.set(name, d);
    }
    return d;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name) && !opts?.create) throw new DOMException('not found', 'NotFoundError');
    const files = this.files;
    return {
      kind: 'file' as const,
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
  }
  async removeEntry(name: string) {
    if (!this.files.delete(name)) throw new DOMException('not found', 'NotFoundError');
  }
  async *entries() {
    for (const name of this.files.keys()) yield [name, { kind: 'file' as const }] as const;
  }
}

const ifc = (text: string) => new TextEncoder().encode(text);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('model store in the browser edition', () => {
  const make = () => {
    const project = new FakeDir();
    return { project, store: new FolderModelStore(project as unknown as FileSystemDirectoryHandle) };
  };

  it('keeps a model, ignores the same IFC again, and keeps a short history of changes', async () => {
    const { store } = make();
    const first = await store.saveIfc('Tower A.ifc', ifc('IFC v1'), 'first');
    expect(first.changed).toBe(true);
    expect((await store.saveIfc('Tower A.ifc', ifc('IFC v1'), 'again')).changed).toBe(false);
    await store.saveIfc('Tower A.ifc', ifc('IFC v2'), 'edited');
    expect(text(await store.getIfc('Tower A.ifc'))).toBe('IFC v2');
    const list = await store.list('f1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Tower A.ifc', ifcSize: 6, note: 'edited', versions: 1, cached: false });
    const versions = await store.versions('Tower A.ifc');
    expect(text(await store.getIfc('Tower A.ifc', versions[0].id))).toBe('IFC v1');
  });

  it('uses the converted copy only while it fits the current IFC and converter', async () => {
    const { store } = make();
    const { hash } = await store.saveIfc('B.ifc', ifc('one'), null);
    expect(await store.saveFrag('B.ifc', 'wrong-hash', 'f1', ifc('FRAG'), null)).toBe(false);
    expect(await store.saveFrag('B.ifc', hash, 'f1', ifc('FRAG'), '[["L",[1]]]')).toBe(true);
    expect((await store.list('f1'))[0].cached).toBe(true);
    expect((await store.list('f2'))[0].cached).toBe(false);
    expect(text((await store.getFrag('B.ifc', 'f1'))!.frag)).toBe('FRAG');
    expect(await store.getFrag('B.ifc', 'f2')).toBeNull();
    await store.saveIfc('B.ifc', ifc('two'), null);
    expect(await store.getFrag('B.ifc', 'f1')).toBeNull();
  });

  it('restores an earlier version, limits the history and deletes everything of a model', async () => {
    const { project, store } = make();
    for (let i = 1; i <= 9; i++) await store.saveIfc('C.ifc', ifc(`rev ${i}`), `rev ${i}`);
    const versions = await store.versions('C.ifc');
    expect(versions).toHaveLength(5);
    const oldest = versions[versions.length - 1];
    await store.restore('C.ifc', oldest.id);
    expect(text(await store.getIfc('C.ifc'))).toBe(`rev ${8 - 4}`);
    await store.delete('C.ifc');
    expect(await store.list('f1')).toEqual([]);
    expect([...(project.dirs.get('insight-plan-models')!.files.keys())]).toEqual([]);
  });

  it('answers the app’s /api/models calls with bytes and the layers header', async () => {
    const { store } = make();
    const host = { models: async () => store };
    const call = (method: string, route: string, query: Record<string, string>, body: ArrayBuffer | string | null = null, headers: Record<string, string> = {}) =>
      handleModelsRequest(host, method, route, new URLSearchParams(query), headers, body);
    const saved = await call('POST', 'ifc', { root: 'r', name: 'D.ifc' }, ifc('IFC DATA').buffer as ArrayBuffer);
    const { hash } = JSON.parse(saved.body as string);
    await call('POST', 'frag', { root: 'r', name: 'D.ifc', hash, fragVersion: 'f1' }, ifc('FRAG DATA').buffer as ArrayBuffer, { 'x-layers': encodeURIComponent('[["A",[1,2]]]') });
    const frag = await call('GET', 'frag', { root: 'r', name: 'D.ifc', fragVersion: 'f1' });
    expect(text(frag.body as Uint8Array)).toBe('FRAG DATA');
    expect(decodeURIComponent(frag.headers!['x-layers'])).toBe('[["A",[1,2]]]');
    expect((await call('GET', 'frag', { root: 'r', name: 'D.ifc', fragVersion: 'other' })).status).toBe(404);
    expect((await call('GET', 'ifc', { root: 'r', name: '../x' })).status).toBe(400);
    expect(JSON.parse((await call('GET', 'list', { root: 'r', fragVersion: 'f1' })).body as string).models[0].cached).toBe(true);
  });
});
