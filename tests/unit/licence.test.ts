import { describe, expect, it } from 'vitest';
import { checkLicence, pageLicensed } from '../../src/licence/licence';

const b64 = (b: ArrayBuffer | string) => Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64url');

async function issue(payload: object) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const body = b64(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(body));
  return { key: `IP1.${body}.${b64(sig)}`, publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) };
}
const now = new Date('2026-10-10T12:00:00Z');

describe('licence key', () => {
  it('accepts a signed key and counts the days left', async () => {
    const { key, publicKey } = await issue({ v: 1, customer: 'Acme', expires: '2026-10-20', seats: 3 });
    expect(await checkLicence(key, now, publicKey)).toMatchObject({ ok: true, daysLeft: 11, licence: { customer: 'Acme', seats: 3 } });
  });
  it('refuses an expired key, but not on its last day', async () => {
    const old = await issue({ v: 1, customer: 'Acme', expires: '2026-10-09', seats: 1 });
    expect((await checkLicence(old.key, now, old.publicKey)).ok).toBe(false);
    const last = await issue({ v: 1, customer: 'Acme', expires: '2026-10-10', seats: 1 });
    expect((await checkLicence(last.key, now, last.publicKey)).ok).toBe(true);
  });
  it('refuses an edited payload and a key signed by someone else', async () => {
    const { key, publicKey } = await issue({ v: 1, customer: 'Acme', expires: '2026-10-20', seats: 1 });
    const [h, , s] = key.split('.');
    const forged = `${h}.${b64(JSON.stringify({ v: 1, customer: 'Acme', expires: '2099-01-01', seats: 1 }))}.${s}`;
    expect((await checkLicence(forged, now, publicKey)).ok).toBe(false);
    const other = await issue({ v: 1, customer: 'Acme', expires: '2026-10-20', seats: 1 });
    expect((await checkLicence(other.key, now, publicKey)).ok).toBe(false);
  });
  it('refuses text that is not a key', async () => {
    expect((await checkLicence('hello')).ok).toBe(false);
  });
  it('unlocks both modules for a key that names none', async () => {
    const { key, publicKey } = await issue({ v: 1, customer: 'Acme', expires: '2026-10-20', seats: 1 });
    expect(await checkLicence(key, now, publicKey)).toMatchObject({ ok: true, licence: { modules: ['programmes', 'models'] } });
  });
  it('keeps only the modules a key names, and covers pages accordingly', async () => {
    const { key, publicKey } = await issue({ v: 1, customer: 'Acme', expires: '2026-10-20', seats: 1, modules: ['models'] });
    const r = await checkLicence(key, now, publicKey);
    expect(r).toMatchObject({ ok: true, licence: { modules: ['models'] } });
    const modules = r.ok ? r.licence.modules : [];
    expect(pageLicensed('model', modules)).toBe(true);
    expect(pageLicensed('schedule', modules)).toBe(false);
    expect(pageLicensed('sequence', modules)).toBe(false);
    expect(pageLicensed('inputs', modules)).toBe(true);
    expect(pageLicensed('sequence', ['programmes', 'models'])).toBe(true);
  });
});
