import { LICENCE_PUBLIC_KEY } from './publicKey';

/** A licence key is "IP1.<payload>.<signature>": the payload is JSON (base64url), signed with ECDSA P-256 / SHA-256, so the
    check works offline, in the browser, with no server. Made by tools/licence.mjs. */
/** What a licence unlocks: the Programmes pages, the Models pages, or both (4D needs both). */
export type LicenceModule = 'programmes' | 'models';
export const ALL_MODULES: LicenceModule[] = ['programmes', 'models'];

export interface Licence {
  customer: string;
  /** Last day of use, YYYY-MM-DD (inclusive). */
  expires: string;
  seats: number;
  project?: string;
  /** Keys issued before modules existed carry none, and unlock everything. */
  modules: LicenceModule[];
}

/** The modules named in a key; anything missing or unreadable means both, so older keys keep working. */
export function parseModules(value: unknown): LicenceModule[] {
  if (!Array.isArray(value)) return [...ALL_MODULES];
  const wanted = ALL_MODULES.filter((m) => value.includes(m));
  return wanted.length ? wanted : [...ALL_MODULES];
}

/** Whether the licensed modules cover a page. Inputs, Help and the rest are open to every licence. */
export function pageLicensed(page: string, modules: readonly LicenceModule[]): boolean {
  const needs: LicenceModule[] = page === 'model' ? ['models'] : page === 'schedule' ? ['programmes'] : page === 'sequence' || page === 'scenarios' ? ALL_MODULES : [];
  return needs.every((m) => modules.includes(m));
}

export type LicenceCheck = { ok: true; licence: Licence; daysLeft: number } | { ok: false; reason: string };

export const STORE_KEY = 'insight-plan.licence';

const fromB64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export const daysUntil = (day: string, now = new Date()) => Math.floor((Date.parse(`${day}T23:59:59Z`) - now.getTime()) / 86_400_000) + 1;

/** Checks the signature and the dates of a key. `now` and `publicKey` are for tests. */
export async function checkLicence(key: string, now = new Date(), publicKey: JsonWebKey = LICENCE_PUBLIC_KEY): Promise<LicenceCheck> {
  const parts = key.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'IP1') return { ok: false, reason: 'This is not an Insight Plan licence key.' };
  let licence: Licence;
  try {
    const verifier = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, fromB64Url(parts[2]), new TextEncoder().encode(parts[1]));
    if (!valid) return { ok: false, reason: 'The key is not valid. Check it was copied completely.' };
    const payload = JSON.parse(new TextDecoder().decode(fromB64Url(parts[1])));
    if (payload.v !== 1 || typeof payload.customer !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.expires)) return { ok: false, reason: 'The key is not valid.' };
    licence = { customer: payload.customer, expires: payload.expires, seats: Number(payload.seats) || 1, project: typeof payload.project === 'string' ? payload.project : undefined, modules: parseModules(payload.modules) };
  } catch {
    return { ok: false, reason: 'The key is not valid. Check it was copied completely.' };
  }
  const daysLeft = daysUntil(licence.expires, now);
  if (daysLeft <= 0) return { ok: false, reason: `This licence ran out on ${licence.expires}. Ask for a renewal key.` };
  return { ok: true, licence, daysLeft };
}

export function savedLicenceKey(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveLicenceKey(key: string) {
  try {
    localStorage.setItem(STORE_KEY, key.trim());
  } catch {
    /* kept for this visit only */
  }
}
export function forgetLicenceKey() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* nothing kept */
  }
}
