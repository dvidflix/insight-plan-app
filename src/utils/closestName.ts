/** The name among `candidates` that `target` most likely became after a rename or a move, or null when none is close. Only the letters are
    compared (case, spaces and folder paths aside), never what the words mean: the same name in another folder first, then the nearest spelling
    (at most a third of the letters different). */

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
const lastPart = (s: string) => norm(s.split('/').pop() ?? s);

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

export function closestName(target: string, candidates: readonly string[]): string | null {
  const t = norm(target);
  if (!t) return null;
  const same = candidates.find((c) => norm(c) === t) ?? candidates.find((c) => lastPart(c) === lastPart(t));
  if (same) return same;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const n = lastPart(c);
    const d = distance(lastPart(t), n);
    if (d < bestScore && d <= Math.floor(Math.max(n.length, lastPart(t).length) / 3)) { best = c; bestScore = d; }
  }
  return best;
}
