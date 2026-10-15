// Builds the customer package: release/InsightPlan-<version>/ (and a .zip) with everything needed on a Windows laptop with no
// internet and nothing installed: the product build of the app, its server, the Wiki, the Scenarios generator, and the Node and
// Python runtimes it runs on.
//   npm run package
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { copyPython } from './bundle-python.mjs';

const root = path.resolve(import.meta.dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const out = path.join(root, 'release', `InsightPlan-${version}`);
// Bump when the runtime folder (Node, Python and its packages) changes in a way an app-only update cannot cover:
// installs on a lower number are told to download the full package (see server/packageUpdater.ts).
const RUNTIME_LEVEL = 1;

// The notices first: the app build carries them (public/THIRD-PARTY-NOTICES.txt).
run('npm run licenses');
run('npm run build:product');
run('npm run build:server');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const copy = (from, to = from, filter) => cpSync(path.join(root, from), path.join(out, to), { recursive: true, filter });
copy('dist');
copy('server-dist');
copy('docs');
copy('scenario-engine', 'scenario-engine', (src) => !/__pycache__|[\/]tests([\/]|$)|_tmp_clash|\.pyc$/.test(src));
copy('THIRD-PARTY-LICENSES.json');
copy('public/THIRD-PARTY-NOTICES.txt', 'THIRD-PARTY-NOTICES.txt');
// The runtimes: the Node.js that built it (22.5 or later has the built-in SQLite the project database uses), and a private Python
// with the Scenarios generator's packages (built once into .cache/, see bundle-python.mjs).
mkdirSync(path.join(out, 'runtime'), { recursive: true });
cpSync(process.execPath, path.join(out, 'runtime', 'node.exe'));
await copyPython(path.join(out, 'runtime', 'python'));

// What this install is, for the updater; and where it looks for updates (INSIGHT_UPDATE_URL when packaging; else add update.json later).
writeFileSync(path.join(out, 'version.json'), JSON.stringify({ version, runtime: RUNTIME_LEVEL }));
if (process.env.INSIGHT_UPDATE_URL) writeFileSync(path.join(out, 'update.json'), JSON.stringify({ manifest: process.env.INSIGHT_UPDATE_URL, ...(process.env.INSIGHT_UPDATE_TOKEN ? { token: process.env.INSIGHT_UPDATE_TOKEN } : {}) }, null, 2));

// The launcher is a real file (scripts/Start Insight Plan.cmd), not a string here: JavaScript would eat its backslashes.
const launcher = readFileSync(path.join(import.meta.dirname, 'Start Insight Plan.cmd'), 'utf8').replace(/\r?\n/g, '\r\n');
writeFileSync(path.join(out, 'Start Insight Plan.cmd'), launcher);
writeFileSync(path.join(out, 'README.txt'), [
  `Insight Plan ${version}`,
  '',
  'Unzip this folder somewhere on your computer (not inside the zip), then double-click "Start Insight Plan.cmd".',
  'The app opens in its own window and works without an internet connection. Closing the black window stops it.',
  'Your data stays on this computer, in the project folder you choose in the app.',
  '',
  'Nothing else needs installing: Node.js and Python (for the Scenarios generator and the model tools) are in the "runtime" folder.',
  'Chrome or Edge must be installed.',
  '',
  'Updates: when a new version is published the app downloads it in the background and shows "Update available" at the top.',
  'Click it, then "Restart and update" (or just start the app again later): your project folders are not touched.',
  '',
  'Third-party software notices: THIRD-PARTY-NOTICES.txt (licence texts) and THIRD-PARTY-LICENSES.json (the list)',
  '',
].join('\r\n'));

if (existsSync(path.join(out, '..', `InsightPlan-${version}.zip`))) rmSync(path.join(out, '..', `InsightPlan-${version}.zip`));
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${out}' -DestinationPath '${out}.zip'"`, { stdio: 'inherit' });
console.log(`\nPackage: ${out}.zip`);
