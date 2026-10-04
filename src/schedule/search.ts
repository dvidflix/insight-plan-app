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
