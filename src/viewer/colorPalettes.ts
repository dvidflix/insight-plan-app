/** Palettes for colouring models by a property (Models > Colour). */
export const MODEL_PALETTES: { id: string; label: string; colors: string[] }[] = [
  { id: 'vivid', label: 'Vivid', colors: ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'] },
  { id: 'pastel', label: 'Pastel', colors: ['#aecbf2', '#b9e6b0', '#f5e79c', '#f6b8cb', '#c9b8f2', '#9fe0dc', '#f6c89f', '#d9dde0', '#e3c9a8', '#b8e0f6', '#dcf2b8', '#f2b8e6'] },
  { id: 'project', label: 'Project', colors: ['#00588B', '#0678A7', '#59571A', '#F2B708', '#F1860D', '#7788FF', '#7B8787', '#C8C5C1'] },
  { id: 'earth', label: 'Earth', colors: ['#8c6d31', '#bd9e39', '#e7ba52', '#e7cb94', '#843c39', '#ad494a', '#d6616b', '#e7969c', '#637939', '#8ca252', '#b5cf6b', '#cedb9c'] },
  { id: 'traffic', label: 'Traffic', colors: ['#2e7d32', '#9ccc65', '#fdd835', '#fb8c00', '#e53935', '#8e24aa'] },
  { id: 'blues', label: 'Blues (ordered)', colors: ['#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'] },
];

/** `n` well-spread random colours (golden-ratio hues from a random start,
    so neighbours differ); `seed` picks the start. */
export function randomColors(n: number, seed: number): string[] {
  const out: string[] = [];
  let h = seed % 1;
  for (let i = 0; i < n; i++) {
    h = (h + 0.618033988749895) % 1;
    const s = 0.55 + ((i * 7) % 5) * 0.08;
    const l = 0.5 + ((i * 3) % 4) * 0.06;
    out.push(hslToHex(h, s, l));
  }
  return out;
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Colours for `n` values from a palette id (or 'random' with `seed`). */
export function paletteColors(id: string, n: number, seed: number): string[] {
  if (id === 'random') return randomColors(n, seed);
  const p = MODEL_PALETTES.find((x) => x.id === id) ?? MODEL_PALETTES[0];
  return Array.from({ length: n }, (_, i) => p.colors[i % p.colors.length]);
}
