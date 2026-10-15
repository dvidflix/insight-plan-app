import { execFile } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LICENCE_PUBLIC_KEY } from '../src/licence/publicKey';
import { HttpError, send, sendError } from '../vite-plugins/http';

/** Self-update of the packaged (product) edition, with no git and no accounts.

    The app looks for a small signed file, latest.json, at the address in update.json (next to this app) or in the
    INSIGHT_UPDATE_URL environment variable. When it names a newer version, the app downloads the update zip (just the app: dist,
    server-dist, scenario-engine, docs — not the Node and Python runtimes), checks its SHA-256 against the signed file, unpacks it
    into updates/staged and says "ready". The next start of "Start Insight Plan.cmd" installs it (keeping the old files in
    updates/backup); "Update now" in the app restarts it at once (exit code 75 makes the launcher install and start again).

    latest.json is { payload, sig }: payload is base64url JSON, sig an ECDSA P-256 signature of it made with the same private key
    as the licence keys (tools/licence-private.jwk, scripts/release.mjs). Only that key can publish an update.

    GET  /api/app/version[?check=1]   what is running, and what update (if any) is waiting. check=1 looks now (at most once a minute).
    POST /api/app/update              when an update is ready: restart now. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPDATES = path.join(ROOT, 'updates');
const STAGED = path.join(UPDATES, 'staged');
export const RESTART_EXIT_CODE = 75;
const CHECK_EVERY = 4 * 60 * 60 * 1000;
const MAX_DOWNLOAD = 600 * 1024 * 1024;

interface Manifest {
  v: 1;
  version: string;
  published: string;
  notes: string[];
  /** The runtime folder (Node, Python) the update needs. A higher number than this install's means a full download. */
  runtime: number;
  package: { file: string; sha256: string; size: number };
}

type Phase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

export interface UpdateStatus {
  /** An update address is set. */
  configured: boolean;
  current: { version: string; runtime: number };
  phase: Phase;
  available: { version: string; published: string; notes: string[]; requiresFullInstall: boolean } | null;
  error: string | null;
  checkedAt: string | null;
}

function installed(): { version: string; runtime: number } {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    if (typeof v.version === 'string') return { version: v.version, runtime: Number(v.runtime) || 1 };
  } catch { /* a copy that is not a package: no updates */ }
  return { version: '', runtime: 1 };
}

/** 1 when a is newer than b. Numbers only ("0.1.10" > "0.1.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function readManifest(text: string): Manifest {
  const wrapper = JSON.parse(text) as { payload?: unknown; sig?: unknown };
  if (typeof wrapper.payload !== 'string' || typeof wrapper.sig !== 'string') throw new Error('The update file is not in the expected format.');
  const ok = verify('sha256', Buffer.from(wrapper.payload), { key: createPublicKey({ key: LICENCE_PUBLIC_KEY as never, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(wrapper.sig, 'base64url'));
  if (!ok) throw new Error('The update file is not signed by Insight Plan, so it was ignored.');
  const m = JSON.parse(Buffer.from(wrapper.payload, 'base64url').toString('utf8')) as Manifest;
  if (m.v !== 1 || typeof m.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(m.version) || !m.package || !/^[\w.-]+\.zip$/.test(m.package.file) || !/^[0-9a-f]{64}$/.test(m.package.sha256)) {
    throw new Error('The update file is incomplete.');
  }
  return { ...m, notes: Array.isArray(m.notes) ? m.notes.map(String) : [], runtime: Number(m.runtime) || 1 };
}

function config(): { manifest: string; token: string } | null {
  let manifest = process.env.INSIGHT_UPDATE_URL ?? '';
  let token = process.env.INSIGHT_UPDATE_TOKEN ?? '';
  try {
    const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'update.json'), 'utf8'));
    manifest ||= String(file.manifest ?? '');
    token ||= String(file.token ?? '');
  } catch { /* none */ }
  if (!manifest) return null;
  const url = new URL(manifest);
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !local) throw new Error('The update address must be https.');
  return { manifest, token };
}

/** The address with the access token (e.g. an Azure SAS query) added. */
function withToken(url: string, token: string): string {
  if (!token) return url;
  const u = new URL(url);
  const extra = token.replace(/^\?/, '');
  u.search = u.search ? `${u.search}&${extra}` : `?${extra}`;
  return u.toString();
}

function extract(zip: string, dir: string): Promise<void> {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // Windows' own tar.exe (10 and later) reads zip files; the full path, as Git's GNU tar may come first on the PATH.
  return new Promise((resolve, reject) => execFile(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir], { windowsHide: true, timeout: 5 * 60 * 1000 }, (err, _o, stderr) => (err ? reject(new Error(`Could not unpack the update: ${(stderr || err.message).trim()}`)) : resolve())));
}

async function download(url: string, to: string, expected: { sha256: string; size: number }): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`Could not download the update (HTTP ${res.status}).`);
  if (expected.size > MAX_DOWNLOAD) throw new Error('The update is larger than expected, so it was ignored.');
  const hash = createHash('sha256');
  const out = fs.createWriteStream(to);
  let bytes = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > MAX_DOWNLOAD) throw new Error('The update is larger than expected, so it was ignored.');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()));
  }
  if (hash.digest('hex') !== expected.sha256 || bytes !== expected.size) throw new Error('The downloaded update does not match its signed description, so it was discarded.');
}

export function registerPackageUpdater(
  middlewares: { use(prefix: string, handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>): void },
  restart: (code: number) => void,
): void {
  const current = installed();
  const status: UpdateStatus = { configured: false, current, phase: 'idle', available: null, error: null, checkedAt: null };
  let running = false;

  // An update staged earlier (and not installed yet) is still ready.
  try {
    const ready = JSON.parse(fs.readFileSync(path.join(STAGED, '.ready'), 'utf8')) as { version: string; published: string; notes: string[] };
    if (current.version && compareVersions(ready.version, current.version) > 0) {
      status.phase = 'ready';
      status.available = { version: ready.version, published: ready.published, notes: ready.notes ?? [], requiresFullInstall: false };
    }
  } catch { /* nothing staged */ }

  async function check(): Promise<void> {
    if (running || !current.version) return;
    running = true;
    const wasReady = status.phase === 'ready';
    try {
      const cfg = config();
      status.configured = !!cfg;
      if (!cfg) return;
      if (!wasReady) status.phase = 'checking';
      status.error = null;
      const res = await fetch(withToken(cfg.manifest, cfg.token), { signal: AbortSignal.timeout(20_000), headers: { 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`Could not reach the update server (HTTP ${res.status}).`);
      const m = readManifest(await res.text());
      status.checkedAt = new Date().toISOString();
      if (compareVersions(m.version, current.version) <= 0) {
        status.phase = 'idle';
        status.available = null;
        return;
      }
      const available = { version: m.version, published: m.published, notes: m.notes, requiresFullInstall: m.runtime > current.runtime };
      if (status.available?.version === m.version && wasReady) return; // already staged
      status.available = available;
      if (available.requiresFullInstall) {
        status.phase = 'idle';
        return;
      }
      status.phase = 'downloading';
      fs.mkdirSync(UPDATES, { recursive: true });
      const zip = path.join(UPDATES, 'download.zip');
      await download(withToken(new URL(m.package.file, cfg.manifest).toString(), cfg.token), zip, m.package);
      const tmp = path.join(UPDATES, 'staged-new');
      await extract(zip, tmp);
      const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'version.json'), 'utf8'));
      if (meta.version !== m.version || !fs.existsSync(path.join(tmp, 'server-dist', 'server.mjs')) || !fs.existsSync(path.join(tmp, 'dist', 'index.html'))) {
        throw new Error('The update package is not complete, so it was discarded.');
      }
      fs.writeFileSync(path.join(tmp, '.ready'), JSON.stringify({ version: m.version, published: m.published, notes: m.notes }));
      fs.rmSync(STAGED, { recursive: true, force: true });
      fs.renameSync(tmp, STAGED);
      fs.rmSync(zip, { force: true });
      status.phase = 'ready';
    } catch (e) {
      if (status.phase !== 'ready') status.phase = 'error';
      // A server that is simply unreachable (offline) is not worth shouting about.
      status.error = e instanceof Error ? e.message : String(e);
      if (/fetch failed|timed out|aborted|ENOTFOUND|ECONNREFUSED/i.test(status.error)) {
        status.error = 'Could not reach the update server (offline?).';
        if (status.phase === 'error') status.phase = 'idle';
      }
    } finally {
      running = false;
    }
  }

  if (current.version) {
    setTimeout(() => void check(), 10_000).unref();
    setInterval(() => void check(), CHECK_EVERY).unref();
  }
  let lastAsked = 0;

  middlewares.use('/api/app', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = url.pathname.replace(/^\/+/, '');
      if (req.method === 'GET' && route === 'version') {
        if (url.searchParams.get('check') === '1' && Date.now() - lastAsked > 60_000) {
          lastAsked = Date.now();
          void check();
        }
        try { status.configured = !!config(); } catch (e) { status.configured = false; status.error = e instanceof Error ? e.message : String(e); }
        return send(res, 200, status);
      }
      if (req.method === 'POST' && route === 'update') {
        if (status.phase !== 'ready') throw new HttpError(409, 'There is no update ready to install.');
        send(res, 200, { restarting: true, to: status.available?.version });
        // Let the answer go out, then stop: the launcher installs the staged files and starts the app again.
        setTimeout(() => restart(RESTART_EXIT_CODE), 400);
        return;
      }
      throw new HttpError(404, `Unknown app endpoint: ${req.method} ${route}`);
    } catch (e) {
      sendError(res, e);
    }
  });
}
