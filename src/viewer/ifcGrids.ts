import * as THREE from 'three';

/** Fragments drops IfcGrid when it converts an IFC (grid axes are curves, not
    solids), so the grids are read straight from the IFC text at import, like
    layers (see ifcLayers.ts): each grid's U / V / W axes as lines in project
    axes (X east, Y north, Z up) — the IFC's own coordinates, in the same
    units the loader keeps for the geometry (no unit conversion).
    Axes drawn as polylines or as trimmed lines are followed; arcs are not.
    Returns an empty list when the file has no grid (a single cheap pass). */

export interface GridAxisLine {
  tag: string;
  family: 'U' | 'V' | 'W';
  /** The axis' points (two for a straight axis). */
  points: [number, number, number][];
}

export interface IfcGridData {
  name: string;
  axes: GridAxisLine[];
}

/** Top-level comma split that respects nested parentheses and 'strings'. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (inString) {
      if (c === "'") {
        if (args[i + 1] === "'") i++;
        else inString = false;
      }
    } else if (c === "'") inString = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(args.slice(start).trim());
  return out;
}

const refs = (list: string): string[] => list.match(/#\d+/g) ?? [];
const ref = (s: string | undefined) => (s && /^#\d+$/.test(s.trim()) ? s.trim() : null);
const unquote = (s: string) => s.replace(/^'|'$/g, '').replace(/''/g, "'");
const nums = (list: string): number[] => (list.match(/-?\d+\.?\d*(?:[Ee][+-]?\d+)?/g) ?? []).map(Number);

const CHUNK_BYTES = 32 * 1024 * 1024;
const ENTITY = /^\s*(#\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*)\)\s*$/;

/** Reads the file in 32 MB slices (see extractLayers), calling `handle` for each entity of a wanted type. */
async function scan(bytes: Uint8Array, wanted: Set<string>, handle: (id: string, type: string, args: string[]) => void) {
  const decoder = new TextDecoder('latin1');
  const one = (entity: string) => {
    // Cheap pre-check on the type before the regex work.
    const eq = entity.indexOf('=');
    if (eq < 0) return;
    const par = entity.indexOf('(', eq);
    if (par < 0) return;
    const type = entity.slice(eq + 1, par).trim();
    if (!wanted.has(type)) return;
    const m = ENTITY.exec(entity);
    if (m) handle(m[1], m[2], splitArgs(m[3]));
  };
  let carry = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    const text = carry + decoder.decode(bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK_BYTES)));
    const parts = text.split(/;[ \t]*\r?\n/);
    carry = parts.pop() ?? '';
    for (const part of parts) one(part);
    await new Promise((resolve) => setTimeout(resolve));
  }
  one(carry);
}

export async function extractGrids(bytes: Uint8Array): Promise<IfcGridData[]> {
  // ---- pass 1: the grids, their axes, the length unit
  const grids: { name: string; placement: string | null; u: string[]; v: string[]; w: string[] }[] = [];
  const axes = new Map<string, { tag: string; curve: string | null }>();
  await scan(bytes, new Set(['IFCGRID', 'IFCGRIDAXIS']), (id, type, a) => {
    if (type === 'IFCGRID') grids.push({ name: unquote(a[2] ?? ''), placement: ref(a[5]), u: refs(a[7] ?? ''), v: refs(a[8] ?? ''), w: refs(a[9] ?? '') });
    else if (type === 'IFCGRIDAXIS') axes.set(id, { tag: unquote(a[0] ?? ''), curve: ref(a[1]) });
  });
  if (grids.length === 0) return [];

  // ---- pass 2: the curves and the placements (cartesian points come after, only the ones needed)
  const polylines = new Map<string, string[]>();
  const lines = new Map<string, { pnt: string | null; dir: string | null }>();
  const vectors = new Map<string, { orientation: string | null; magnitude: number }>();
  const trimmed = new Map<string, { basis: string | null; trim1: string; trim2: string }>();
  const places = new Map<string, { parent: string | null; rel: string | null }>();
  const axisPlaces = new Map<string, { location: string | null; axis: string | null; refDir: string | null }>();
  await scan(bytes, new Set(['IFCPOLYLINE', 'IFCLINE', 'IFCVECTOR', 'IFCTRIMMEDCURVE', 'IFCLOCALPLACEMENT', 'IFCAXIS2PLACEMENT3D', 'IFCAXIS2PLACEMENT2D']), (id, type, a) => {
    if (type === 'IFCPOLYLINE') polylines.set(id, refs(a[0] ?? ''));
    else if (type === 'IFCLINE') lines.set(id, { pnt: ref(a[0]), dir: ref(a[1]) });
    else if (type === 'IFCVECTOR') vectors.set(id, { orientation: ref(a[0]), magnitude: Number(a[1]) || 1 });
    else if (type === 'IFCTRIMMEDCURVE') trimmed.set(id, { basis: ref(a[0]), trim1: a[1] ?? '', trim2: a[2] ?? '' });
    else if (type === 'IFCLOCALPLACEMENT') places.set(id, { parent: ref(a[0]), rel: ref(a[1]) });
    else if (type === 'IFCAXIS2PLACEMENT3D') axisPlaces.set(id, { location: ref(a[0]), axis: ref(a[1]), refDir: ref(a[2]) });
    else axisPlaces.set(id, { location: ref(a[0]), axis: null, refDir: ref(a[1]) }); // 2D
  });

  const needed = new Set<string>();
  const need = (r: string | null | undefined) => r && needed.add(r);
  for (const g of grids) {
    for (const axisRef of [...g.u, ...g.v, ...g.w]) {
      const curve = axes.get(axisRef)?.curve;
      if (!curve) continue;
      polylines.get(curve)?.forEach(need);
      const t = trimmed.get(curve);
      if (t) {
        refs(t.trim1).forEach(need);
        refs(t.trim2).forEach(need);
        const l = t.basis ? lines.get(t.basis) : undefined;
        if (l) {
          need(l.pnt);
          const v = l.dir ? vectors.get(l.dir) : undefined;
          need(v?.orientation);
        }
      }
    }
    for (let p = g.placement, guard = 0; p && guard < 64; guard++) {
      const lp = places.get(p);
      if (!lp) break;
      const ap = lp.rel ? axisPlaces.get(lp.rel) : undefined;
      if (ap) {
        need(ap.location);
        need(ap.axis);
        need(ap.refDir);
      }
      p = lp.parent;
    }
  }

  // ---- pass 3: the cartesian points and directions that are needed
  const coords = new Map<string, number[]>();
  await scan(bytes, new Set(['IFCCARTESIANPOINT', 'IFCDIRECTION']), (id, _type, a) => {
    if (needed.has(id)) coords.set(id, nums(a[0] ?? ''));
  });
  const point = (r: string | null | undefined): THREE.Vector3 | null => {
    const c = r ? coords.get(r) : undefined;
    return c && c.length >= 2 ? new THREE.Vector3(c[0], c[1], c[2] ?? 0) : null;
  };

  // ---- placement chain -> matrix (file units)
  const matrixOf = (placement: string | null): THREE.Matrix4 => {
    const chain: THREE.Matrix4[] = [];
    for (let p = placement, guard = 0; p && guard < 64; guard++) {
      const lp = places.get(p);
      if (!lp) break;
      const ap = lp.rel ? axisPlaces.get(lp.rel) : undefined;
      const m = new THREE.Matrix4();
      if (ap) {
        const loc = point(ap.location) ?? new THREE.Vector3();
        const z = (point(ap.axis) ?? new THREE.Vector3(0, 0, 1)).normalize();
        let x = (point(ap.refDir) ?? new THREE.Vector3(1, 0, 0)).clone();
        x.sub(z.clone().multiplyScalar(x.dot(z)));
        x = x.lengthSq() < 1e-12 ? new THREE.Vector3(1, 0, 0) : x.normalize();
        const y = new THREE.Vector3().crossVectors(z, x);
        m.makeBasis(x, y, z).setPosition(loc);
      }
      chain.push(m);
      p = lp.parent;
    }
    // chain[0] is the grid's own placement, last is the outermost parent: world = outer * ... * own.
    return chain.reduceRight((acc, m) => acc.multiply(m), new THREE.Matrix4());
  };

  const curvePoints = (curve: string): THREE.Vector3[] | null => {
    const poly = polylines.get(curve);
    if (poly) {
      const pts = poly.map(point);
      return pts.every((p): p is THREE.Vector3 => !!p) && pts.length >= 2 ? pts : null;
    }
    const t = trimmed.get(curve);
    const l = t?.basis ? lines.get(t.basis) : undefined;
    if (!t || !l) return null;
    const pnt = point(l.pnt);
    const vec = l.dir ? vectors.get(l.dir) : undefined;
    const dir = point(vec?.orientation ?? null)?.normalize();
    const at = (trim: string): THREE.Vector3 | null => {
      const r = refs(trim)[0];
      if (r) return point(r);
      const param = /IFCPARAMETERVALUE\(\s*(-?[\d.eE+-]+)\s*\)/.exec(trim);
      if (param && pnt && dir) return pnt.clone().add(dir.clone().multiplyScalar(Number(param[1]) * (vec?.magnitude ?? 1)));
      return null;
    };
    const a = at(t.trim1);
    const b = at(t.trim2);
    return a && b ? [a, b] : null;
  };

  const out: IfcGridData[] = [];
  for (const g of grids) {
    const world = matrixOf(g.placement);
    const lines3: GridAxisLine[] = [];
    for (const [family, list] of [['U', g.u], ['V', g.v], ['W', g.w]] as const) {
      for (const axisRef of list) {
        const axis = axes.get(axisRef);
        const pts = axis?.curve ? curvePoints(axis.curve) : null;
        if (!axis || !pts) continue;
        lines3.push({
          tag: axis.tag,
          family,
          points: pts.map((p) => {
            const w = p.clone().applyMatrix4(world);
            return [w.x, w.y, w.z] as [number, number, number];
          }),
        });
      }
    }
    if (lines3.length) out.push({ name: g.name, axes: lines3 });
  }
  return out;
}

export interface IfcStoreyData {
  name: string;
  /** IfcBuildingStorey.Elevation, in the IFC's own length unit (like the grids' points); null when the file leaves it out. */
  elevation: number | null;
}

/** The building storeys with their elevations, read from the IFC text like the grids (Fragments keeps no elevation). */
export async function extractStoreys(bytes: Uint8Array): Promise<IfcStoreyData[]> {
  const out: IfcStoreyData[] = [];
  await scan(bytes, new Set(['IFCBUILDINGSTOREY']), (_id, _type, a) => {
    // GlobalId, OwnerHistory, Name, Description, ObjectType, ObjectPlacement, Representation, LongName, CompositionType, Elevation
    const elevation = Number(a[9]);
    out.push({ name: unquote(a[2] ?? '') || unquote(a[7] ?? ''), elevation: a[9] && a[9] !== '$' && Number.isFinite(elevation) ? elevation : null });
  });
  return out;
}
