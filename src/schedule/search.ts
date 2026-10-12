import type { Activity } from './types';

const haystacks = new WeakMap<Activity, string>();

/** Everything searchable about an activity as one lowercase text: ID, name, WBS, status, every activity code and user
    defined field value, and the names of its resources. A search box matches against this, so it finds any value. */
export function activitySearchText(a: Activity): string {
  let text = haystacks.get(a);
  if (text === undefined) {
    const parts: string[] = [a.code, a.name, a.wbsPath, a.type, a.status, a.constraintType ?? '', a.durationType ?? ''];
    for (const v of Object.values(a.activityCodes ?? {})) parts.push(String(v));
    for (const [k, v] of Object.entries(a.udf ?? {})) parts.push(k, v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
    for (const r of a.resources ?? []) parts.push(r.resourceName);
    text = parts.join('\n').toLowerCase();
    haystacks.set(a, text);
  }
  return text;
}

/** Splits a search query into lowercased tokens, OR'd against each other —
    supports pasting/typing a list (e.g. a column copied from Excel): split
    on newlines, commas, semicolons or a literal " || ". Ported verbatim from
    insight-plan-web's app.js so search behaves identically. */
export function searchTokens(query: string): string[] {
  return String(query || '')
    .split(/\r?\n|,|;|\|\|/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function matchesSearchTokens(text: string | undefined, tokens: string[]): boolean {
  const v = String(text || '').toLowerCase();
  return tokens.some((t) => v.includes(t));
}

/** A search box's test: does `text` contain any of the query's terms
    (split on commas, "||" and the rest, as searchTokens)? Everything
    matches an empty query. */
export function queryMatcher(query: string): (text: string | undefined) => boolean {
  const tokens = searchTokens(query);
  return tokens.length ? (text) => matchesSearchTokens(text, tokens) : () => true;
}
