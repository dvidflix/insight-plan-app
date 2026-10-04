export type XmlRow = { [tag: string]: string | XmlRow | XmlRow[] };
export type XmlTables = Record<string, XmlRow[]>;

const KNOWN_TAGS = [
  'Project', 'WBS', 'Activity', 'Relationship', 'Resource', 'ResourceAssignment',
  'ActivityCodeType', 'ActivityCode', 'ActivityCodeAssignment', 'CodeAssignment',
  'UDFType', 'UDFValue', 'Calendar', 'ResourceRate',
];

function elementToRow(el: Element): XmlRow {
  const row: XmlRow = {};
  for (const child of Array.from(el.children)) {
    const tag = child.tagName;
    if (child.children.length === 0) {
      row[tag] = child.textContent ?? '';
    } else {
      const nested = elementToRow(child);
      const existing = row[tag];
      if (existing === undefined) row[tag] = nested;
      else if (Array.isArray(existing)) existing.push(nested);
      else row[tag] = [existing as XmlRow, nested];
    }
  }
  return row;
}

/** Parses a P6 .xml export (APIBusinessObjects schema) into plain tables
    keyed by top-level tag name — one row per element, nested repeating
    children collapsed into arrays. Mirrors insight-plan-web's xmlParser.js. */
export function parseXml(text: string): XmlTables {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid or unsupported XML file (parse error).');

  const tables: XmlTables = {};
  for (const tag of KNOWN_TAGS) {
    const els = doc.getElementsByTagName(tag);
    if (els.length === 0) continue;
    const rows: XmlRow[] = [];
    for (let i = 0; i < els.length; i++) rows.push(elementToRow(els[i]));
    tables[tag] = rows;
  }
  return tables;
}

export function str(row: XmlRow, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v : '';
}

export function nested(row: XmlRow, key: string): XmlRow[] {
  const v = row[key];
  if (!v || typeof v === 'string') return [];
  return Array.isArray(v) ? v : [v];
}

/** A <Calendar>'s <HolidayOrExceptions>: each dated exception with its work
    spans (HH:MM), none for a holiday. */
export function holidayOrExceptions(cal: XmlRow): { date: string; spans: { start: string; finish: string }[] }[] {
  return nested(cal, 'HolidayOrExceptions')
    .flatMap((h) => nested(h, 'HolidayOrException'))
    .map((ex) => ({
      date: str(ex, 'Date').slice(0, 10),
      spans: nested(ex, 'WorkTime')
        .filter((w) => str(w, 'Start'))
        .map((w) => ({ start: str(w, 'Start').slice(0, 5), finish: str(w, 'Finish').slice(0, 5) })),
    }))
    .filter((ex) => /^\d{4}-\d{2}-\d{2}$/.test(ex.date));
}
