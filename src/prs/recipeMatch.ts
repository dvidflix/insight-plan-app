import type { Recipe } from './recipes';

/** Which recipe a new recipe should start from, by its name: "Main Slab (stage 2)" copies "Main Slab", "Double Height External Wall" copies
    "External Wall". The recipe whose name is inside the new name wins (the longest one), else the one sharing the most words; null when none
    fits. Only recipes that have tasks count, and the "(stage 2)" kind of ending is ignored. */
const words = (s: string): string[] => s.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length > 2);
const plain = (s: string): string => words(s).join(' ');

export function templateFor(name: string, recipes: Recipe[]): Recipe | null {
  const mine = plain(name);
  if (!mine) return null;
  const candidates = recipes.filter((r) => r.chain !== false && r.enabled !== false && r.tasks.length > 0);
  const exact = candidates.find((r) => plain(r.id) === mine);
  if (exact) return exact;
  // A name that is inside this one ("external wall" in "double height external wall"), the longest first.
  const inside = candidates.filter((r) => plain(r.id) && mine.includes(plain(r.id))).sort((a, b) => plain(b.id).length - plain(a.id).length);
  if (inside.length) return inside[0];
  // Else the most words in common (at least one).
  const mineWords = new Set(words(name));
  let best: Recipe | null = null;
  let bestScore = 0;
  for (const r of candidates) {
    const score = words(r.id).filter((w) => mineWords.has(w)).length;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

/** The end of an activity's ID for a task: its suffix, else the initials of its phase ("Under Slab" -> "-US"), as the generator makes it. */
export function suffixOf(task: { phase: string; suffix?: string }): string {
  const s = (task.suffix ?? '').trim();
  return s || '-' + task.phase.replace(/,/g, ' ').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase();
}
