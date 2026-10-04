import type { ElementSummary } from '../viewer/types';

/** Can the Scenarios generator make a programme from this model? The same
    rules as scenario-engine/main.py (reading the pours): only elements with
    the CWA Pour property set are pours, and everything is read from it;
    pours under 0.25 m³, or of an excluded type, are left out. Keep the lists
    below in step with main.py / config.py. */

/** main.py POUR_PSET */
const PSETS = ['CWA Pour'];
/** main.py CONTEMPLATED_POUR_TYPES */
const KNOWN_TYPES = new Set([
  'AIRDUCT', 'BEAM', 'BOSS', 'COLUMN', 'CORBEL', 'GROUT', 'GULLIES', 'HEAVY_PRECAST', 'LANDING', 'MAIN_SLAB', 'PARAPET',
  'PEDESTAL', 'PLINTH', 'RAFT', 'REMOVABLE_ELEMENT', 'SCREED', 'SLAB', 'STAIR', 'UPSTAND', 'WALL',
]);
/** config.py EXCLUDED_POUR_TYPES */
const EXCLUDED_TYPES = new Set(['BOSS', 'SCREED', 'GROUT', 'SPECIAL']);
const MIN_VOLUME = 0.25;

export type Severity = 'error' | 'warn' | 'info';

export interface CheckIssue {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Elements concerned (GlobalIds), to show in 3D. */
  guids: string[];
}

export interface ModelCheck {
  pours: number;
  /** Pours the generator will schedule (big enough, not an excluded type). */
  included: number;
  /** ready: nothing missing; gaps: it will run, but some IDs / names / pours will be off; blocked: nothing to schedule. */
  verdict: 'ready' | 'gaps' | 'blocked';
  issues: CheckIssue[];
}

export function checkModel(elements: ElementSummary[]): ModelCheck {
  const pours = elements
    .map((el) => {
      const p: Record<string, string> = {};
      let found = false;
      for (const set of PSETS) {
        for (const [key, value] of Object.entries(el.props)) {
          if (!key.startsWith(`${set}.`)) continue;
          found = true;
          p[key.slice(set.length + 1)] = String(value ?? '').trim();
        }
      }
      return found ? { el, p } : null;
    })
    .filter((x): x is { el: ElementSummary; p: Record<string, string> } => !!x);

  const issues: CheckIssue[] = [];
  const add = (id: string, severity: Severity, title: string, detail: string, list: typeof pours) => {
    if (list.length) issues.push({ id, severity, title: `${title} (${list.length.toLocaleString()})`, detail, guids: list.map((x) => x.el.guid) });
  };

  if (!pours.length) {
    return {
      pours: 0,
      included: 0,
      verdict: 'blocked',
      issues: [
        {
          id: 'no-pours',
          severity: 'error',
          title: 'No pours found',
          detail: `No element has the ${PSETS[0]} property set, so there is nothing to schedule. The generator needs models set up with the CWA pour properties.`,
          guids: [],
        },
      ],
    };
  }

  const typeOf = (p: Record<string, string>) => (p['Pour Type'] || p['General Pour Type'] || '').replace(/ /g, '_').toUpperCase();
  const volumeOf = (p: Record<string, string>) => Number(p['Pour Volume m3']);
  const noType = pours.filter((x) => !typeOf(x.p));
  const unknownType = pours.filter((x) => typeOf(x.p) && !KNOWN_TYPES.has(typeOf(x.p)) && !typeOf(x.p).includes('WALL'));
  const noVolume = pours.filter((x) => !x.p['Pour Volume m3'] || !Number.isFinite(volumeOf(x.p)));
  const excluded = pours.filter((x) => EXCLUDED_TYPES.has(typeOf(x.p)));
  const small = pours.filter((x) => Number.isFinite(volumeOf(x.p)) && x.p['Pour Volume m3'] && volumeOf(x.p) < MIN_VOLUME && !EXCLUDED_TYPES.has(typeOf(x.p)));
  const included = pours.filter((x) => Number.isFinite(volumeOf(x.p)) && volumeOf(x.p) >= MIN_VOLUME && !EXCLUDED_TYPES.has(typeOf(x.p)));
  const inc = (list: typeof pours) => list.filter((x) => included.includes(x));

  add('no-type', 'error', 'No pour type', 'Pour Type is empty: these pours become "OTHER", get a made-up type code in their activity IDs and the default durations.', noType);
  add('unknown-type', 'warn', 'Pour type the generator does not know', `Scheduled with the default durations and a made-up type code. Known types: ${[...KNOWN_TYPES].join(', ')}.`, unknownType);
  add('no-volume', 'error', 'No pour volume', 'Pour Volume m3 is empty: these pours count as 0 m³ and are left out of the programme.', noVolume);
  add('no-id', 'warn', 'No pour ID number', "Pour ID Number is empty: the generator numbers these pours itself, after the building's highest number. Add the numbers in the authoring model to keep them fixed.", inc(pours.filter((x) => !x.p['Pour ID Number'] && !x.p['PourID'])));
  add('no-level', 'warn', 'No level', 'Level is empty: these pours are put on L0.', inc(pours.filter((x) => !x.p['Level'])));
  add('no-building', 'warn', 'No building', 'Building is empty: activity IDs and the WBS use "UNKNOWN" (unless the generator maps this model\'s IfcBuilding names, as for the sample models).', inc(pours.filter((x) => !x.p['Building'])));

  // Activity IDs are building-level-zone-type-number: two pours giving the same one clash.
  // SLAB and MAIN_SLAB share the code S; only walls carry internal / external.
  const idType = (p: Record<string, string>) => {
    const t = typeOf(p) === 'MAIN_SLAB' ? 'SLAB' : typeOf(p);
    return t.includes('WALL') ? `${/YES|TRUE|EXT/i.test(p['Is External?'] || p['IsExternal'] || '') ? 'E' : 'I'}WALL` : t;
  };
  // Pour numbers as four digits, as main.py _pad_pour_id (21 and 0021 are the same pour number).
  const pourNo = (p: Record<string, string>) => { const v = p['Pour ID Number'] || p['PourID'] || ''; return /^\d+$/.test(v) ? v.padStart(4, '0') : v; };
  const idKey = (p: Record<string, string>) => [p['Unit'], p['Building'], p['Level'], /DISCONNECTED/i.test(p['Building Zone'] || p['Zone'] || '') ? 'D' : /CONNECTED/i.test(p['Building Zone'] || p['Zone'] || '') ? 'C' : '', idType(p), pourNo(p)].join('|');
  const seen = new Map<string, number>();
  for (const x of inc(pours)) if (x.p['Pour ID Number'] || x.p['PourID']) seen.set(idKey(x.p), (seen.get(idKey(x.p)) ?? 0) + 1);
  add('dup-id', 'error', 'Same pour ID twice', 'Pours with the same building, level, zone, type and pour number get the same activity ID.', inc(pours).filter((x) => (seen.get(idKey(x.p)) ?? 0) > 1));

  add('no-zone', 'info', 'No building zone', 'Building Zone is empty: no zone code (C / D) in their IDs.', inc(pours.filter((x) => !x.p['Building Zone'] && !x.p['Zone'])));
  add('wall-side', 'info', 'Walls without internal / external', 'Is External? is empty: these walls are taken as internal (IW).', inc(pours.filter((x) => typeOf(x.p).includes('WALL') && !x.p['Is External?'] && !x.p['IsExternal'])));
  add('small', 'info', `Pours under ${MIN_VOLUME} m³ left out`, 'Too small to schedule on their own.', small);
  add('excluded', 'info', 'Pour types left out', `${[...EXCLUDED_TYPES].join(', ')} are not scheduled (config.py EXCLUDED_POUR_TYPES).`, excluded);

  const order: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  const verdict = !included.length ? 'blocked' : issues.some((i) => i.severity !== 'info') ? 'gaps' : 'ready';
  if (!included.length) issues.unshift({ id: 'none-included', severity: 'error', title: 'No pour can be scheduled', detail: 'Every pour is left out (no volume, too small, or an excluded type).', guids: [] });
  return { pours: pours.length, included: included.length, verdict, issues };
}
