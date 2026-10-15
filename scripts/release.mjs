// Publishes an update for the packaged app: makes release/update/ with the app-only zip and the signed latest.json, from the
// package that `npm run package` built. Upload both files to the update address (see docs/updates.md).
//   npm run release -- --notes "What changed" --notes "Another change"
//   node scripts/release.mjs --notes "..." [--runtime 1]
// The update holds the app (dist, server-dist, scenario-engine, docs, version.json, notices) but not the Node and Python
// runtimes, so it is small. latest.json is signed with tools/licence-private.jwk, the key behind the licence keys.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const src = path.join(root, 'release', `InsightPlan-${version}`);
const outDir = path.join(root, 'release', 'update');
const keyFile = path.join(root, 'tools', 'licence-private.jwk');

const args = process.argv.slice(2);
const notes = args.flatMap((a, i) => (a === '--notes' && args[i + 1] ? [args[i + 1]] : []));
const runtime = Number(args[args.indexOf('--runtime') + 1]) || JSON.parse(readFileSync(path.join(src, 'version.json'), 'utf8')).runtime;

if (!existsSync(path.join(src, 'version.json'))) throw new Error(`${src} is not built. Run: npm run package`);
if (!existsSync(keyFile)) throw new Error(`${keyFile} not found: it signs the update, and is the same private key as the licence keys.`);
if (!notes.length) throw new Error('Say what changed: --notes "..." (once per line; shown to users in "Update available").');

const parts = ['dist', 'server-dist', 'scenario-engine', 'docs', 'version.json', 'THIRD-PARTY-NOTICES.txt', 'THIRD-PARTY-LICENSES.json'].filter((p) => existsSync(path.join(src, p)));
mkdirSync(outDir, { recursive: true });
const file = `InsightPlan-app-${version}.zip`;
const zip = path.join(outDir, file);
rmSync(zip, { force: true });
// Windows' own tar.exe (10+) writes a normal zip with forward-slash paths; the full path, as Git's GNU tar may come first on the PATH.
execFileSync(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, '-C', src, ...parts], { stdio: 'inherit' });

const payload = Buffer.from(JSON.stringify({
  v: 1,
  version,
  published: new Date().toISOString().slice(0, 10),
  notes,
  runtime,
  package: { file, sha256: createHash('sha256').update(readFileSync(zip)).digest('hex'), size: statSync(zip).size },
})).toString('base64url');
const key = createPrivateKey({ key: JSON.parse(readFileSync(keyFile, 'utf8')), format: 'jwk' });
const sig = sign('sha256', Buffer.from(payload), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify({ payload, sig }));

console.log(`\nUpdate ${version}: ${outDir}\n  ${file} (${(statSync(zip).size / 1048576).toFixed(1)} MB)\n  latest.json\nUpload latest.json last, so nobody sees it before the zip is there.`);
