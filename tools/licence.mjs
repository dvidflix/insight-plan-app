// Issues licence keys for the browser edition. Offline: the app checks the signature with the public key in src/licence/publicKey.ts.
//   node tools/licence.mjs keygen                      makes tools/licence-private.jwk (keep it secret) and prints the public key to paste into src/licence/publicKey.ts
//   node tools/licence.mjs issue "Customer" 2027-10-10 [--seats 3] [--project "Name"] [--modules programmes|models|both]
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const keyFile = fileURLToPath(new URL('./licence-private.jwk', import.meta.url));
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'keygen') {
  if (existsSync(keyFile)) throw new Error(`${keyFile} exists already. Replacing it would invalidate every key issued so far; delete it yourself if that is what you want.`);
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(keyFile, JSON.stringify(privateKey.export({ format: 'jwk' })));
  console.log('Private key written to', keyFile, '(never commit it).\nPublic key for src/licence/publicKey.ts:\n' + JSON.stringify(publicKey.export({ format: 'jwk' })));
} else if (cmd === 'issue') {
  const [customer, expires] = args;
  if (!customer || !/^\d{4}-\d{2}-\d{2}$/.test(expires ?? '')) throw new Error('Usage: node tools/licence.mjs issue "Customer" YYYY-MM-DD [--seats n] [--project "Name"]');
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const mods = opt('--modules') ?? 'both';
  if (!['programmes', 'models', 'both'].includes(mods)) throw new Error('--modules is programmes, models or both');
  const payload = { v: 1, customer, expires, seats: Number(opt('--seats') ?? 3), modules: mods === 'both' ? ['programmes', 'models'] : [mods], ...(opt('--project') ? { project: opt('--project') } : {}), issued: new Date().toISOString().slice(0, 10) };
  const body = b64(JSON.stringify(payload));
  const key = createPrivateKey({ key: JSON.parse(readFileSync(keyFile, 'utf8')), format: 'jwk' });
  console.log(`IP1.${body}.${b64(sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }))}`);
} else {
  throw new Error('Commands: keygen | issue');
}
