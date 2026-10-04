import type { Activity, ScheduleModel } from './types';
import type { ElementSummary } from '../viewer/types';
import type { AppearanceProfile } from './appearance';
import { computeGroupLinks, objectFieldValue, type LinkGroup } from './linkGroups';

/** How the search-set conditions name the property, in Navisworks' own terms.
    The internal names depend on the Navisworks version and IFC reader, so they
    can be taken from a search set the user exported from their Navisworks
    (parseNavisworksTemplate); otherwise the legacy IFC reader's are used. */
export interface NwNaming {
  categoryInternal: string;
  categoryDisplay: string;
  propertyInternal: string;
  propertyDisplay: string;
  /** `flags` of a single / first condition. */
  flags: string;
  /** `flags` of a condition OR-ed with the one before; null = unknown. */
  orFlags: string | null;
  dataType: string;
  source: 'default' | 'template';
}

export interface NwKey {
  propertySet: string;
  attribute: string;
}

/** Default naming for a property: IFC property sets as the legacy (v1)
    Navisworks IFC reader shows them; the object Name as Navisworks' Item tab. */
export function defaultNaming(key: NwKey): NwNaming {
  if (key.propertySet === '_name') {
    return { categoryInternal: 'LcOaNode', categoryDisplay: 'Item', propertyInternal: 'LcOaSceneBaseUserName', propertyDisplay: 'Name', flags: '10', orFlags: null, dataType: 'wstring', source: 'default' };
  }
  return { categoryInternal: 'LcIFCProperty', categoryDisplay: key.propertySet, propertyInternal: 'IFCString', propertyDisplay: key.attribute, flags: '10', orFlags: null, dataType: 'wstring', source: 'default' };
}

/** Reads a search set exported from Navisworks (Sets > Export Search Sets):
    the first condition gives the category/property names and flags; a second
    condition, if the user OR-ed one on, gives the OR flags. */
export function parseNavisworksTemplate(xml: string): NwNaming {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Not a valid XML file.');
  const conditions = [...doc.getElementsByTagName('condition')];
  const first = conditions[0];
  if (!first) throw new Error('No search condition found — export a search set (not a selection set) from Navisworks.');
  const name = (parent: string) => first.getElementsByTagName(parent)[0]?.getElementsByTagName('name')[0];
  const cat = name('category');
  const prop = name('property');
  if (!cat || !prop) throw new Error('The first condition has no category/property.');
  const second = conditions[1];
  return {
    categoryInternal: cat.getAttribute('internal') ?? '',
    categoryDisplay: cat.textContent ?? '',
    propertyInternal: prop.getAttribute('internal') ?? '',
    propertyDisplay: prop.textContent ?? '',
    flags: first.getAttribute('flags') ?? '10',
    orFlags: second ? second.getAttribute('flags') : null,
    dataType: first.getElementsByTagName('data')[0]?.getAttribute('type') ?? 'wstring',
    source: 'template',
  };
}

export interface NwPackInput {
  schedule: ScheduleModel;
  models: { elements: ElementSummary[] }[];
  groups: LinkGroup[];
  profiles: AppearanceProfile[];
  key: NwKey;
  naming: NwNaming;
  basis: 'planned' | 'actual';
}

export interface NwPack {
  setsXml: string;
  csv: string;
  readme: string;
  stats: { tasks: number; linkedTasks: number; sets: number; multiValue: number; splitSets: number; noValue: number };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Task / set name — identical on both sides so Auto-Attach can pair them. */
export const nwTaskName = (a: Activity) => `${a.code} - ${a.name}`.replace(/[\r\n\t]+/g, ' ').trim();

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function isoDateTime(d: Date | null | undefined) {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** TimeLiner's built-in task types. "Maintain" (always visible) has no
    TimeLiner equivalent; Construct is the closest once the task starts. */
const TASK_TYPE: Record<AppearanceProfile['action'], string> = { install: 'Construct', remove: 'Demolish', maintain: 'Construct' };

/** Navisworks TimeLiner pack for the current 4D setup: one search set per
    linked task (finding its objects by `key`), a TimeLiner CSV with the same
    task names, and the steps to put them together. */
export function buildNavisworksPack(input: NwPackInput): NwPack {
  const { schedule, models, groups, profiles, key, naming, basis } = input;
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const valuesByTask = new Map<string, Set<string>>();
  const typeByTask = new Map<string, string>();
  let noValue = 0;

  for (const m of models) {
    const byId = new Map(m.elements.map((e) => [e.localId, e]));
    for (const g of groups) {
      const links = computeGroupLinks(schedule, m.elements, g);
      const profile = g.appearanceProfileId ? profileById.get(g.appearanceProfileId) : undefined;
      for (const [taskId, ids] of links.taskToElements) {
        const set = valuesByTask.get(taskId) ?? new Set<string>();
        valuesByTask.set(taskId, set);
        if (!typeByTask.has(taskId)) typeByTask.set(taskId, TASK_TYPE[profile?.action ?? 'install']);
        for (const id of ids) {
          const el = byId.get(id);
          const v = el ? objectFieldValue(el, key.propertySet, key.attribute).trim() : '';
          if (v) set.add(v);
          else noValue++;
        }
      }
    }
  }

  const condition = (value: string, flags: string) => `
          <condition test="equals" flags="${esc(flags)}">
            <category>
              <name internal="${esc(naming.categoryInternal)}">${esc(naming.categoryDisplay)}</name>
            </category>
            <property>
              <name internal="${esc(naming.propertyInternal)}">${esc(naming.propertyDisplay)}</name>
            </property>
            <value>
              <data type="${esc(naming.dataType)}">${esc(value)}</data>
            </value>
          </condition>`;
  const selectionSet = (name: string, values: string[]) => `
    <selectionset name="${esc(name)}" guid="${crypto.randomUUID()}">
      <findspec mode="all" disjoint="0">
        <conditions>${values.map((v, i) => condition(v, i === 0 ? naming.flags : naming.orFlags ?? naming.flags)).join('')}
        </conditions>
        <locator>/</locator>
      </findspec>
    </selectionset>`;

  const activities = schedule.activities.filter((a) => a.type !== 'wbs-summary');
  const sets: string[] = [];
  let multiValue = 0;
  let splitSets = 0;
  for (const a of activities) {
    const values = [...(valuesByTask.get(a.id) ?? [])].sort();
    if (values.length === 0) continue;
    const name = nwTaskName(a);
    if (values.length === 1 || naming.orFlags) {
      if (values.length > 1) multiValue++;
      sets.push(selectionSet(name, values));
    } else {
      // No known OR flag: one set per value; these need attaching by hand.
      multiValue++;
      values.forEach((v, i) => {
        splitSets++;
        sets.push(selectionSet(`${name} (${i + 1} of ${values.length})`, [v]));
      });
    }
  }

  const setsXml = `<?xml version="1.0" encoding="UTF-8" ?>
<exchange xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://download.autodesk.com/us/navisworks/schemas/nw-exchange-12.0.xsd" units="m">
  <selectionsets>${sets.join('')}
  </selectionsets>
</exchange>
`;

  const header = ['Sync ID', 'Task Name', 'Task Type', 'Planned Start', 'Planned End', 'Actual Start', 'Actual End', 'WBS', 'Match Values'];
  const rows = activities.map((a) => {
    const start = basis === 'actual' ? a.actualStart ?? a.earlyStart ?? a.targetStart : a.targetStart ?? a.earlyStart;
    const end = basis === 'actual' ? a.actualFinish ?? a.earlyFinish ?? a.targetFinish : a.targetFinish ?? a.earlyFinish;
    return [
      a.code,
      nwTaskName(a),
      typeByTask.get(a.id) ?? 'Construct',
      isoDateTime(start),
      isoDateTime(end),
      isoDateTime(a.actualStart),
      isoDateTime(a.actualFinish),
      a.wbsPath,
      [...(valuesByTask.get(a.id) ?? [])].sort().join('; '),
    ];
  });
  const csv = [header, ...rows].map((r) => r.map((c) => csvCell(String(c))).join(',')).join('\r\n');

  const linkedTasks = activities.filter((a) => (valuesByTask.get(a.id)?.size ?? 0) > 0).length;
  const stats = { tasks: activities.length, linkedTasks, sets: sets.length, multiValue, splitSets, noValue };
  const keyLabel = key.propertySet === '_name' ? 'Item > Name' : `${naming.categoryDisplay} > ${naming.propertyDisplay}`;

  const readme = `Insight Plan -> Navisworks TimeLiner
Schedule: ${schedule.sourceFileName}
Generated: ${new Date().toLocaleString()}

Contents
  *_SearchSets.xml   ${stats.sets} search sets, one per linked task, each finding its objects by ${keyLabel}
  *_TimeLiner.csv    ${stats.tasks} tasks (${stats.linkedTasks} linked to objects), same names as the sets

Steps (Navisworks Manage)
 1. Append the IFC model(s).${naming.source === 'default' ? `
    The sets use the legacy (v1) IFC reader's property names. If they find nothing,
    set Options > File Readers > IFC > IFC Conversion Method = Legacy and re-append,
    or export a sample search set from your Navisworks and load it in Insight Plan
    as the naming template, then download the sets again.` : `
    Property names come from your own Navisworks search set, so they match your reader.`}
 2. Sets window > Import/Export > Import Search Sets... > *_SearchSets.xml
 3. TimeLiner > Data Sources > Add > CSV Import > *_TimeLiner.csv
    - Tick "Row 1 contains headings" and "Automatically detect date/time format"
      (dates are written as yyyy-mm-dd hh:mm).
    - Map: Synchronization ID = Sync ID, Task Name = Task Name,
      Task Type = Task Type, Planned Start / End, Actual Start / End.
 4. Right-click the data source > Rebuild Task Hierarchy.
 5. Tasks tab > Auto-Attach Using Rules > "Map TimeLiner Tasks from column Name to
    Selection Sets with the same name, matching case" > Apply Rules.
 6. Simulate. Save as .nwd / .nwf.
${stats.splitSets ? `
Note: ${stats.multiValue} task(s) link objects with different ${keyLabel} values. Without a
naming template that includes an OR condition, each value got its own set
("<task> (1 of n)", ...) - attach those to their task by hand, or export a sample
search set with two conditions joined by OR and load it as the template.
` : ''}${stats.noValue ? `
Note: ${stats.noValue} linked object(s) have no ${keyLabel} value and cannot be found by these sets.
` : ''}`;

  return { setsXml, csv, readme, stats };
}
