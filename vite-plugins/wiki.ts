import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { HttpError, readBody, send, sendError } from './http';

/** Dev-server API for the Wiki: Markdown pages kept in the repo at
    docs/wiki/<section>/<page>.md, images and videos in docs/wiki/media.
    The app reads the pages with import.meta.glob (so they are in the build
    too, and reach colleagues with the app's updates); this only writes.
    POST /api/wiki/save          {slug: "section/page", markdown}
    POST /api/wiki/delete        {slug}
    POST /api/wiki/media?name=   body: the file → {path: "media/<name>"} */

export const WIKI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/wiki');
const PART = '[a-z0-9][a-z0-9-]{0,80}';
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|mp4|webm)$/i;

function slugOf(raw: unknown): string {
  const slug = String(raw ?? '').trim();
  if (!new RegExp(`^${PART}/${PART}$`).test(slug)) throw new HttpError(400, `Invalid page name "${slug}": section/page, lower-case letters, digits and dashes.`);
  return slug;
}

export function wikiPlugin(): Plugin {
  return {
    name: 'insight-plan-wiki',
    configureServer(server) {
      server.middlewares.use('/api/wiki', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const route = url.pathname.replace(/^\/+/, '');
          if (req.method === 'POST' && route === 'save') {
            const body = await readBody(req);
            const slug = slugOf(body.slug);
            if (typeof body.markdown !== 'string') throw new HttpError(400, 'No page text given.');
            const file = path.join(WIKI_DIR, `${slug}.md`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, body.markdown.replace(/\r\n/g, '\n'), 'utf8');
            return send(res, 200, { ok: true });
          }
          if (req.method === 'POST' && route === 'delete') {
            const slug = slugOf((await readBody(req)).slug);
            if (slug.endsWith('/index')) throw new HttpError(400, "A section's home page cannot be deleted.");
            fs.rmSync(path.join(WIKI_DIR, `${slug}.md`), { force: true });
            return send(res, 200, { ok: true });
          }
          if (req.method === 'POST' && route === 'media') {
            // Screenshots and videos: a safe, unique file name in docs/wiki/media.
            const raw = String(url.searchParams.get('name') ?? 'file');
            const ext = (MEDIA_EXT.exec(raw)?.[0] ?? '').toLowerCase();
            if (!ext) throw new HttpError(400, 'Images (png, jpg, gif, webp, svg) and videos (mp4, webm) only.');
            const base = path.basename(raw, path.extname(raw)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file';
            const dir = path.join(WIKI_DIR, 'media');
            fs.mkdirSync(dir, { recursive: true });
            let name = `${base}${ext}`;
            for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}${ext}`;
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const c of req) {
              size += (c as Buffer).length;
              if (size > 200 * 1024 * 1024) throw new HttpError(413, 'Files up to 200 MB.');
              chunks.push(c as Buffer);
            }
            fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
            return send(res, 200, { path: `media/${name}` });
          }
          throw new HttpError(404, `Unknown wiki endpoint: ${req.method} ${route}`);
        } catch (e) {
          sendError(res, e);
        }
      });
    },
  };
}
