/** An IDS file (buildingSMART Information Delivery Specification 1.0) as something to edit: parsed from its XML and
    written back. What the editor does not model (a value with bounds, say) is kept as the original XML and written
    back untouched, so editing never loses it. */

export type FacetType = 'entity' | 'attribute' | 'property' | 'classification' | 'material' | 'partOf';
export type Cardinality = 'required' | 'optional' | 'prohibited';

/** A facet's value: anything, one text, one of several, a pattern, or XML the editor leaves alone. */
export type IdsValue =
  | { kind: 'any' }
  | { kind: 'simple'; text: string }
  | { kind: 'enum'; values: string[] }
  | { kind: 'pattern'; pattern: string }
  | { kind: 'raw'; xml: string };

export interface Facet {
  id: string;
  type: FacetType;
  /** Requirements only. */
  cardinality: Cardinality;
  instructions: string;
  /** property: the IFC data type (IFCLABEL, ...). */
  dataType: string;
  /** partOf: the relation (IFCRELAGGREGATES, ...). */
  relation: string;
  /** By the facet's parts: entity name / predefinedType, attribute name / value, ... */
  values: Record<string, IdsValue>;
}

export interface Spec {
  id: string;
  name: string;
  identifier: string;
  ifcVersion: string;
  description: string;
  instructions: string;
  minOccurs: string;
  maxOccurs: string;
  applicability: Facet[];
  requirements: Facet[];
}

export interface IdsDoc {
  title: string;
  description: string;
  author: string;
  version: string;
  date: string;
  purpose: string;
  specs: Spec[];
}

/** The parts of each facet type, in the order they are written, and their labels. */
export const FACET_FIELDS: Record<FacetType, { key: string; label: string }[]> = {
  entity: [{ key: 'name', label: 'IFC class' }, { key: 'predefinedType', label: 'Predefined type' }],
  attribute: [{ key: 'name', label: 'Attribute' }, { key: 'value', label: 'Value' }],
  property: [{ key: 'propertySet', label: 'Property set' }, { key: 'baseName', label: 'Property' }, { key: 'value', label: 'Value' }],
  classification: [{ key: 'system', label: 'System' }, { key: 'value', label: 'Value' }],
  material: [{ key: 'value', label: 'Value' }],
  partOf: [{ key: 'name', label: 'Parent IFC class' }, { key: 'predefinedType', label: 'Parent type' }],
};
export const FACET_LABEL: Record<FacetType, string> = { entity: 'Entity', attribute: 'Attribute', property: 'Property', classification: 'Classification', material: 'Material', partOf: 'Part of' };
export const FACET_TYPES = Object.keys(FACET_LABEL) as FacetType[];
export const IFC_VERSIONS = ['IFC2X3', 'IFC4', 'IFC4X3_ADD2'];

const newId = () => crypto.randomUUID();

export const newFacet = (type: FacetType, requirement: boolean): Facet => ({
  id: newId(),
  type,
  cardinality: requirement ? 'required' : 'required',
  instructions: '',
  dataType: type === 'property' ? 'IFCLABEL' : '',
  relation: type === 'partOf' ? 'IFCRELAGGREGATES' : '',
  values: Object.fromEntries(FACET_FIELDS[type].map((f) => [f.key, { kind: 'any' } as IdsValue])),
});

export const newSpec = (n: number): Spec => ({
  id: newId(),
  name: `Specification ${n}`,
  identifier: '',
  ifcVersion: 'IFC2X3 IFC4',
  description: '',
  instructions: '',
  minOccurs: '0',
  maxOccurs: 'unbounded',
  applicability: [newFacet('entity', false)],
  requirements: [],
});

export const newDoc = (title: string, author: string): IdsDoc => ({ title, description: '', author, version: '1', date: new Date().toISOString().slice(0, 10), purpose: '', specs: [newSpec(1)] });

const kids = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name);
const kid = (el: Element, name: string) => kids(el, name)[0] ?? null;
const text = (el: Element | null) => el?.textContent?.trim() ?? '';

function parseValue(el: Element | null): IdsValue {
  if (!el) return { kind: 'any' };
  const inner = el.children[0];
  if (!inner) return { kind: 'any' };
  if (inner.localName === 'simpleValue') return { kind: 'simple', text: inner.textContent ?? '' };
  if (inner.localName === 'restriction') {
    const parts = [...inner.children];
    if (parts.length && parts.every((p) => p.localName === 'enumeration')) return { kind: 'enum', values: parts.map((p) => p.getAttribute('value') ?? '') };
    if (parts.length === 1 && parts[0].localName === 'pattern') return { kind: 'pattern', pattern: parts[0].getAttribute('value') ?? '' };
  }
  return { kind: 'raw', xml: new XMLSerializer().serializeToString(inner) };
}

function parseFacet(el: Element): Facet | null {
  const type = el.localName as FacetType;
  if (!FACET_TYPES.includes(type)) return null;
  const f = newFacet(type, true);
  f.cardinality = (el.getAttribute('cardinality') as Cardinality | null) ?? 'required';
  f.instructions = el.getAttribute('instructions') ?? '';
  f.dataType = el.getAttribute('dataType') ?? '';
  f.relation = el.getAttribute('relation') ?? '';
  const source = type === 'partOf' ? kid(el, 'entity') ?? el : el;
  for (const field of FACET_FIELDS[type]) f.values[field.key] = parseValue(kid(source, field.key));
  return f;
}

/** Reads an .ids file; throws a readable message when it is not one. */
export function parseIds(xml: string): IdsDoc {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('This is not valid XML.');
  const root = dom.documentElement;
  if (root.localName !== 'ids') throw new Error('This is not an IDS file (no <ids> element).');
  const info = kid(root, 'info');
  const specs: Spec[] = [];
  for (const s of kids(kid(root, 'specifications') ?? root, 'specification')) {
    const app = kid(s, 'applicability');
    const req = kid(s, 'requirements');
    specs.push({
      id: newId(),
      name: s.getAttribute('name') ?? '',
      identifier: s.getAttribute('identifier') ?? '',
      ifcVersion: s.getAttribute('ifcVersion') ?? 'IFC2X3 IFC4',
      description: s.getAttribute('description') ?? '',
      instructions: s.getAttribute('instructions') ?? '',
      minOccurs: app?.getAttribute('minOccurs') ?? '0',
      maxOccurs: app?.getAttribute('maxOccurs') ?? 'unbounded',
      applicability: app ? [...app.children].map(parseFacet).filter((f): f is Facet => !!f) : [],
      requirements: req ? [...req.children].map(parseFacet).filter((f): f is Facet => !!f) : [],
    });
  }
  return {
    title: text(info && kid(info, 'title')),
    description: text(info && kid(info, 'description')),
    author: text(info && kid(info, 'author')),
    version: text(info && kid(info, 'version')),
    date: text(info && kid(info, 'date')),
    purpose: text(info && kid(info, 'purpose')),
    specs,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function valueXml(tag: string, v: IdsValue, pad: string): string {
  if (v.kind === 'any') return '';
  if (v.kind === 'simple') return `${pad}<${tag}><simpleValue>${esc(v.text)}</simpleValue></${tag}>\n`;
  if (v.kind === 'pattern') return `${pad}<${tag}><xs:restriction base="xs:string"><xs:pattern value="${esc(v.pattern)}"/></xs:restriction></${tag}>\n`;
  if (v.kind === 'enum') return `${pad}<${tag}>\n${pad}  <xs:restriction base="xs:string">\n${v.values.map((x) => `${pad}    <xs:enumeration value="${esc(x)}"/>\n`).join('')}${pad}  </xs:restriction>\n${pad}</${tag}>\n`;
  return `${pad}<${tag}>${v.xml}</${tag}>\n`;
}

/** Whether a value is empty enough to be left out of the file (an empty text or list says nothing). */
const blank = (v: IdsValue) => v.kind === 'any' || (v.kind === 'simple' && v.text === '') || (v.kind === 'enum' && v.values.length === 0) || (v.kind === 'pattern' && v.pattern === '');

function facetXml(f: Facet, requirement: boolean, pad: string): string {
  const attrs = [
    f.type === 'property' && f.dataType ? ` dataType="${esc(f.dataType)}"` : '',
    f.type === 'partOf' && f.relation ? ` relation="${esc(f.relation)}"` : '',
    requirement && f.type !== 'entity' ? ` cardinality="${f.cardinality}"` : '',
    f.instructions ? ` instructions="${esc(f.instructions)}"` : '',
  ].join('');
  const parts = FACET_FIELDS[f.type].map((field) => valueXml(field.key, blank(f.values[field.key] ?? { kind: 'any' }) ? { kind: 'any' } : f.values[field.key], f.type === 'partOf' ? `${pad}    ` : `${pad}  `)).join('');
  if (f.type === 'partOf') return `${pad}<partOf${attrs}>\n${pad}  <entity>\n${parts}${pad}  </entity>\n${pad}</partOf>\n`;
  return `${pad}<${f.type}${attrs}>\n${parts}${pad}</${f.type}>\n`;
}

/** Writes the document as an .ids file. */
export function serializeIds(doc: IdsDoc): string {
  const info = [['title', doc.title], ['description', doc.description], ['author', doc.author], ['version', doc.version], ['date', doc.date], ['purpose', doc.purpose]]
    .filter(([, v]) => v)
    .map(([k, v]) => `    <${k}>${esc(v)}</${k}>\n`)
    .join('');
  const specs = doc.specs.map((s) => {
    const attrs = [['name', s.name], ['identifier', s.identifier], ['ifcVersion', s.ifcVersion], ['description', s.description], ['instructions', s.instructions]]
      .filter(([k, v]) => v || k === 'name' || k === 'ifcVersion')
      .map(([k, v]) => ` ${k}="${esc(v)}"`)
      .join('');
    return `    <specification${attrs}>\n      <applicability minOccurs="${esc(s.minOccurs)}" maxOccurs="${esc(s.maxOccurs)}">\n${s.applicability.map((f) => facetXml(f, false, '        ')).join('')}      </applicability>\n      <requirements>\n${s.requirements.map((f) => facetXml(f, true, '        ')).join('')}      </requirements>\n    </specification>\n`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://standards.buildingsmart.org/IDS http://standards.buildingsmart.org/IDS/1.0/ids.xsd">\n  <info>\n${info}  </info>\n  <specifications>\n${specs}  </specifications>\n</ids>\n`;
}
