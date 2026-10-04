import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { HttpError, send, sendError } from './http';

/** Dev-server API for updating the app from its git repository:
    GET  /api/app/version            the running commit ("fetch=1" also asks
                                     GitHub what is new: behind, changes)
    POST /api/app/update             runs Autorun.bat update in its own window:
                                     stop the server, git pull, npm install,
                                     Python packages, start the server again.
    The page polls /api/app/version until the new commit answers, then
    reloads. Needs git on PATH and a clone with an upstream branch (what
    setup/Install Insight Plan.cmd makes). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args: string[], timeout = 20000): Promise<string> {
  return new Promise((resolve, reject) => {
    // No prompts: a fetch that needs a sign-in fails instead of hanging.
    execFile('git', args, { cwd: ROOT, timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()),
    );
  });
}

interface VersionInfo {
  commit: string;
  date: string;
  branch: string;
  /** Commits on GitHub not here yet (null: not checked, or it failed). */
  behind: number | null;
  changes: { commit: string; date: string; subject: string }[];
  /** Files changed here (a developer's copy): updating is off. */
  dirty: boolean;
  error: string | null;
}

let lastFetch = 0;

async function version(fetchRemote: boolean): Promise<VersionInfo> {
  const info: VersionInfo = { commit: '', date: '', branch: '', behind: null, changes: [], dirty: false, error: null };
  try {
    [info.commit, info.date, info.branch] = await Promise.all([git(['rev-parse', '--short', 'HEAD']), git(['log', '-1', '--format=%cI']), git(['rev-parse', '--abbrev-ref', 'HEAD'])]);
    info.dirty = (await git(['status', '--porcelain', '--untracked-files=no'])).length > 0;
  } catch (e) {
    info.error = `Not a git copy of the app, or git is not installed (${e instanceof Error ? e.message : e}).`;
    return info;
  }
  if (!fetchRemote) return info;
  try {
    // At most one fetch a minute, however many tabs ask.
    if (Date.now() - lastFetch > 60_000) {
      lastFetch = Date.now();
      await git(['fetch', '--quiet']);
    }
    const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => 'origin/main');
    info.behind = Number(await git(['rev-list', '--count', `HEAD..${upstream}`])) || 0;
    if (info.behind) {
      const log = await git(['log', '--format=%h%x09%cI%x09%s', '-n', '30', `HEAD..${upstream}`]);
      info.changes = log.split('\n').filter(Boolean).map((l) => {
        const [commit, date, ...subject] = l.split('\t');
        return { commit, date, subject: subject.join('\t') };
      });
    }
  } catch (e) {
    info.error = `Could not check GitHub for updates (${e instanceof Error ? e.message.split('\n')[0] : e}).`;
  }
  return info;
}

export function appUpdatePlugin(): Plugin {
  return {
    name: 'insight-plan-app-update',
    configureServer(server) {
      server.middlewares.use('/api/app', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const route = url.pathname.replace(/^\/+/, '');
          if (req.method === 'GET' && route === 'version') return send(res, 200, await version(url.searchParams.get('fetch') === '1'));
          if (req.method === 'POST' && route === 'update') {
            if (process.platform !== 'win32') throw new HttpError(400, 'Updating from the app is set up for Windows (Autorun.bat). Run git pull and npm install instead.');
            const info = await version(true);
            if (info.error) throw new HttpError(500, info.error);
            if (info.dirty) throw new HttpError(409, 'This copy of the app has local changes, so it is not updated automatically. Commit or discard them, then pull.');
            if (!info.behind) return send(res, 200, { started: false, message: 'Already up to date.' });
            // Its own window, detached, so it outlives this server (which it stops).
            // Full path: cmd may be set not to run programs from the current folder.
            spawn('cmd.exe', ['/c', 'start', 'Insight Plan update', path.join(ROOT, 'Autorun.bat'), 'update'], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: false }).unref();
            return send(res, 200, { started: true, from: info.commit });
          }
          throw new HttpError(404, `Unknown app endpoint: ${req.method} ${route}`);
        } catch (e) {
          sendError(res, e);
        }
      });
    },
  };
}
