import fs from 'node:fs';
import type { Plugin } from 'vite';
import { HttpError, send, sendError } from './http';

/** External data (SeaTable) and Dashboards (Superset): the app's two tabs that show those
    programs in a frame. This bridge signs in for the user, so the frame opens already logged in.

      GET /api/external/status          both targets: address, whether they answer, whether they allow a frame
      GET /api/external/open?target=…   signs in on the server (the admin account of the stack's .env files),
                                        hands the browser the session cookie, then redirects to the program.

    Why the cookie works across ports: browsers keep cookies per host, not per port, so a session cookie
    set while answering on localhost:5173 is sent to localhost:80 (SeaTable) and localhost:8088 (Superset) too.

    Settings: SEATABLE_ENV_FILE (default C:\insight-stack\seatable\.env: SEATABLE_SERVER_PROTOCOL / _HOSTNAME,
    SEATABLE_ADMIN_EMAIL / _PASSWORD), SUPERSET_URL (default http://localhost:8088) and SUPERSET_ENV_FILE
    (default C:\insight-stack\superset\docker\.env-local: ADMIN_USERNAME, ADMIN_PASSWORD). */

const SEATABLE_ENV = process.env.SEATABLE_ENV_FILE ?? 'C:\\insight-stack\\seatable\\.env';
const SUPERSET_ENV = process.env.SUPERSET_ENV_FILE ?? 'C:\\insight-stack\\superset\\docker\\.env-local';

type Target = 'seatable' | 'superset';

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function config(target: Target) {
  if (target === 'seatable') {
    const env = readEnv(SEATABLE_ENV);
    return {
      base: `${env.SEATABLE_SERVER_PROTOCOL || 'http'}://${env.SEATABLE_SERVER_HOSTNAME || 'localhost'}`,
      user: env.SEATABLE_ADMIN_EMAIL ?? '',
      password: env.SEATABLE_ADMIN_PASSWORD ?? '',
    };
  }
  const env = readEnv(SUPERSET_ENV);
  return { base: (process.env.SUPERSET_URL ?? 'http://localhost:8088').replace(/\/+$/, ''), user: env.ADMIN_USERNAME || 'admin', password: env.ADMIN_PASSWORD ?? '' };
}

/** The name=value pairs of a response's cookies, for sending back. */
const cookieHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

/** Cookies a response sets: name -> raw Set-Cookie line (also remembered in `jar`). */
function collect(res: Response, jar: Map<string, string>, raw: Map<string, string>) {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i < 0) continue;
    const name = pair.slice(0, i).trim();
    jar.set(name, pair.slice(i + 1));
    raw.set(name, line);
  }
}

const input = (html: string, name: string) => {
  const m = new RegExp(`<input[^>]*name="${name}"[^>]*>`, 'i').exec(html);
  return m ? /value="([^"]*)"/i.exec(m[0])?.[1] ?? null : null;
};

/** Signs in and returns the session cookies to give the browser (null when it did not work). */
async function login(target: Target): Promise<string[] | null> {
  const { base, user, password } = config(target);
  if (!user || !password) return null;
  const jar = new Map<string, string>();
  const raw = new Map<string, string>();
  const page = target === 'seatable' ? '/accounts/login/' : '/login/';
  const first = await fetch(`${base}${page}`, { signal: AbortSignal.timeout(8000) });
  collect(first, jar, raw);
  const html = await first.text();
  const form = new URLSearchParams();
  if (target === 'seatable') {
    form.set('login', user);
    form.set('password', password);
    form.set('csrfmiddlewaretoken', input(html, 'csrfmiddlewaretoken') ?? '');
    form.set('next', '/');
  } else {
    form.set('username', user);
    form.set('password', password);
    form.set('csrf_token', input(html, 'csrf_token') ?? '');
  }
  const res = await fetch(`${base}${page}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar), Referer: `${base}${page}` },
    body: form,
    signal: AbortSignal.timeout(8000),
  });
  collect(res, jar, raw);
  // A successful sign-in redirects away from the login page.
  if (res.status < 300 || res.status >= 400 || /login/.test(res.headers.get('location') ?? '')) return null;
  const session = target === 'seatable' ? 'sessionid' : 'session';
  const line = raw.get(session);
  if (!line) return null;
  // Host-only cookie (no Domain), valid on the whole site, whatever port the program answers on.
  return [line.split(';').filter((p, i) => i === 0 || !/^\s*domain=/i.test(p)).join(';')];
}

async function probe(target: Target, appOrigin: string) {
  const { base } = config(target);
  try {
    const res = await fetch(`${base}/`, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
    const csp = res.headers.get('content-security-policy') ?? '';
    const ancestors = /frame-ancestors([^;]*)/i.exec(csp)?.[1] ?? null;
    const xfo = (res.headers.get('x-frame-options') ?? '').toUpperCase();
    // A CSP frame-ancestors list wins over X-Frame-Options.
    const frameable = ancestors !== null ? ancestors.includes(appOrigin) || ancestors.includes('*') : !xfo || xfo === 'ALLOWALL';
    return { url: base, reachable: true, frameable };
  } catch {
    return { url: base, reachable: false, frameable: false };
  }
}

export function externalPlugin(): Plugin {
  return {
    name: 'insight-plan-external',
    configureServer(server) {
      server.middlewares.use('/api/external', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const route = url.pathname.replace(/^\/+/, '');
          const origin = `http://${req.headers.host ?? 'localhost:5173'}`;
          if (route === 'status') {
            const [seatable, superset] = await Promise.all([probe('seatable', origin), probe('superset', origin)]);
            return send(res, 200, { seatable, superset });
          }
          if (route === 'open') {
            const target = url.searchParams.get('target');
            if (target !== 'seatable' && target !== 'superset') throw new HttpError(400, 'Unknown target.');
            const { base } = config(target);
            const to = url.searchParams.get('to') ?? '/';
            let cookies: string[] | null = null;
            try {
              cookies = await login(target);
            } catch {
              // not reachable: the redirect shows the browser's own error
            }
            res.statusCode = 302;
            if (cookies) res.setHeader('Set-Cookie', cookies);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Location', `${base}${/^\/(?!\/)/.test(to) ? to : '/'}`);
            return res.end();
          }
          throw new HttpError(404, 'Unknown route.');
        } catch (e) {
          sendError(res, e);
        }
      });
    },
  };
}
