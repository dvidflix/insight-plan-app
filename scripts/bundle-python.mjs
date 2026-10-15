// Prepares a private copy of Python for the customer package, so the Scenarios generator and the IFC tools work on a laptop with
// nothing installed. Python's "embeddable" build plus the packages in scenario-engine/requirements.txt, kept in .cache/ so it is
// only built once (delete .cache/python-runtime to rebuild, e.g. after changing requirements.txt).
//   node scripts/bundle-python.mjs   (package.mjs calls it)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PYTHON_VERSION = '3.12.9';
const root = path.resolve(import.meta.dirname, '..');
const cache = path.join(root, '.cache');
const target = path.join(cache, 'python-runtime');
const stamp = path.join(target, '.built-for');

const requirements = readFileSync(path.join(root, 'scenario-engine', 'requirements.txt'), 'utf8');
const wanted = `${PYTHON_VERSION}:${createHash('sha256').update(requirements).digest('hex')}`;

async function download(url, to) {
  if (existsSync(to) && statSync(to).size > 0) return;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

function dirSize(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}

/** Returns the folder holding the prepared Python (python.exe at its top level). */
export async function bundlePython() {
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted) {
    console.log('Python runtime: using the cached copy in .cache/python-runtime');
    return target;
  }
  mkdirSync(cache, { recursive: true });
  const zip = path.join(cache, `python-${PYTHON_VERSION}-embed-amd64.zip`);
  const getPip = path.join(cache, 'get-pip.py');
  await download(`https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`, zip);
  await download('https://bootstrap.pypa.io/get-pip.py', getPip);

  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${target}' -Force`], { stdio: 'inherit' });

  // The embeddable build runs in isolated mode (no PYTHONPATH, no script folder on sys.path, no site). Its ._pth file is the
  // only place to say where to look: its own packages, and the engine's folder (two levels up, next to the app's runtime folder).
  const pth = path.join(target, `python${PYTHON_VERSION.split('.').slice(0, 2).join('')}._pth`);
  writeFileSync(pth, [
    `python${PYTHON_VERSION.split('.').slice(0, 2).join('')}.zip`,
    '.',
    'Lib\\site-packages',
    '..\\..\\scenario-engine',
    'import site',
    '',
  ].join('\r\n'));

  const python = path.join(target, 'python.exe');
  execFileSync(python, [getPip, '--no-warn-script-location', '--disable-pip-version-check'], { stdio: 'inherit' });
  execFileSync(python, ['-m', 'pip', 'install', '--no-warn-script-location', '--disable-pip-version-check', '-r', path.join(root, 'scenario-engine', 'requirements.txt')], { stdio: 'inherit' });

  // Trim what a customer never needs: pip itself, test suites, caches.
  const sp = path.join(target, 'Lib', 'site-packages');
  for (const name of readdirSync(sp)) {
    if (/^(pip|setuptools|wheel)(-|$)/.test(name) || name === '__pycache__') rmSync(path.join(sp, name), { recursive: true, force: true });
  }
  rmSync(path.join(target, 'Scripts'), { recursive: true, force: true });
  (function prune(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__pycache__') rmSync(p, { recursive: true, force: true });
        else prune(p);
      }
    }
  })(target);

  writeFileSync(stamp, wanted);
  console.log(`Python runtime ready: ${(dirSize(target) / 1048576).toFixed(0)} MB`);
  return target;
}

export function copyPython(into) {
  return bundlePython().then((from) => cpSync(from, into, { recursive: true }));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) await bundlePython();
