import { expectedBuilding, propertyValues, type UnitBuildingSource } from './rules';
import { elevationOf, levelCodeOf, type AvevaLevelSource } from './avevaLevels';
import { closingBracket, ifcSchema, newGuid, orderedGuids, readEntities, ref, refList, refsIn, splitArgs, stepReal, stepString, writeEntities, type StepEntity } from './step';

/** Patches: fixes for IDS failures, kept as JSON files in docs/ids/patches
    (one per patch) and linked to the IDS specifications they fix. A patch
    is planned from the loaded model (what would change, what can't) and
    then applied to the IFC text, which is edited in place so everything
    else in the file stays byte for byte as it was. */

/** Which IDS specification(s) a patch fixes: the .ids file (name in
    docs/ids) and the specification's identifier, or its name. */
export interface PatchLink {
  ids: string;
  specification: string;
}

/** Changes the failing elements' IFC class from a property value, e.g. a
    proxy with CWA Pour.Pour Type = WALL becomes an IfcWall. Values are
    matched ignoring case, spaces and punctuation ("Pits & Raft" =
    "PITS_AND_RAFT"). */
export interface ReclassifyOperation {
  type: 'reclassify';
  /** Classes the patch may change (e.g. IFCBUILDINGELEMENTPROXY). */
  from: string[];
  property: { pset: string; name: string };
  /** Property value → target class (e.g. "WALL": "IfcWall"). */
  map: Record<string, string>;
}

/** Rebuilds the whole model's spatial structure from element properties:
    one IfcSite, an IfcBuilding per building code (Unit + Building), an
    IfcBuildingStorey per level at level number × storeyHeight metres, and
    each element contained in its storey. Ported from ifc_spatial_structure.py. */
export interface SpatialStructureOperation {
  type: 'spatial-structure';
  /** The elements it places: those with any of these property sets. Their
      properties are merged in this order, a later set winning. */
  psets: string[];
  /** Property names giving the level, first found wins (e.g. "Level"). */
  level: string[];
  building: string;
  /** Prefixed to the building code when present (Unit 1 + HDAB → 1HDAB). */
  unit?: string;
  /** Building code → the name to give it. */
  buildingNames?: Record<string, string>;
  siteName: string;
  /** Metres per level number (Level 2 → 6 m at 3). */
  storeyHeight: number;
  /** Level values that mean "no level": those elements go in the site. */
  unknownLevels?: string[];
}

/** IFC value types a property can be written as. */
export type PropertyValueType = 'IfcLabel' | 'IfcText' | 'IfcIdentifier' | 'IfcReal' | 'IfcInteger' | 'IfcBoolean';

/** Sets a property on the failing elements (creating the property set
    when an element has none by that name). With overwrite off, an element
    that already has the property keeps its value. */
export interface SetPropertyOperation {
  type: 'set-property';
  pset: string;
  name: string;
  value: string;
  valueType: PropertyValueType;
  overwrite?: boolean;
}

/** One IfcBuilding: the first stays, renamed to the elements' Unit +
    Building (the first element's), and takes the others' storeys and
    contents; storeys with the same name are merged, the rest go. */
export interface MergeBuildingsOperation extends UnitBuildingSource {
  type: 'merge-buildings';
}

/** Sets the failing elements' Name to the first of these properties they
    have (by name, in any property set). */
export interface NameFromPropertyOperation {
  type: 'name-from-property';
  properties: string[];
}

/** Pads the failing elements' numeric properties (by name, in any property
    set) with leading zeros to this many digits (389 → 0389). Written as text,
    as a number can't hold the zeros. Values that aren't whole numbers, or
    have more digits, are left alone. */
export interface PadPropertyOperation {
  type: 'pad-property';
  properties: string[];
  digits: number;
}

/** For AVEVA models: rebuilds the spatial structure from the objects' names:
    one IfcSite, one IfcBuilding and an IfcBuildingStorey per level (named by
    the level code, at its elevation), each object in its level's storey.
    Ported from group_ifc_objects_by_level.py; add_location_property.py is
    the `writeLocation` step. */
export interface AvevaStoreysOperation extends AvevaLevelSource {
  type: 'aveva-storeys';
  /** Also writes the level as this property ("Pset.Property") on the objects moved, where they have none. */
  writeLocation?: string;
}

export type PatchOperation = ReclassifyOperation | SpatialStructureOperation | SetPropertyOperation | MergeBuildingsOperation | NameFromPropertyOperation | PadPropertyOperation | AvevaStoreysOperation;

export interface Patch {
  id: string;
  name: string;
  description?: string;
  fixes: PatchLink[];
  operation: PatchOperation;
}

/** One element the patch would change. */
export interface PlannedChange {
  modelId: string;
  localId: number;
  guid: string;
  /** Reclassify: old and new class. Spatial: '' and "building › level". */
  from: string;
  to: string;
  /** The property value that decided it. */
  value: string;
  building?: string;
  level?: string;
  levelNumber?: number;
  /** Pad-property: the property set and name to write. */
  pset?: string;
  property?: string;
}

export interface SkippedElement {
  modelId: string;
  localId: number;
  guid: string;
  why: string;
}

export interface PatchPlan {
  changes: PlannedChange[];
  skipped: SkippedElement[];
  /** Model-wide patches plan over every element of the models involved. */
  modelWide: boolean;
}

/** What the viewer indexes per element (ViewerEngine's ElementSummary). */
export interface IndexedElement {
  guid: string;
  category: string;
  name?: string;
  props: Record<string, unknown>;
}

export function canonicalValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** What the patch would do, for these failing elements of the loaded models. */
/** A model's spatial nodes (site, buildings, storeys) with their names. */
export type SpatialNode = { localId: number; category: string; name: string };

export function planPatch(
  patch: Patch,
  failures: { modelId: string; localId: number }[],
  elementsOf: (modelId: string) => ReadonlyMap<number, IndexedElement> | undefined,
  spatialOf: (modelId: string) => SpatialNode[] = () => [],
): PatchPlan {
  const op = patch.operation;
  if (op.type === 'reclassify') return planReclassify(op, failures, elementsOf);
  if (op.type === 'spatial-structure') return planSpatial(op, [...new Set(failures.map((f) => f.modelId))], elementsOf);
  if (op.type === 'set-property') return planSetProperty(op, failures, elementsOf);
  if (op.type === 'name-from-property') return planNameFromProperty(op, failures, elementsOf);
  if (op.type === 'pad-property') return planPad(op, failures, elementsOf);
  if (op.type === 'merge-buildings') return planMergeBuildings(op, [...new Set(failures.map((f) => f.modelId))], elementsOf, spatialOf);
  if (op.type === 'aveva-storeys') return planAvevaStoreys(op, [...new Set(failures.map((f) => f.modelId))], elementsOf, spatialOf);
  return { changes: [], skipped: [], modelWide: false };
}

/** Every object with a level goes in that level's storey; the model's own
    sites, buildings and storeys are replaced by one site, one building and a
    storey per level. */
function planAvevaStoreys(op: AvevaStoreysOperation, modelIds: string[], elementsOf: (modelId: string) => ReadonlyMap<number, IndexedElement> | undefined, spatialOf: (modelId: string) => SpatialNode[]): PatchPlan {
  const plan: PatchPlan = { changes: [], skipped: [], modelWide: true };
  for (const modelId of modelIds) {
    for (const [localId, e] of elementsOf(modelId) ?? []) {
      const code = levelCodeOf({ category: e.category, guid: e.guid, name: e.name ?? '', props: e.props }, op);
      if (!code) continue;
      plan.changes.push({ modelId, localId, guid: e.guid, from: '', to: `Level ${code}`, value: code, level: code, levelNumber: elevationOf(code) });
    }
    const nodes = spatialOf(modelId);
    const note = (category: string, skip: number, from: string, to: string) => {
      for (const n of nodes.filter((x) => x.category.toUpperCase() === category).slice(skip)) plan.changes.push({ modelId, localId: n.localId, guid: '', from, to, value: '' });
    };
    note('IFCSITE', 1, 'IfcSite', 'merged into the first');
    note('IFCBUILDING', 1, 'IfcBuilding', 'merged into the first');
    note('IFCBUILDINGSTOREY', 0, 'IfcBuildingStorey', 'replaced by one per level');
  }
  return plan;
}

function planSetProperty(op: SetPropertyOperation, failures: { modelId: string; localId: number }[], elementsOf: (modelId: string) => ReadonlyMap<number, IndexedElement> | undefined): PatchPlan {
  const plan: PatchPlan = { changes: [], skipped: [], modelWide: false };
  const key = `${op.pset}.${op.name}`;
  for (const { modelId, localId } of failures) {
    const element = elementsOf(modelId)?.get(localId);
    const guid = element?.guid ?? '';
    if (!element || !guid) {
      plan.skipped.push({ modelId, localId, guid, why: element ? 'Has no GlobalId to find it in the file by.' : 'Not in the loaded model.' });
      continue;
    }
    const current = element.props[key];
    if (current !== undefined && String(current).trim() !== '' && !op.overwrite) {
      plan.skipped.push({ modelId, localId, guid, why: `Already has ${key} = ${String(current)}.` });
      continue;
    }
    plan.changes.push({ modelId, localId, guid, from: '', to: `${key} = ${op.value}`, value: op.value });
  }
  return plan;
}

function planReclassify(op: ReclassifyOperation, failures: { modelId: string; localId: number }[], elementsOf: (modelId: string) => ReadonlyMap<number, IndexedElement> | undefined): PatchPlan {
  const plan: PatchPlan = { changes: [], skipped: [], modelWide: false };
  const map = new Map(Object.entries(op.map).map(([k, v]) => [canonicalValue(k), v.toUpperCase()]));
  const from = new Set(op.from.map((c) => c.toUpperCase()));
  const key = `${op.property.pset}.${op.property.name}`;
  for (const { modelId, localId } of failures) {
    const element = elementsOf(modelId)?.get(localId);
    const guid = element?.guid ?? '';
    const skip = (why: string) => plan.skipped.push({ modelId, localId, guid, why });
    if (!element) {
      skip('Not in the loaded model.');
      continue;
    }
    const cls = element.category.toUpperCase();
    if (!from.has(cls)) {
      skip(`Is ${element.category}; the patch only changes ${op.from.join(', ')}.`);
      continue;
    }
    const value = element.props[key];
    if (value === undefined || String(value).trim() === '') {
      skip(`No ${key}.`);
      continue;
    }
    const to = map.get(canonicalValue(value));
    if (!to) {
      skip(`${key} "${String(value)}" is not in the patch's mapping.`);
      continue;
    }
    if (to === cls) {
      skip(`${key} "${String(value)}" maps to its own class.`);
      continue;
    }
    if (!guid) {
      skip('Has no GlobalId to find it in the file by.');
      continue;
    }
    plan.changes.push({ modelId, localId, guid, from: cls, to, value: String(value) });
  }
  return plan;
}

/** First whole number in a level name: "L03" → 3, "Level -1" → -1, none → 0. */
export function levelNumber(level: string): number {
  const m = /[-+]?\d+/.exec(level);
  return m ? Number(m[0]) : 0;
}

function planSpatial(op: SpatialStructureOperation, modelIds: string[], elementsOf: (modelId: string) => ReadonlyMap<number, IndexedElement> | undefined): PatchPlan {
  const plan: PatchPlan = { changes: [], skipped: [], modelWide: true };
  const unknown = new Set((op.unknownLevels ?? []).map((v) => v.trim().toUpperCase()));
  for (const modelId of modelIds) {
    for (const [localId, element] of elementsOf(modelId) ?? []) {
      // The element's properties from the patch's sets, later sets winning.
      const p: Record<string, unknown> = {};
      let found = false;
      for (const pset of op.psets) {
        for (const [k, v] of Object.entries(element.props)) {
          if (!k.startsWith(`${pset}.`)) continue;
          p[k.slice(pset.length + 1)] = v;
          found = true;
        }
      }
      if (!found) continue;
      const skip = (why: string) => plan.skipped.push({ modelId, localId, guid: element.guid, why });
      if (!element.guid) {
        skip('Has no GlobalId to find it in the file by.');
        continue;
      }
      const level = String(op.level.map((k) => p[k]).find((v) => v !== undefined && String(v).trim() !== '') ?? '').trim();
      if (!level || unknown.has(level.toUpperCase())) {
        skip(`No level (${op.level.join(' / ')}${level ? ` is "${level}"` : ' empty'}): goes in the site.`);
        continue;
      }
      const base = String(p[op.building] ?? '').trim().toUpperCase() || 'BLD';
      let unit = op.unit ? String(p[op.unit] ?? '').trim().toUpperCase() : '';
      if (['UNKNOWN', 'NONE', 'N/A'].includes(unit)) unit = '';
      const code = `${unit}${base}`;
      const building = op.buildingNames?.[code] ?? code;
      plan.changes.push({ modelId, localId, guid: element.guid, from: '', to: `${building} › ${level}`, value: level, building, level, levelNumber: levelNumber(level) });
    }
  }
  return plan;
}

/** Attribute counts of the IfcElement subtypes a reclassify can produce
    (IFC4 and IFC4X3 give them all nine: …, Tag, PredefinedType). IFC2X3
    has no PredefinedType on beams, columns, members, walls and plates. */
const IFC2X3_ATTRIBUTES: Record<string, number> = {
  IFCBUILDINGELEMENTPROXY: 9,
  IFCSLAB: 9,
  IFCFOOTING: 9,
  IFCCOVERING: 9,
  IFCSTAIR: 9,
  IFCRAMP: 9,
  IFCROOF: 9,
  IFCRAILING: 9,
  IFCBEAM: 8,
  IFCCOLUMN: 8,
  IFCMEMBER: 8,
  IFCWALL: 8,
  IFCWALLSTANDARDCASE: 8,
  IFCPLATE: 8,
  IFCCURTAINWALL: 8,
};
const IFC4_CLASSES = new Set([
  'IFCBUILDINGELEMENTPROXY', 'IFCSLAB', 'IFCFOOTING', 'IFCCOVERING', 'IFCSTAIR', 'IFCRAMP', 'IFCROOF', 'IFCRAILING',
  'IFCBEAM', 'IFCCOLUMN', 'IFCMEMBER', 'IFCWALL', 'IFCPLATE', 'IFCCURTAINWALL',
]);

/** How many attributes `cls` has in `schema`, or null when the patch
    doesn't know the class there (it then leaves the element alone). */
function attributeCount(cls: string, schema: string): number | null {
  if (schema === 'IFC2X3') return IFC2X3_ATTRIBUTES[cls] ?? null;
  if (schema.startsWith('IFC4')) return IFC4_CLASSES.has(cls) ? 9 : null;
  return null;
}

export interface ApplyResult {
  text: string;
  applied: PlannedChange[];
  failed: { change: PlannedChange; why: string }[];
  schema: string;
  /** What else the patch did to the file, for the log. */
  notes: string[];
}

/** Rewrites the planned elements' entities in the IFC text: the class name,
    and the trailing type attribute to fit the new class (IFC2X3 beams,
    walls… have none; otherwise it becomes .NOTDEFINED., or stays
    .USERDEFINED.). Found by GlobalId, in one pass over the file. */
export function applyReclassify(text: string, changes: PlannedChange[]): ApplyResult {
  const schema = ifcSchema(text);
  const byGuid = new Map(changes.map((c) => [c.guid, c]));
  const done = new Set<string>();
  const failed: ApplyResult['failed'] = [];
  const pieces: string[] = [];
  let last = 0;
  const froms = [...new Set(changes.map((c) => c.from))].map((c) => c.replace(/[^A-Z0-9]/g, ''));
  if (froms.length === 0) return { text, applied: [], failed, schema, notes: [] };
  const entity = new RegExp(`(#\\d+\\s*=\\s*)(${froms.join('|')})(\\s*)\\(`, 'gi');
  for (let m = entity.exec(text); m; m = entity.exec(text)) {
    const open = m.index + m[0].length - 1;
    const guid = /^\s*'([^']*)'/.exec(text.slice(open + 1, open + 60))?.[1];
    const change = guid ? byGuid.get(guid) : undefined;
    if (!change || done.has(change.guid)) continue;
    const close = closingBracket(text, open);
    if (close < 0) {
      failed.push({ change, why: 'The entity in the file has no closing bracket.' });
      continue;
    }
    const args = splitArgs(text.slice(open + 1, close));
    const wanted = attributeCount(change.to, schema);
    if (wanted === null) {
      failed.push({ change, why: `The patch doesn't know ${change.to} in ${schema || 'this schema'}.` });
      continue;
    }
    if (args.length < 8) {
      failed.push({ change, why: `The entity has ${args.length} attributes, expected at least 8.` });
      continue;
    }
    const kept = args.slice(0, 8);
    const tail = args[8]?.trim().toUpperCase();
    for (let i = 8; i < wanted; i++) kept.push(i === 8 && tail === '.USERDEFINED.' ? '.USERDEFINED.' : '.NOTDEFINED.');
    pieces.push(text.slice(last, m.index), m[1], change.to, m[3], '(', kept.join(','), ')');
    last = close + 1;
    done.add(change.guid);
    entity.lastIndex = close + 1;
  }
  pieces.push(text.slice(last));
  for (const c of changes) if (!done.has(c.guid) && !failed.some((f) => f.change === c)) failed.push({ change: c, why: `No ${c.from} with this GlobalId in the file.` });
  return { text: pieces.join(''), applied: changes.filter((c) => done.has(c.guid)), failed, schema, notes: [] };
}

/** Metres per model length unit (a millimetre file: 1000). */
function unitsPerMetre(entities: StepEntity[]): number {
  for (const e of entities) {
    if (e.type !== 'IFCSIUNIT') continue;
    const a = splitArgs(e.args).map((s) => s.trim().toUpperCase());
    if (a[1] !== '.LENGTHUNIT.') continue;
    return { '.MILLI.': 1000, '.CENTI.': 100, '.DECI.': 10, '.KILO.': 0.001 }[a[2]] ?? 1;
  }
  return 1;
}

/** Rebuilds the spatial structure (see SpatialStructureOperation). Old
    buildings and storeys go, with their aggregation and containment and any
    relationship left pointing at them; the first site stays (renamed),
    extra sites go. Elements the plan places go in their new storey; any
    other element that was contained somewhere goes in the site, so nothing
    drops out of the tree. Element placements are left as they are. */
export function applySpatial(text: string, op: SpatialStructureOperation, changes: PlannedChange[]): ApplyResult {
  const schema = ifcSchema(text);
  const entities = readEntities(text);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const ofType = (t: string) => entities.filter((e) => e.type === t);
  const replace = new Map<number, string | null>();
  const added: string[] = [];
  const notes: string[] = [];
  let nextId = entities.reduce((n, e) => Math.max(n, e.id), 0) + 1;
  const add = (type: string, args: string[]) => {
    const id = nextId++;
    added.push(`#${id}=${type}(${args.join(',')});`);
    return id;
  };

  const project = ofType('IFCPROJECT')[0];
  if (!project) throw new Error('The file has no IfcProject.');
  const owner = splitArgs(project.args)[1]?.trim() || '$';

  // The site: the first one stays, renamed; others go.
  const sites = ofType('IFCSITE');
  const deleted = new Set<number>();
  let siteId: number;
  if (sites.length) {
    siteId = sites[0].id;
    const a = splitArgs(sites[0].args);
    a[2] = stepString(op.siteName);
    replace.set(siteId, a.join(','));
    for (const s of sites.slice(1)) deleted.add(s.id);
    if (sites.length > 1) notes.push(`Removed ${sites.length - 1} extra site(s).`);
  } else {
    siteId = add('IFCSITE', [stepString(newGuid()), owner, stepString(op.siteName), '$', "'Site'", '$', '$', '$', '.ELEMENT.', '$', '$', '$', '$', '$']);
    add('IFCRELAGGREGATES', [stepString(newGuid()), owner, '$', '$', ref(project.id), refList([siteId])]);
    notes.push('Added a site.');
  }
  const oldBuildings = ofType('IFCBUILDING');
  const oldStoreys = ofType('IFCBUILDINGSTOREY');
  for (const e of [...oldBuildings, ...oldStoreys]) deleted.add(e.id);
  notes.push(`Replaced ${oldBuildings.length} building(s) and ${oldStoreys.length} storey(s).`);

  // Containment is rebuilt from scratch; remember who was contained.
  const wasContained = new Set<number>();
  for (const rel of ofType('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    for (const id of refsIn(splitArgs(rel.args)[4] ?? '')) wasContained.add(id);
    replace.set(rel.id, null);
  }

  // Relationships pointing at what goes: dropped from their lists, or
  // removed when that empties a list or it was the one related thing.
  for (const e of entities) {
    if (!e.type.startsWith('IFCREL') || replace.get(e.id) === null) continue;
    if (!refsIn(e.args).some((id) => deleted.has(id))) continue;
    const a = splitArgs(e.args);
    let drop = false;
    const next = a.map((arg) => {
      const t = arg.trim();
      if (t.startsWith('(')) {
        const ids = refsIn(t);
        if (!ids.some((id) => deleted.has(id))) return arg;
        const kept = ids.filter((id) => !deleted.has(id));
        if (kept.length === 0) drop = true;
        return refList(kept);
      }
      if (/^#\d+$/.test(t) && deleted.has(Number(t.slice(1)))) drop = true;
      return arg;
    });
    replace.set(e.id, drop ? null : next.join(','));
  }
  for (const id of deleted) replace.set(id, null);

  // Elements by GlobalId.
  const idByGuid = new Map<string, number>();
  const wanted = new Set(changes.map((c) => c.guid));
  for (const e of entities) {
    const g = /^\s*'([^']{22})'/.exec(e.args)?.[1];
    if (g && wanted.has(g)) idByGuid.set(g, e.id);
  }

  // New buildings and storeys, storeys in level order.
  const scale = unitsPerMetre(entities);
  const failed: ApplyResult['failed'] = [];
  const applied: PlannedChange[] = [];
  const levels = new Map<string, Map<string, { number: number; elements: number[] }>>();
  for (const c of changes) {
    const id = idByGuid.get(c.guid);
    if (id === undefined) {
      failed.push({ change: c, why: 'No element with this GlobalId in the file.' });
      continue;
    }
    const b = levels.get(c.building!) ?? levels.set(c.building!, new Map()).get(c.building!)!;
    const l = b.get(c.level!) ?? b.set(c.level!, { number: c.levelNumber ?? 0, elements: [] }).get(c.level!)!;
    l.elements.push(id);
    applied.push(c);
  }
  // Buildings by name, storeys by level: in the file, in each building's
  // list, and in GlobalId order (see orderedGuids), so viewers that sort by
  // any of these show them bottom to top.
  const buildings = [...levels].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  const buildingGuids = orderedGuids(buildings.length);
  const storeyGuids = orderedGuids(buildings.reduce((n, [, byLevel]) => n + byLevel.size, 0));
  const buildingIds: number[] = [];
  let storeyCount = 0;
  for (const [b, [building, byLevel]] of buildings.entries()) {
    const bId = add('IFCBUILDING', [stepString(buildingGuids[b]), owner, stepString(building), '$', "'Building'", '$', '$', '$', '.ELEMENT.', '$', '$', '$']);
    buildingIds.push(bId);
    const storeyIds: number[] = [];
    for (const [level, { number, elements }] of [...byLevel].sort((a, b) => a[1].number - b[1].number || a[0].localeCompare(b[0], undefined, { numeric: true }))) {
      const sId = add('IFCBUILDINGSTOREY', [stepString(storeyGuids[storeyCount + storeyIds.length]), owner, stepString(level), '$', "'Storey'", '$', '$', stepString(`Level ${number}`), '.ELEMENT.', stepReal(number * op.storeyHeight * scale)]);
      storeyIds.push(sId);
      add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [stepString(newGuid()), owner, '$', '$', refList(elements), ref(sId)]);
      for (const id of elements) wasContained.delete(id);
    }
    storeyCount += storeyIds.length;
    add('IFCRELAGGREGATES', [stepString(newGuid()), owner, '$', '$', ref(bId), refList(storeyIds)]);
  }
  if (buildingIds.length) add('IFCRELAGGREGATES', [stepString(newGuid()), owner, '$', '$', ref(siteId), refList(buildingIds)]);
  notes.push(`Added ${buildingIds.length} building(s) and ${storeyCount} storey(s) at ${op.storeyHeight} m a level${scale !== 1 ? ` (${stepReal(op.storeyHeight * scale)} in the file's units)` : ''}.`);

  // Anything else that was contained stays in the tree, in the site.
  const leftovers = [...wasContained].filter((id) => byId.has(id) && !deleted.has(id));
  if (leftovers.length) {
    add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [stepString(newGuid()), owner, '$', '$', refList(leftovers), ref(siteId)]);
    notes.push(`${leftovers.length} element(s) without a level are contained in the site.`);
  }
  return { text: writeEntities(text, entities, replace, added), applied, failed, schema, notes };
}

/** Merges every IfcSite into the first: what the extra sites held (buildings,
    contained elements) goes to it, they leave the project's list, and are
    deleted; anything else pointing at one is dropped from its list. */
function mergeSites(text: string): { text: string; count: number } {
  const entities = readEntities(text);
  const sites = entities.filter((e) => e.type === 'IFCSITE');
  if (sites.length < 2) return { text, count: 0 };
  const target = sites[0].id;
  const extra = new Set(sites.slice(1).map((s) => s.id));
  const replace = new Map<number, string | null>();
  for (const id of extra) replace.set(id, null);
  const relating: Record<string, number> = { IFCRELAGGREGATES: 4, IFCRELCONTAINEDINSPATIALSTRUCTURE: 5 };
  for (const e of entities) {
    if (!e.type.startsWith('IFCREL') || !refsIn(e.args).some((id) => extra.has(id))) continue;
    const a = splitArgs(e.args);
    let drop = false;
    a.forEach((arg, i) => {
      const t = arg.trim();
      if (t.startsWith('(')) {
        const ids = refsIn(t);
        if (!ids.some((id) => extra.has(id))) return;
        const kept = ids.filter((id) => !extra.has(id));
        if (!kept.length) drop = true;
        a[i] = refList(kept);
      } else if (/^#\d+$/.test(t) && extra.has(Number(t.slice(1)))) {
        if (relating[e.type] === i) a[i] = ref(target);
        else drop = true;
      }
    });
    replace.set(e.id, drop ? null : a.join(','));
  }
  return { text: writeEntities(text, entities, replace, []), count: extra.size };
}

/** Rebuilds an AVEVA model's spatial structure (see AvevaStoreysOperation):
    one site, one building (the first outermost one, kept with its name), the
    others and every storey removed, and a storey per level the objects'
    names give, named by the level code at its elevation, in elevation order.
    The objects go in their level's storey; other elements that were in a
    removed storey or building are contained in the building. */
export function applyAvevaStoreys(source: string, op: AvevaStoreysOperation, allChanges: PlannedChange[]): ApplyResult {
  const schema = ifcSchema(source);
  const structural = allChanges.filter((c) => !c.level);
  const changes = allChanges.filter((c) => c.level);
  if (changes.length === 0) return { text: source, applied: [], failed: allChanges.map((change) => ({ change, why: 'No object has a level.' })), schema, notes: [] };
  const merged = mergeSites(source);
  const text = merged.text;
  const entities = readEntities(text);
  const replace = new Map<number, string | null>();
  const added: string[] = [];
  const notes: string[] = [];
  let nextId = entities.reduce((n, e) => Math.max(n, e.id), 0) + 1;
  const add = (type: string, args: string[]) => {
    const id = nextId++;
    added.push(`#${id}=${type}(${args.join(',')});`);
    return id;
  };
  if (merged.count) notes.push(`Merged ${merged.count} extra IfcSite(s) into the first.`);
  const project = entities.find((e) => e.type === 'IFCPROJECT');
  if (!project) throw new Error('The file has no IfcProject.');
  const owner = splitArgs(project.args)[1]?.trim() || '$';

  // The building to keep: the first that is not inside another building.
  const buildings = entities.filter((e) => e.type === 'IFCBUILDING');
  const buildingIds = new Set(buildings.map((b) => b.id));
  const nested = new Set<number>();
  for (const e of entities) {
    if (e.type !== 'IFCRELAGGREGATES') continue;
    const a = splitArgs(e.args);
    if (buildingIds.has(refsIn(a[4] ?? '')[0])) for (const id of refsIn(a[5] ?? '')) if (buildingIds.has(id)) nested.add(id);
  }
  let buildingId = (buildings.find((b) => !nested.has(b.id)) ?? buildings[0])?.id;
  const deleted = new Set<number>(buildings.filter((b) => b.id !== buildingId).map((b) => b.id));
  const oldStoreys = entities.filter((e) => e.type === 'IFCBUILDINGSTOREY');
  for (const s of oldStoreys) deleted.add(s.id);
  if (buildingId === undefined) {
    let siteId = entities.find((e) => e.type === 'IFCSITE')?.id;
    if (siteId === undefined) {
      siteId = add('IFCSITE', [stepString(newGuid()), owner, stepString('Site'), '$', "'Site'", '$', '$', '$', '.ELEMENT.', '$', '$', '$', '$', '$']);
      add('IFCRELAGGREGATES', [stepString(newGuid()), owner, '$', '$', ref(project.id), refList([siteId])]);
    }
    buildingId = add('IFCBUILDING', [stepString(newGuid()), owner, stepString('Building'), '$', "'Building'", '$', '$', '$', '.ELEMENT.', '$', '$', '$']);
    add('IFCRELAGGREGATES', [stepString(newGuid()), owner, '$', '$', ref(siteId), refList([buildingId])]);
    notes.push('Added a building to hold the storeys.');
  }
  const keep = buildingId;

  // The objects by GlobalId, grouped by level.
  const wanted = new Set(changes.map((c) => c.guid));
  const idByGuid = new Map<string, number>();
  for (const e of entities) {
    if (e.type.startsWith('IFCREL') || e.type.startsWith('IFCPROPERTY')) continue;
    const g = /^\s*'([^']{22})'/.exec(e.args)?.[1];
    if (g && wanted.has(g)) idByGuid.set(g, e.id);
  }
  const failed: ApplyResult['failed'] = [];
  const applied: PlannedChange[] = [];
  const byLevel = new Map<string, { elevation: number; elements: number[] }>();
  for (const c of changes) {
    const id = idByGuid.get(c.guid);
    if (id === undefined) {
      failed.push({ change: c, why: 'No element with this GlobalId in the file.' });
      continue;
    }
    const l = byLevel.get(c.level!) ?? byLevel.set(c.level!, { elevation: c.levelNumber ?? 0, elements: [] }).get(c.level!)!;
    l.elements.push(id);
    applied.push(c);
  }
  const moved = new Set([...byLevel.values()].flatMap((l) => l.elements));

  // Relationships: moved objects leave their containment; what pointed at a
  // removed building or storey is dropped from its lists, and a container
  // that went is replaced by the kept building (or the relationship goes,
  // when nothing is left in it).
  for (const e of entities) {
    if (!e.type.startsWith('IFCREL')) continue;
    const contained = e.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE';
    if (!refsIn(e.args).some((id) => deleted.has(id) || (contained && moved.has(id)))) continue;
    const a = splitArgs(e.args);
    const relatingAt = contained ? 5 : e.type === 'IFCRELAGGREGATES' ? 4 : -1;
    let drop = false;
    a.forEach((arg, i) => {
      const t = arg.trim();
      if (t.startsWith('(')) {
        const ids = refsIn(t);
        const kept = ids.filter((id) => !deleted.has(id) && !(contained && moved.has(id)));
        if (kept.length === ids.length) return;
        if (kept.length === 0) drop = true;
        a[i] = refList(kept);
      } else if (/^#\d+$/.test(t) && deleted.has(Number(t.slice(1)))) {
        if (i === relatingAt) a[i] = ref(keep);
        else drop = true;
      }
    });
    replace.set(e.id, drop ? null : a.join(','));
  }
  for (const id of deleted) replace.set(id, null);

  // The storeys, in elevation order (and GlobalId order, see orderedGuids).
  const scale = unitsPerMetre(entities);
  const levels = [...byLevel].sort((a, b) => a[1].elevation - b[1].elevation || a[0].localeCompare(b[0], undefined, { numeric: true }));
  const guids = orderedGuids(levels.length);
  const storeyIds: number[] = [];
  levels.forEach(([code, { elevation, elements }], i) => {
    const sId = add('IFCBUILDINGSTOREY', [stepString(guids[i]), owner, stepString(code), '$', "'Storey'", '$', '$', stepString(`Level ${code}`), '.ELEMENT.', stepReal(elevation * scale)]);
    storeyIds.push(sId);
    add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [stepString(newGuid()), owner, '$', '$', refList(elements), ref(sId)]);
  });
  add('IFCRELAGGREGATES', [stepString(newGuid()), owner, '$', '$', ref(keep), refList(storeyIds)]);
  notes.push(`Replaced ${oldStoreys.length} storey(s) and ${Math.max(buildings.length - 1, 0)} extra building(s) with ${storeyIds.length} storey(s), one per level: ${levels.map(([c]) => c).join(', ')}.`);

  let out = writeEntities(text, entities, replace, added);
  if (op.writeLocation && applied.length) {
    const dot = op.writeLocation.indexOf('.');
    const r = applySetProperties(out, applied.map((c) => ({ guid: c.guid, pset: op.writeLocation!.slice(0, dot), name: op.writeLocation!.slice(dot + 1), value: c.value, valueType: 'IfcLabel' as const })), false);
    out = r.text;
    notes.push(...r.notes, `Wrote ${op.writeLocation} on ${r.applied.length} object(s).`);
  }
  return { text: out, applied: [...applied, ...structural], failed, schema, notes };
}

/** One property to write on one element (found by GlobalId). */
export interface PropertyEdit {
  guid: string;
  pset: string;
  name: string;
  value: string;
  valueType: PropertyValueType;
}

/** A STEP value of the given IFC type, e.g. IFCLABEL('NO'), IFCREAL(2.5). */
export function stepValue(value: string, type: PropertyValueType): string {
  switch (type) {
    case 'IfcReal': {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n)) throw new Error(`"${value}" is not a number.`);
      return `IFCREAL(${stepReal(n)})`;
    }
    case 'IfcInteger': {
      const n = Number(value);
      if (value.trim() === '' || !Number.isInteger(n)) throw new Error(`"${value}" is not a whole number.`);
      return `IFCINTEGER(${n})`;
    }
    case 'IfcBoolean':
      return `IFCBOOLEAN(${/^(true|yes|y|1|t)$/i.test(value.trim()) ? '.T.' : '.F.'})`;
    default:
      return `${type.toUpperCase()}(${stepString(value)})`;
  }
}

const unquote = (arg: string | undefined) => {
  const t = (arg ?? '').trim();
  return t.startsWith("'") ? t.slice(1, -1).replace(/''/g, "'") : t;
};

/** Writes properties onto elements. Property values in IFC are often shared
    (one IFCPROPERTYSINGLEVALUE('Is External?','NO') used by many sets), so
    a value is never edited in place: a new one is made (identical ones
    shared) and the element's set points at it. A set shared with other
    elements is first copied for this element, so they keep theirs. An
    element without a set of that name gets a new one. With overwrite off,
    a property the element already has is left alone. */
export function applySetProperties(text: string, edits: PropertyEdit[], overwrite = true): ApplyResult & { skippedExisting: PropertyEdit[] } {
  const schema = ifcSchema(text);
  const entities = readEntities(text);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const args = new Map<number, string[]>();
  const argsOf = (id: number) => args.get(id) ?? args.set(id, splitArgs(byId.get(id)!.args)).get(id)!;
  const touched = new Set<number>();
  const set = (id: number, i: number, v: string) => {
    argsOf(id)[i] = v;
    touched.add(id);
  };
  const added: string[] = [];
  let nextId = entities.reduce((n, e) => Math.max(n, e.id), 0) + 1;
  const add = (type: string, a: string[]) => {
    const id = nextId++;
    added.push(`#${id}=${type}(${a.join(',')});`);
    return id;
  };
  const project = entities.find((e) => e.type === 'IFCPROJECT');
  const owner = project ? splitArgs(project.args)[1]?.trim() || '$' : '$';

  // The elements, their property-set relationships, and how many objects use each set.
  const wanted = new Set(edits.map((e) => e.guid));
  const idByGuid = new Map<string, number>();
  for (const e of entities) {
    if (e.type.startsWith('IFCREL') || e.type.startsWith('IFCPROPERTY')) continue;
    const g = /^\s*'([^']{22})'/.exec(e.args)?.[1];
    if (g && wanted.has(g)) idByGuid.set(g, e.id);
  }
  const targets = new Set(idByGuid.values());
  const relsOf = new Map<number, number[]>();
  const users = new Map<number, number>();
  for (const e of entities) {
    if (e.type !== 'IFCRELDEFINESBYPROPERTIES') continue;
    const a = splitArgs(e.args);
    const objects = refsIn(a[4] ?? '');
    const pset = refsIn(a[5] ?? '')[0];
    if (pset !== undefined) users.set(pset, (users.get(pset) ?? 0) + objects.length);
    for (const o of objects) if (targets.has(o)) (relsOf.get(o) ?? relsOf.set(o, []).get(o)!).push(e.id);
  }

  const values = new Map<string, number>();
  const valueRef = (e: PropertyEdit) => {
    const key = JSON.stringify([e.name, e.valueType, e.value]);
    let id = values.get(key);
    if (id === undefined) values.set(key, (id = add('IFCPROPERTYSINGLEVALUE', [stepString(e.name), '$', stepValue(e.value, e.valueType), '$'])));
    return id;
  };
  const nameOf = (id: number) => (byId.get(id)?.type === 'IFCPROPERTYSINGLEVALUE' ? unquote(argsOf(id)[0]) : '');
  /** The set's property list with these edits made. */
  const edited = (props: number[], todo: PropertyEdit[]) => {
    const out = [...props];
    for (const e of todo) {
      const i = out.findIndex((id) => nameOf(id) === e.name);
      const v = valueRef(e);
      if (i >= 0) out[i] = v;
      else out.push(v);
    }
    return out;
  };

  const applied: PlannedChange[] = [];
  const failed: ApplyResult['failed'] = [];
  const skippedExisting: PropertyEdit[] = [];
  const asChange = (e: PropertyEdit, localId = 0): PlannedChange => ({ modelId: '', localId, guid: e.guid, from: '', to: `${e.pset}.${e.name} = ${e.value}`, value: e.value });
  let copied = 0;
  let created = 0;

  const groups = new Map<string, PropertyEdit[]>();
  for (const e of edits) {
    const key = JSON.stringify([e.guid, e.pset]);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  for (const list of groups.values()) {
    const { guid, pset } = list[0];
    const element = idByGuid.get(guid);
    if (element === undefined) {
      for (const e of list) failed.push({ change: asChange(e), why: 'No element with this GlobalId in the file.' });
      continue;
    }
    try {
      let relId: number | undefined;
      let psetId: number | undefined;
      for (const r of relsOf.get(element) ?? []) {
        const p = refsIn(argsOf(r)[5] ?? '')[0];
        if (p !== undefined && byId.get(p)?.type === 'IFCPROPERTYSET' && unquote(argsOf(p)[2]) === pset) {
          relId = r;
          psetId = p;
          break;
        }
      }
      if (psetId === undefined || relId === undefined) {
        const p = add('IFCPROPERTYSET', [stepString(newGuid()), owner, stepString(pset), '$', refList(edited([], list))]);
        add('IFCRELDEFINESBYPROPERTIES', [stepString(newGuid()), owner, '$', '$', refList([element]), ref(p)]);
        created++;
        applied.push(...list.map((e) => asChange(e, element)));
        continue;
      }
      const current = refsIn(argsOf(psetId)[4] ?? '');
      const todo = list.filter((e) => {
        const exists = current.some((id) => nameOf(id) === e.name);
        if (exists && !overwrite) skippedExisting.push(e);
        return !exists || overwrite;
      });
      if (!todo.length) continue;
      if ((users.get(psetId) ?? 0) > 1) {
        // Shared with other elements: this one gets its own copy.
        const a = argsOf(psetId);
        const copy = add('IFCPROPERTYSET', [stepString(newGuid()), a[1], a[2], a[3], refList(edited(current, todo))]);
        const relObjects = refsIn(argsOf(relId)[4] ?? '');
        if (relObjects.length === 1) set(relId, 5, ref(copy));
        else {
          set(relId, 4, refList(relObjects.filter((o) => o !== element)));
          add('IFCRELDEFINESBYPROPERTIES', [stepString(newGuid()), owner, '$', '$', refList([element]), ref(copy)]);
        }
        users.set(psetId, (users.get(psetId) ?? 1) - 1);
        copied++;
      } else {
        set(psetId, 4, refList(edited(current, todo)));
      }
      applied.push(...todo.map((e) => asChange(e, element)));
    } catch (err) {
      for (const e of list) failed.push({ change: asChange(e, element), why: err instanceof Error ? err.message : String(err) });
    }
  }
  const replace = new Map<number, string | null>([...touched].map((id) => [id, argsOf(id).join(',')]));
  const notes = [copied ? `Copied ${copied} shared property set(s) so other elements keep theirs.` : '', created ? `Added ${created} property set(s).` : ''].filter(Boolean);
  return { text: writeEntities(text, entities, replace, added), applied, failed, schema, notes, skippedExisting };
}

function planNameFromProperty(op: NameFromPropertyOperation, failures: { modelId: string; localId: number }[], elementsOf: (modelId: string) => ReadonlyMap<number, IndexedElement> | undefined): PatchPlan {
  const plan: PatchPlan = { changes: [], skipped: [], modelWide: false };
  for (const { modelId, localId } of failures) {
    const element = elementsOf(modelId)?.get(localId);
    const guid = element?.guid ?? '';
    const skip = (why: string) => plan.skipped.push({ modelId, localId, guid, why });
    if (!element || !guid) {
      skip(element ? 'Has no GlobalId to find it in the file by.' : 'Not in the loaded model.');
      continue;
    }
    const first = propertyValues(element.props, op.properties)[0];
    if (!first) {
      skip(`Has none of ${op.properties.join(', ')}.`);
      continue;
    }
    plan.changes.push({ modelId, localId, guid, from: '', to: `Name = ${first.name}`, value: first.value });
  }
  return plan;
}

function planPad(op: PadPropertyOperation, failures: { modelId: string; localId: number }[], elementsOf: (modelId: string) => ReadonlyMap<number, IndexedElement> | undefined): PatchPlan {
  const plan: PatchPlan = { changes: [], skipped: [], modelWide: false };
  const names = new Set(op.properties);
  for (const { modelId, localId } of failures) {
    const element = elementsOf(modelId)?.get(localId);
    const guid = element?.guid ?? '';
    const skip = (why: string) => plan.skipped.push({ modelId, localId, guid, why });
    if (!element || !guid) {
      skip(element ? 'Has no GlobalId to find it in the file by.' : 'Not in the loaded model.');
      continue;
    }
    let found = false;
    for (const [key, v] of Object.entries(element.props)) {
      const dot = key.indexOf('.');
      const name = key.slice(dot + 1);
      if (!names.has(name)) continue;
      const value = String(v ?? '').trim();
      if (!value || new RegExp(`^\\d{${op.digits}}$`).test(value)) continue;
      found = true;
      if (!/^\d+$/.test(value)) skip(`${name} = ${value} is not a whole number.`);
      else if (value.length > op.digits) skip(`${name} = ${value} has more than ${op.digits} digits.`);
      else plan.changes.push({ modelId, localId, guid, from: value, to: `${key} = ${value.padStart(op.digits, '0')}`, value: value.padStart(op.digits, '0'), pset: key.slice(0, dot), property: name });
    }
    if (!found) skip(`Has none of ${op.properties.join(', ')} to pad.`);
  }
  return plan;
}

/** Sets each planned element's Name (IfcRoot's third attribute) to its value. */
export function applyNames(text: string, changes: PlannedChange[]): ApplyResult {
  const schema = ifcSchema(text);
  const entities = readEntities(text);
  const byGuid = new Map(changes.map((c) => [c.guid, c]));
  const replace = new Map<number, string | null>();
  const applied: PlannedChange[] = [];
  for (const e of entities) {
    const guid = /^\s*'([^']{22})'/.exec(e.args)?.[1];
    const change = guid ? byGuid.get(guid) : undefined;
    if (!change || e.type.startsWith('IFCREL') || e.type.startsWith('IFCPROPERTY')) continue;
    const a = splitArgs(e.args);
    if (a.length < 3) continue;
    a[2] = stepString(change.value);
    replace.set(e.id, a.join(','));
    applied.push(change);
    byGuid.delete(change.guid);
  }
  const failed = [...byGuid.values()].map((change) => ({ change, why: 'No element with this GlobalId in the file.' }));
  return { text: writeEntities(text, entities, replace, []), applied, failed, schema, notes: [] };
}

function planMergeBuildings(op: MergeBuildingsOperation, modelIds: string[], elementsOf: (modelId: string) => ReadonlyMap<number, IndexedElement> | undefined, spatialOf: (modelId: string) => SpatialNode[]): PatchPlan {
  const plan: PatchPlan = { changes: [], skipped: [], modelWide: true };
  for (const modelId of modelIds) {
    const candidates = [...(elementsOf(modelId)?.entries() ?? [])].map(([localId, e]) => ({ localId, category: e.category, guid: e.guid, name: '', description: '', props: e.props }));
    const { name } = expectedBuilding({ candidates }, op);
    const buildings = spatialOf(modelId).filter((n) => n.category.toUpperCase() === 'IFCBUILDING');
    if (!name) {
      for (const b of buildings) plan.skipped.push({ modelId, localId: b.localId, guid: '', why: `No element has ${op.building} to name the building by.` });
      continue;
    }
    if (buildings.length === 1 && buildings[0].name.trim().toUpperCase() === name) continue;
    for (const b of buildings) plan.changes.push({ modelId, localId: b.localId, guid: '', from: b.name || '(unnamed)', to: name, value: name });
  }
  return plan;
}

const quoted = (arg: string | undefined) => {
  const t = (arg ?? '').trim();
  return t.startsWith("'") ? t.slice(1, -1).replace(/''/g, "'") : t;
};

/** Merges the model's buildings into its first one (see MergeBuildingsOperation). */
export function applyMergeBuildings(text: string, name: string, changes: PlannedChange[]): ApplyResult {
  const schema = ifcSchema(text);
  const entities = readEntities(text);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const args = new Map<number, string[]>();
  const argsOf = (id: number) => args.get(id) ?? args.set(id, splitArgs(byId.get(id)!.args)).get(id)!;
  const replace = new Map<number, string | null>();
  const touched = new Set<number>();
  const set = (id: number, i: number, v: string) => {
    argsOf(id)[i] = v;
    touched.add(id);
  };
  const remove = (id: number) => replace.set(id, null);

  const buildings = entities.filter((e) => e.type === 'IFCBUILDING');
  if (!buildings.length || !name) return { text, applied: [], failed: changes.map((change) => ({ change, why: buildings.length ? 'No name to give the building.' : 'The file has no IfcBuilding.' })), schema, notes: [] };
  const target = buildings[0].id;
  set(target, 2, stepString(name));

  // What merges into what: the other buildings into the first, and storeys
  // of the same name into the first of them.
  const into = new Map<number, number>();
  for (const b of buildings.slice(1)) into.set(b.id, target);
  const buildingIds = new Set(buildings.map((b) => b.id));
  const underBuildings = entities.filter((e) => e.type === 'IFCRELAGGREGATES' && buildingIds.has(refsIn(argsOf(e.id)[4] ?? '')[0]));
  const parts: number[] = [];
  for (const r of underBuildings) for (const id of refsIn(argsOf(r.id)[5] ?? '')) if (!parts.includes(id)) parts.push(id);
  const storeyByName = new Map<string, number>();
  for (const id of parts) {
    if (byId.get(id)?.type !== 'IFCBUILDINGSTOREY') continue;
    const key = quoted(argsOf(id)[2]).trim().toUpperCase();
    const keep = storeyByName.get(key);
    if (keep === undefined) storeyByName.set(key, id);
    else into.set(id, keep);
  }
  for (const id of into.keys()) remove(id);

  // The first building's parts: kept storeys by elevation, then anything else.
  const elevation = (id: number) => Number(argsOf(id)[9]) || 0;
  const kept = parts.filter((id) => !into.has(id));
  const storeys = kept
    .filter((id) => byId.get(id)?.type === 'IFCBUILDINGSTOREY')
    .sort((a, b) => elevation(a) - elevation(b) || quoted(argsOf(a)[2]).localeCompare(quoted(argsOf(b)[2]), undefined, { numeric: true }));
  const others = kept.filter((id) => byId.get(id)?.type !== 'IFCBUILDINGSTOREY');
  // New GlobalIds in that order too, for viewers that list storeys by GlobalId.
  const guids = orderedGuids(storeys.length);
  storeys.forEach((id, i) => set(id, 0, stepString(guids[i])));
  if (underBuildings.length) {
    const main = underBuildings.find((r) => refsIn(argsOf(r.id)[4] ?? '')[0] === target) ?? underBuildings[0];
    set(main.id, 4, ref(target));
    set(main.id, 5, refList([...storeys, ...others]));
    for (const r of underBuildings) if (r.id !== main.id) remove(r.id);
  }

  // Containment and aggregation pointing at a merged-away building or
  // storey as the container are pointed at what it merged into; those with
  // the same container are then combined.
  const relating: Record<string, [number, number]> = { IFCRELAGGREGATES: [4, 5], IFCRELCONTAINEDINSPATIALSTRUCTURE: [5, 4] };
  const byContainer = new Map<string, number>();
  for (const e of entities) {
    const pos = relating[e.type];
    if (!pos || replace.get(e.id) === null) continue;
    const [whole, list] = pos;
    const current = refsIn(argsOf(e.id)[whole] ?? '')[0];
    const to = current !== undefined ? into.get(current) : undefined;
    if (to !== undefined) set(e.id, whole, ref(to));
    const key = `${e.type}:${refsIn(argsOf(e.id)[whole] ?? '')[0]}`;
    const first = byContainer.get(key);
    if (first === undefined) byContainer.set(key, e.id);
    else {
      set(first, list, refList([...new Set([...refsIn(argsOf(first)[list] ?? ''), ...refsIn(argsOf(e.id)[list] ?? '')])]));
      remove(e.id);
    }
  }

  // Anything else still pointing at what went: dropped from its lists, or
  // removed when that empties a list or it was the one related thing.
  const gone = new Set(into.keys());
  for (const e of entities) {
    if (!e.type.startsWith('IFCREL') || replace.get(e.id) === null) continue;
    const a = argsOf(e.id);
    if (!refsIn(a.join(',')).some((id) => gone.has(id))) continue;
    let drop = false;
    for (let i = 0; i < a.length; i++) {
      const t = a[i].trim();
      if (t.startsWith('(')) {
        const ids = refsIn(t);
        if (!ids.some((id) => gone.has(id))) continue;
        const keep = ids.filter((id) => !gone.has(id));
        if (!keep.length) drop = true;
        set(e.id, i, refList(keep));
      } else if (/^#\d+$/.test(t) && gone.has(Number(t.slice(1)))) drop = true;
    }
    if (drop) remove(e.id);
  }

  for (const id of touched) if (replace.get(id) !== null) replace.set(id, argsOf(id).join(','));
  const mergedStoreys = [...into.keys()].filter((id) => byId.get(id)?.type === 'IFCBUILDINGSTOREY').length;
  const notes = [`Merged ${buildings.length} building(s) into one named ${name}${mergedStoreys ? `, and ${mergedStoreys} storey(s) into same-named ones` : ''}.`];
  return { text: writeEntities(text, entities, replace, []), applied: changes, failed: [], schema, notes };
}

/** The patch applied to one model's IFC text. */
export function applyPatch(patch: Patch, text: string, changes: PlannedChange[]): ApplyResult {
  const op = patch.operation;
  if (op.type === 'reclassify') return applyReclassify(text, changes);
  if (op.type === 'spatial-structure') return applySpatial(text, op, changes);
  if (op.type === 'name-from-property') return applyNames(text, changes);
  if (op.type === 'aveva-storeys') return applyAvevaStoreys(text, op, changes);
  if (op.type === 'pad-property') {
    const r = applySetProperties(text, changes.map((c) => ({ guid: c.guid, pset: c.pset ?? '', name: c.property ?? '', value: c.value, valueType: 'IfcLabel' as const })), true);
    const done = new Set(r.applied.map((a) => a.guid));
    return { ...r, applied: changes.filter((c) => done.has(c.guid)) };
  }
  if (op.type === 'merge-buildings') return applyMergeBuildings(text, changes[0]?.value ?? '', changes);
  if (op.type === 'set-property') {
    const r = applySetProperties(text, changes.map((c) => ({ guid: c.guid, pset: op.pset, name: op.name, value: op.value, valueType: op.valueType })), !!op.overwrite);
    const done = new Set(r.applied.map((a) => a.guid));
    return { ...r, applied: changes.filter((c) => done.has(c.guid)) };
  }
  return { text, applied: [], failed: changes.map((change) => ({ change, why: 'Unknown patch type.' })), schema: ifcSchema(text), notes: [] };
}
