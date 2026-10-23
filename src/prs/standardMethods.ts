/** Generate 3's standard methods: how a kind of work is built when the project has no recipe of its own for it. A method is a short chain of
    activities, each with a rough rate (how much one crew does in a day) and the crew that does it. Generate 3 picks one for each work package from what
    its objects are (their IFC class and material), and a planner can pick another from a short list. At Generate a method becomes a recipe for the
    package with its days worked out here, so the generator needs nothing new.

    This file is the one place in the app that holds construction words and numbers on purpose (the owner asked for standard methods): the rates
    are starting points, shown as such, and every package's days can be changed. Edit the list here to change what the app offers. */

export type MethodUnit = 'm3' | 'm2' | 'object';

export interface MethodTask {
  phase: string;
  name: string;
  /** What the rate is per, and how much one crew does in a day. */
  per: MethodUnit;
  rate: number;
  /** When the objects carry no quantity of that unit: objects a day. */
  perObject: number;
  /** The fewest days. */
  min: number;
}

export interface StandardMethod {
  id: string;
  name: string;
  crew: { id: string; name: string; people: number };
  tasks: MethodTask[];
}

export const STANDARD_METHODS: StandardMethod[] = [
  {
    id: 'insitu', name: 'In-situ concrete', crew: { id: 'STD-CONCRETE', name: 'Concrete gang', people: 6 },
    tasks: [
      { phase: 'Rebar', name: 'Rebar', per: 'm3', rate: 15, perObject: 6, min: 1 },
      { phase: 'Formwork', name: 'Formwork', per: 'm3', rate: 12, perObject: 5, min: 1 },
      { phase: 'Concrete', name: 'Concrete', per: 'm3', rate: 40, perObject: 20, min: 1 },
    ],
  },
  {
    id: 'precast', name: 'Precast install', crew: { id: 'STD-PRECAST', name: 'Precast erection crew', people: 5 },
    tasks: [
      { phase: 'Installation', name: 'Install', per: 'object', rate: 8, perObject: 8, min: 1 },
      { phase: 'Stitching', name: 'Joints and grout', per: 'object', rate: 12, perObject: 12, min: 1 },
    ],
  },
  {
    id: 'steel', name: 'Steel erection', crew: { id: 'STD-STEEL', name: 'Steel erection crew', people: 4 },
    tasks: [
      { phase: 'Erect', name: 'Erect', per: 'object', rate: 20, perObject: 20, min: 1 },
      { phase: 'Bolt up', name: 'Bolt up and align', per: 'object', rate: 30, perObject: 30, min: 1 },
    ],
  },
  {
    id: 'masonry', name: 'Masonry', crew: { id: 'STD-MASONRY', name: 'Bricklaying gang', people: 4 },
    tasks: [{ phase: 'Masonry', name: 'Lay blocks', per: 'm2', rate: 25, perObject: 4, min: 1 }],
  },
  {
    id: 'install', name: 'Install', crew: { id: 'STD-INSTALL', name: 'Installation crew', people: 3 },
    tasks: [{ phase: 'Install', name: 'Install', per: 'object', rate: 15, perObject: 15, min: 1 }],
  },
];

export const GENERAL_METHOD: StandardMethod = STANDARD_METHODS[STANDARD_METHODS.length - 1];

/** What an object is, for choosing a method: its IFC class (upper case, as the model has it) and its material text. */
export interface MethodClue { cls: string; material: string; name: string }

const has = (text: string, re: RegExp) => re.test(text);
const CONCRETE_CLASSES = /^IFC(WALL|WALLSTANDARDCASE|SLAB|COLUMN|BEAM|FOOTING|STAIR|STAIRFLIGHT|PILE|ROOF|RAMP|RAMPFLIGHT)$/;
const STEEL_CLASSES = /^IFC(MEMBER|PLATE|BEAM|COLUMN|FASTENER|MECHANICALFASTENER|DISCRETEACCESSORY)$/;

/** The method one object suggests, or null. */
function methodOfObject(o: MethodClue): string | null {
  const m = `${o.material} ${o.name}`.toLowerCase();
  if (has(m, /precast|pre-cast|prefab/)) return 'precast';
  if (has(m, /steel|s275|s355|metal/) && STEEL_CLASSES.test(o.cls)) return 'steel';
  if (has(m, /brick|block|masonry/)) return 'masonry';
  if (has(m, /concrete|c\d\d\/\d\d|rc\b|reinforced/)) return 'insitu';
  if (STEEL_CLASSES.test(o.cls) && /^IFC(MEMBER|PLATE)$/.test(o.cls)) return 'steel';
  if (CONCRETE_CLASSES.test(o.cls)) return 'insitu';
  return null;
}

/** The standard method for a package's objects: the one most of them suggest (none: Install), and why. */
export function chooseMethod(objects: readonly MethodClue[]): { method: StandardMethod; why: string } {
  const votes = new Map<string, number>();
  for (const o of objects) { const id = methodOfObject(o); if (id) votes.set(id, (votes.get(id) ?? 0) + 1); }
  const [best] = [...votes].sort((a, b) => b[1] - a[1]);
  if (!best) return { method: GENERAL_METHOD, why: 'nothing in the objects says what they are made of' };
  const method = STANDARD_METHODS.find((m) => m.id === best[0])!;
  return { method, why: `${best[1].toLocaleString()} of ${objects.length.toLocaleString()} objects look like ${method.name.toLowerCase()}` };
}

/** Days for one task of a method, for a package's quantities: its quantity over the rate (objects a day when the objects carry none), never under its
    minimum, in whole days. */
export function taskDays(t: MethodTask, q: { volume: number; area: number; count: number }): { days: number; how: string } {
  const amount = t.per === 'm3' ? q.volume : t.per === 'm2' ? q.area : q.count;
  const unit = t.per === 'm3' ? 'm³' : t.per === 'm2' ? 'm²' : 'objects';
  if (t.per !== 'object' && amount <= 0) {
    const days = Math.max(t.min, Math.ceil(q.count / t.perObject));
    return { days, how: `${q.count.toLocaleString()} objects at ${t.perObject} a day (the objects carry no ${unit})` };
  }
  const days = Math.max(t.min, Math.ceil(amount / t.rate - 1e-9));
  return { days, how: `${Math.round(amount).toLocaleString()} ${unit} at ${t.rate} ${unit === 'objects' ? 'objects' : unit} a day` };
}

/** Upper-case IFC classes the work is not made of (spaces, openings, annotations and the spatial structure). */
export const NOT_WORK = /^IFC(SPACE|OPENINGELEMENT|OPENINGSTANDARDCASE|ANNOTATION|GRID|VIRTUALELEMENT|BUILDINGSTOREY|BUILDING|SITE|PROJECT|ZONE|SPATIALZONE|DISTRIBUTIONPORT|GRIDAXIS)$/;

/** The order kinds of work are usually built in on a storey, by IFC class (others after, in the order they come). Used by "Order bottom up". */
export const CLASS_ORDER = ['IFCPILE', 'IFCFOOTING', 'IFCCOLUMN', 'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCBEAM', 'IFCMEMBER', 'IFCSLAB', 'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAMP', 'IFCROOF', 'IFCPLATE', 'IFCCURTAINWALL', 'IFCWINDOW', 'IFCDOOR', 'IFCRAILING', 'IFCCOVERING'];
