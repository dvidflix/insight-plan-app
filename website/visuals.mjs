// Drawn illustrations for the site (generic: no real project data). Used by build.mjs.

const f = (n) => Math.round(n * 10) / 10;

// ---- Logo: three stacked slabs rising in an isometric view; the top one is still a dashed outline (not poured yet).
function slabPaths(cx, y0, hw, hh, t) {
  const top = `M${cx} ${y0}L${cx + hw} ${y0 + hh}L${cx} ${y0 + 2 * hh}L${cx - hw} ${y0 + hh}Z`;
  const left = `M${cx - hw} ${y0 + hh}L${cx} ${y0 + 2 * hh}L${cx} ${y0 + 2 * hh + t}L${cx - hw} ${y0 + hh + t}Z`;
  const right = `M${cx + hw} ${y0 + hh}L${cx} ${y0 + 2 * hh}L${cx} ${y0 + 2 * hh + t}L${cx + hw} ${y0 + hh + t}Z`;
  return { top, left, right };
}
export function logoMark(id = 'lm') {
  const hw = 19, hh = 11, t = 6, cx = 32;
  const base = slabPaths(cx, 33, hw, hh, t);
  const mid = slabPaths(cx, 21, hw, hh, t);
  const up = slabPaths(cx, 9, hw, hh, t);
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs>
<linearGradient id="${id}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b3a8f"/><stop offset="1" stop-color="#0b1330"/></linearGradient>
<linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f93ff"/><stop offset="1" stop-color="#3b5bfd"/></linearGradient>
<linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#14b8a6"/></linearGradient></defs>
<rect width="64" height="64" rx="15" fill="url(#${id}bg)"/>
<g transform="translate(8 6) scale(.75)">
<path d="${base.left}" fill="#2339b8"/><path d="${base.right}" fill="#2f49d9"/><path d="${base.top}" fill="url(#${id}a)"/>
<path d="${mid.left}" fill="#0d8f82"/><path d="${mid.right}" fill="#14b8a6"/><path d="${mid.top}" fill="url(#${id}b)"/>
<path d="${up.top}" fill="#f59e0b" fill-opacity=".18" stroke="#fbbf24" stroke-width="2.6" stroke-dasharray="3.4 3" stroke-linejoin="round"/>
</g></svg>`;
}

// ---- Isometric building rising in pours. `phase` = how many pours are built; later ones are drawn as ghost outlines.
const COLORS = ['#2f49d9', '#3b6bf0', '#4f7cff', '#22a6d6', '#14b8a6', '#f59e0b'];
function project(x, y, z, a, b) {
  return [(x - y) * a, (x + y) * b - z * 15];
}
function box(parts, { x, y, z, w, d, h }, fill, ghost, a, b) {
  const P = (px, py, pz) => project(px, py, pz, a, b).map(f).join(',');
  const top = `${P(x, y, z + h)} ${P(x + w, y, z + h)} ${P(x + w, y + d, z + h)} ${P(x, y + d, z + h)}`;
  const left = `${P(x, y + d, z + h)} ${P(x + w, y + d, z + h)} ${P(x + w, y + d, z)} ${P(x, y + d, z)}`;
  const right = `${P(x + w, y, z + h)} ${P(x + w, y + d, z + h)} ${P(x + w, y + d, z)} ${P(x + w, y, z)}`;
  if (ghost) {
    const st = 'fill="none" stroke="#8b96b8" stroke-width="1" stroke-dasharray="3 3" stroke-linejoin="round" opacity=".7"';
    parts.push(`<polygon points="${left}" ${st}/><polygon points="${right}" ${st}/><polygon points="${top}" ${st}/>`);
  } else {
    parts.push(`<polygon points="${left}" fill="${fill}" fill-opacity=".78"/><polygon points="${right}" fill="${fill}" fill-opacity=".58"/><polygon points="${top}" fill="${fill}" stroke="#fff" stroke-width=".6" stroke-linejoin="round"/>`);
  }
}
export function building({ phase = 5, colourBy = 'pour', width = 560 } = {}) {
  const a = 24, b = 13.5;
  // pour list: raft, then per level the walls and the slab
  const pours = [];
  pours.push({ n: 1, boxes: [{ x: 0, y: 0, z: 0, w: 7, d: 5, h: 1.6 }] });
  let z = 1.6;
  let n = 2;
  for (let level = 0; level < 3; level++) {
    const walls = [
      { x: 0, y: 0, w: 2.4, d: 1.1 }, { x: 4.6, y: 0, w: 2.4, d: 1.1 },
      { x: 0, y: 3.9, w: 2.4, d: 1.1 }, { x: 4.6, y: 3.9, w: 2.4, d: 1.1 },
      { x: 2.9, y: 1.7, w: 1.2, d: 1.6 }, { x: 0, y: 1.7, w: 1.1, d: 1.6 }, { x: 5.9, y: 1.7, w: 1.1, d: 1.6 },
    ].map((w) => ({ ...w, z, h: 3.6 }));
    pours.push({ n: n++, level, boxes: walls });
    z += 3.6;
    pours.push({ n: n++, level, boxes: [{ x: 0, y: 0, z, w: 7, d: 5, h: 0.9 }] });
    z += 0.9;
  }
  const levelColour = ['#4f7cff', '#22a6d6', '#14b8a6'];
  const parts = [];
  const all = pours.flatMap((p) => p.boxes.map((bx) => ({ bx, p })));
  all.sort((u, v) => u.bx.x + u.bx.y + u.bx.w + u.bx.d - (v.bx.x + v.bx.y + v.bx.w + v.bx.d) || u.bx.z - v.bx.z);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const { bx } of all) {
    for (const [px, py, pz] of [[bx.x, bx.y + bx.d, bx.z], [bx.x + bx.w, bx.y, bx.z + bx.h], [bx.x + bx.w, bx.y + bx.d, bx.z], [bx.x, bx.y, bx.z + bx.h]]) {
      const [sx, sy] = project(px, py, pz, a, b);
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
  }
  for (const { bx, p } of all) {
    const built = p.n <= phase;
    const active = p.n === phase;
    let fill;
    if (colourBy === 'level') fill = p.level === undefined ? '#6b7a90' : levelColour[p.level];
    else fill = active ? '#f59e0b' : COLORS[Math.min(COLORS.length - 2, Math.floor(((p.n - 1) / pours.length) * (COLORS.length - 1)))];
    box(parts, bx, fill, !built, a, b);
  }
  const pad = 14;
  const vb = `${f(minX - pad)} ${f(minY - pad)} ${f(maxX - minX + 2 * pad)} ${f(maxY - minY + 2 * pad)}`;
  return `<svg viewBox="${vb}" width="${width}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Isometric building rising pour by pour">${parts.join('')}</svg>`;
}

// ---- A mini Gantt panel: rows of bars, the data-date line in orange.
export function gantt({ rows = 8 } = {}) {
  const bars = [[4, 22, 0], [14, 30, 1], [26, 38, 2], [34, 52, 0], [44, 60, 1], [54, 74, 2], [66, 84, 0], [76, 94, 1]];
  const colour = ['#2f49d9', '#4f7cff', '#14b8a6'];
  const out = [];
  for (let i = 0; i < rows; i++) {
    const [s, e, c] = bars[i];
    const y = 14 + i * 22;
    out.push(`<rect x="0" y="${y - 4}" width="260" height="1" fill="#e4e8f2"/><rect x="${s * 2.4}" y="${y}" width="${(e - s) * 2.4}" height="11" rx="5.5" fill="${colour[c]}" fill-opacity="${e < 56 ? 1 : 0.4}"/>`);
  }
  return `<svg viewBox="0 0 260 ${rows * 22 + 16}" width="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${out.join('')}<rect x="${56 * 2.4}" y="0" width="2" height="${rows * 22 + 16}" fill="#f59e0b"/></svg>`;
}

// ---- Weekly bars with two cumulative curves (baseline vs a new draft).
export function curves() {
  const bars = (x0, vals, fill) => vals.map((v, i) => `<rect x="${x0 + i * 20}" y="${240 - v}" width="9" height="${v}" rx="2" fill="${fill}" fill-opacity=".3"/>`).join('');
  return `<svg viewBox="0 0 640 280" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Weekly bars and cumulative curves for two programmes">
<g stroke="#e4e8f2"><line x1="30" y1="40" x2="620" y2="40"/><line x1="30" y1="100" x2="620" y2="100"/><line x1="30" y1="160" x2="620" y2="160"/><line x1="30" y1="240" x2="620" y2="240" stroke="#d2d2d7"/></g>
${bars(44, [60, 90, 120, 150, 170, 160, 140, 120, 135, 155, 175, 150, 110, 80], '#3b5bfd')}
${bars(190, [40, 70, 100, 130, 150, 170, 150, 120, 90, 60, 40], '#f59e0b')}
<path d="M30 238C130 220 200 170 290 130S450 70 520 52 590 40 612 36" fill="none" stroke="#3b5bfd" stroke-width="3.5" stroke-linecap="round"/>
<path d="M30 238C150 232 230 205 320 165S470 110 540 92 600 80 612 76" fill="none" stroke="#f59e0b" stroke-width="3.5" stroke-linecap="round"/>
<g font-family="system-ui,sans-serif" font-size="12" fill="#5b6580"><text x="30" y="264">Week 1</text><text x="570" y="264">Week 52</text><text x="470" y="28" fill="#3b5bfd">Baseline</text><text x="540" y="28" fill="#f59e0b">New draft</text></g></svg>`;
}

// ---- The product window used in the hero: a 4D view, a Gantt panel and the timeline scrubber.
export function appWindow() {
  return `<div class="window" role="img" aria-label="The Insight Plan 4D view: a building rising pour by pour beside the programme">
  <div class="window__bar"><i></i><i></i><i></i><span>4D Sequencing</span></div>
  <div class="window__body">
    <div class="window__view">${building({ phase: 5, width: 520 })}<span class="chip">14 Oct 2029</span></div>
    <div class="window__panel"><div class="window__title">Programme</div>${gantt({})}</div>
  </div>
  <div class="window__time"><span class="play">&#9654;</span><div class="track"><div class="fill"></div><div class="knob"></div></div><span class="date">Pour 5 of 8</span></div>
</div>`;
}

// ---- Clash detection: two models overlapping at one joint, with the result list beside it.
export function clash() {
  const rows = [['Beam B-204', 'Duct D-17', 'Overlap'], ['Wall W-031', 'Pipe P-88', 'Overlap'], ['Slab S-012', 'Slab S-013', 'Touching 2 mm']];
  const list = rows.map(([a, b, k], i) => `<g transform="translate(0 ${i * 34})"><rect width="250" height="28" rx="6" fill="${i === 0 ? '#fff6e0' : '#f5f5f7'}" stroke="${i === 0 ? '#f59e0b' : '#e4e8f2'}"/><text x="10" y="18" font-size="12" fill="#0b1330">${a} / ${b}</text><text x="240" y="18" font-size="11" text-anchor="end" fill="${k === 'Overlap' ? '#d93025' : '#5b6580'}">${k}</text></g>`).join('');
  return `<svg viewBox="0 0 560 250" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Two models overlapping at a joint, listed as clashes">
<g transform="translate(20 20)">
<polygon points="20,90 110,45 200,90 110,135" fill="#4f7cff" fill-opacity=".55" stroke="#2f49d9"/>
<polygon points="20,90 110,135 110,165 20,120" fill="#2f49d9" fill-opacity=".6"/><polygon points="200,90 110,135 110,165 200,120" fill="#2f49d9" fill-opacity=".4"/>
<polygon points="70,120 160,75 210,100 120,145" fill="#14b8a6" fill-opacity=".6" stroke="#0d8f82"/>
<polygon points="70,120 120,145 120,175 70,150" fill="#0d8f82" fill-opacity=".6"/><polygon points="210,100 120,145 120,175 210,130" fill="#0d8f82" fill-opacity=".4"/>
<polygon points="90,112 150,82 175,95 115,125" fill="#f59e0b" fill-opacity=".85"/>
</g>
<g font-family="system-ui,sans-serif"><g transform="translate(290 30)">${list}</g>
<text x="290" y="20" font-size="12" fill="#5b6580">Architecture model against services model</text>
<text x="290" y="160" font-size="12" fill="#5b6580">Within a model, or across models</text></g></svg>`;
}
