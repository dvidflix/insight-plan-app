import { HttpError } from '../db/core';
import type { FolderModelStore } from './modelStore';

/** The browser edition's answer to the app's /api/models calls (the same routes as vite-plugins/modelsPlugin.ts). Models
    are binary, so a reply is JSON text or bytes with their headers. */

export interface ModelsHost {
  models(root: unknown): Promise<FolderModelStore>;
}

export interface ModelsReply {
  status: number;
  body: string | Uint8Array;
  contentType: string;
  headers?: Record<string, string>;
}

const json = (value: unknown, status = 200): ModelsReply => ({ status, body: JSON.stringify(value), contentType: 'application/json' });
const bytes = (data: Uint8Array, headers?: Record<string, string>): ModelsReply => ({ status: 200, body: data, contentType: 'application/octet-stream', headers });

const nameParam = (raw: unknown) => {
  const name = String(raw ?? '').trim();
  if (!name || /[\\/]/.test(name)) throw new HttpError(400, 'No (or an invalid) model name given.');
  return name;
};

function jsonBody(body: ArrayBuffer | string | null): any {
  const text = body === null ? '' : typeof body === 'string' ? body : new TextDecoder().decode(body);
  return text ? JSON.parse(text) : {};
}

/** `route` is the path after /api/models/. */
export async function handleModelsRequest(host: ModelsHost, method: string, route: string, query: URLSearchParams, headers: Record<string, string>, body: ArrayBuffer | string | null): Promise<ModelsReply> {
  try {
    const get = method === 'GET';
    const post = method === 'POST';
    const fragVersion = query.get('fragVersion') ?? '';
    const root = query.get('root');

    if (get && route === 'list') return json({ models: await (await host.models(root)).list(fragVersion) });
    if (get && route === 'versions') return json({ versions: await (await host.models(root)).versions(nameParam(query.get('name'))) });
    if (get && route === 'ifc') {
      const version = query.get('version');
      return bytes(await (await host.models(root)).getIfc(nameParam(query.get('name')), version ? Number(version) : undefined));
    }
    if (get && route === 'frag') {
      const found = await (await host.models(root)).getFrag(nameParam(query.get('name')), fragVersion);
      if (!found) return json({ error: 'No converted copy of this model.' }, 404);
      return bytes(found.frag, found.layers ? { 'x-layers': encodeURIComponent(found.layers) } : undefined);
    }
    if (post && route === 'ifc') {
      if (!(body instanceof ArrayBuffer)) throw new HttpError(400, 'No model file sent.');
      return json(await (await host.models(root)).saveIfc(nameParam(query.get('name')), body, query.get('note')));
    }
    if (post && route === 'frag') {
      if (!(body instanceof ArrayBuffer)) throw new HttpError(400, 'No converted model sent.');
      const layers = headers['x-layers'] ? decodeURIComponent(headers['x-layers']) : null;
      const stored = await (await host.models(root)).saveFrag(nameParam(query.get('name')), String(query.get('hash') ?? ''), fragVersion, body, layers);
      return json({ stored });
    }
    if (post && route === 'restore') {
      const b = jsonBody(body);
      await (await host.models(b.root)).restore(nameParam(b.name), Number(b.id));
      return json({ ok: true });
    }
    if (post && route === 'delete') {
      const b = jsonBody(body);
      await (await host.models(b.root)).delete(nameParam(b.name));
      return json({ ok: true });
    }
    throw new HttpError(404, `Unknown model-store endpoint: ${route}`);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof HttpError ? e.status : 500);
  }
}
