/** A point as text, "X, Y, Z" (metres, project axes): the form the Point coordinates tool copies, so a copied point
    pastes straight into a corner of a construction plane. */

export type Coord = [number, number, number];

export const formatCoord = (c: Coord): string => c.map((v) => (Number.isFinite(v) ? v.toFixed(3) : '0.000')).join(', ');

/** Three numbers from text, separated by commas, semicolons, tabs (a pasted spreadsheet row) or spaces. A decimal
    comma works when the numbers are separated by semicolons, tabs or spaces ("1930,8  5997,35  -5,18"). Null when the
    text does not hold exactly three numbers. */
export function parseCoord(text: string): Coord | null {
  const t = text.trim();
  if (!t) return null;
  const semicolonOrTab = /[;\t]/.test(t);
  const spaced = !t.includes(',') || /\d,\d/.test(t) && !/,\s/.test(t) && /\s/.test(t);
  let parts: string[];
  if (semicolonOrTab) parts = t.split(/[;\t]+/);
  else if (spaced && /\s/.test(t)) parts = t.split(/\s+/);
  else parts = t.split(/\s*,\s*|\s+/);
  parts = parts.map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 3) return null;
  // A decimal comma is read only where commas cannot be separators.
  const decimalComma = semicolonOrTab || (spaced && /\s/.test(t));
  const nums = parts.map((p) => Number(decimalComma ? p.replace(',', '.') : p));
  return nums.every((n) => Number.isFinite(n)) ? (nums as Coord) : null;
}
