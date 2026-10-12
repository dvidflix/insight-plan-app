// Builds the customer package: release/InsightPlan-<version>/ (and a .zip) with everything needed on a Windows laptop with no
// internet: the product build of the app, its server, the Wiki, the Scenarios generator, and the Node runtime it runs on.
//   npm run package
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const out = path.join(root, 'release', `InsightPlan-${version}`);

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
// The runtime: the Node.js that built it (22.5 or later has the built-in SQLite the project database uses).
mkdirSync(path.join(out, 'runtime'), { recursive: true });
cpSync(process.execPath, path.join(out, 'runtime', 'node.exe'));

writeFileSync(path.join(out, 'Start Insight Plan.cmd'), [
  '@echo off',
  'title Insight Plan',
  'cd /d "%~dp0"',
  'if not defined SCENARIO_PYTHON for /f "tokens=2,*" %%a in (\'reg query HKCU\Environment /v SCENARIO_PYTHON 2^>nul ^| find "SCENARIO_PYTHON"\') do set "SCENARIO_PYTHON=%%b"',
  'set PORT=4173',
  'REM The app opens in its own window (Chrome or Edge) once the server answers.',
  'start "" /min powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 40;$i++){try{(Invoke-WebRequest http://127.0.0.1:%PORT% -UseBasicParsing -TimeoutSec 1)|Out-Null;break}catch{Start-Sleep -Milliseconds 500}}; $b=@(\'chrome\',\'msedge\')|ForEach-Object{(Get-Command $_ -ErrorAction SilentlyContinue).Source}|Select-Object -First 1; if($b){Start-Process $b \'--app=http://127.0.0.1:%PORT%\'}else{Start-Process http://127.0.0.1:%PORT%}"',
  '"%~dp0runtime\node.exe" "%~dp0server-dist\server.mjs"',
  'pause',
  '',
].join('\r\n'));
writeFileSync(path.join(out, 'README.txt'), [
  `Insight Plan ${version}`,
  '',
  'Double-click "Start Insight Plan.cmd". The app opens in its own window and works without an internet connection.',
  'Closing the black window stops it. Your data stays on this computer, in the project folder you choose in the app.',
  '',
  'The Scenarios generator (optional) needs Python 3.12 with the packages in scenario-engine\requirements.txt.',
  'Third-party software notices: THIRD-PARTY-NOTICES.txt (licence texts) and THIRD-PARTY-LICENSES.json (the list)',
  '',
].join('\r\n'));

if (existsSync(path.join(out, '..', `InsightPlan-${version}.zip`))) rmSync(path.join(out, '..', `InsightPlan-${version}.zip`));
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${out}' -DestinationPath '${out}.zip'"`, { stdio: 'inherit' });
console.log(`\nPackage: ${out}.zip`);
