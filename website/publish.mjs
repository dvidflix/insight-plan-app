// Makes the folder that goes to Cloudflare:  node website/publish.mjs
// It builds the pages, then copies only what the public site needs into website-dist/ (no build scripts, no README),
// with a _headers file for the security headers. The contact-form worker is not in that folder
// (see "Publish on Cloudflare" in website/README.md).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SITE = import.meta.dirname;
const OUT = path.join(SITE, '..', 'website-dist');

execFileSync(process.execPath, [path.join(SITE, 'build.mjs')], { stdio: 'inherit' });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const PUBLIC = /\.(html|css|png|svg|ico|webp|jpg|jpeg|txt|xml)$/i;
let count = 0;
for (const name of readdirSync(SITE)) {
  const file = path.join(SITE, name);
  if (statSync(file).isFile() && PUBLIC.test(name)) { cpSync(file, path.join(OUT, name)); count++; }
}
if (existsSync(path.join(SITE, 'fonts'))) cpSync(path.join(SITE, 'fonts'), path.join(OUT, 'fonts'), { recursive: true });

// Security headers for every page, and a long cache for the font files.
writeFileSync(path.join(OUT, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  X-Frame-Options: DENY',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
  "  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'",
  '/fonts/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
].join('\n'));

console.log(`\n${count} files, the fonts folder and _headers are in ${OUT}\nNow upload that folder in the Cloudflare dashboard (see website/README.md)`);
