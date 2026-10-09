/** Just enough of IFC's STEP text format for patches to edit a file in
    place: find entities, split their attributes, and write the file back
    with some entities replaced, deleted or added — everything else stays
    byte for byte as it was. */

export interface StepEntity {
  id: number;
  type: string;
  /** Offsets of the "#id=" and just past its ";". */
  start: number;
  end: number;
  /** The text between the attribute list's outer brackets. */
  args: string;
}

/** Splits a STEP argument list (text between the outer brackets) at its
    top-level commas; strings ('it''s') and nested lists are kept whole. */
export function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inString) {
      if (ch === "'") {
        if (inner[i + 1] === "'") i++;
        else inString = false;
      }
    } else if (ch === "'") inString = true;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out;
}

/** Index of the bracket closing the one at `open`, or -1. */
export function closingBracket(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        if (text[i + 1] === "'") i++;
        else inString = false;
      }
    } else if (ch === "'") inString = true;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Every entity in the file, in file order. */
export function readEntities(text: string): StepEntity[] {
  const out: StepEntity[] = [];
  const head = /#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(/g;
  for (let m = head.exec(text); m; m = head.exec(text)) {
    const open = m.index + m[0].length - 1;
    const close = closingBracket(text, open);
    if (close < 0) break;
    const semi = text.indexOf(';', close);
    const end = semi < 0 ? close + 1 : semi + 1;
    out.push({ id: Number(m[1]), type: m[2].toUpperCase(), start: m.index, end, args: text.slice(open + 1, close) });
    head.lastIndex = end;
  }
  return out;
}

/** The references (#n) in an attribute, e.g. "(#1,#2)" → [1, 2]. */
export const refsIn = (arg: string): number[] => [...arg.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));

export const ref = (id: number) => `#${id}`;
export const refList = (ids: number[]) => `(${ids.map(ref).join(',')})`;

/** A STEP string literal: quotes doubled, anything beyond ASCII as \X2\. */
export function stepString(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (code >= 32 && code < 127) out += ch;
    else out += `\\X2\\${code.toString(16).toUpperCase().padStart(code > 0xffff ? 8 : 4, '0')}\\X0\\`;
  }
  return `'${out}'`;
}

/** A STEP real: always with a decimal point ("3000.", "1.5"). */
export function stepReal(n: number): string {
  const s = String(Math.round(n * 1e6) / 1e6);
  return s.includes('.') || s.includes('e') ? s : `${s}.`;
}

const GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** A new IFC GlobalId: 128 random bits in IFC's 22-character base-64. */
export function newGuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 22; i++) {
    out = GUID_CHARS[Number(n & 63n)] + out;
    n >>= 6n;
  }
  return out;
}

/** n new GlobalIds that sort in the order given, whether a tool compares
    them as text (with or without case) or as numbers: a shared random
    start and a rising counter of digits and capitals only. Some viewers
    list storeys by GlobalId, so storeys given these show in level order. */
export function orderedGuids(n: number): string[] {
  const base = newGuid().slice(0, 16);
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: n }, (_, i) => {
    let s = '';
    for (let k = i, j = 0; j < 6; j++, k = Math.floor(k / 36)) s = digits[k % 36] + s;
    return base + s;
  });
}

export function ifcSchema(text: string): string {
  return /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(text.slice(0, 20000))?.[1].toUpperCase() ?? '';
}

/** The IFC header's originating system (FILE_NAME's sixth attribute), or ''. */
export function originatingSystem(text: string): string {
  const head = text.slice(0, 20000);
  const m = /FILE_NAME\s*\(/i.exec(head);
  if (!m) return '';
  const open = m.index + m[0].length - 1;
  const close = closingBracket(head, open);
  if (close < 0) return '';
  const t = (splitArgs(head.slice(open + 1, close))[5] ?? '').trim();
  return t.startsWith("'") ? t.slice(1, -1).replace(/''/g, "'") : '';
}

/** Rewrites the file: `replace` gives an entity's new attribute text (null
    deletes it, with its line), `added` are appended to the DATA section
    as "#id=TYPE(args);" lines. */
export function writeEntities(text: string, entities: StepEntity[], replace: Map<number, string | null>, added: string[]): string {
  const pieces: string[] = [];
  let last = 0;
  for (const e of entities) {
    if (!replace.has(e.id)) continue;
    const next = replace.get(e.id);
    pieces.push(text.slice(last, e.start));
    if (next === null) {
      // Drop the line break after a deleted entity too.
      last = e.end;
      if (text[last] === '\r') last++;
      if (text[last] === '\n') last++;
    } else {
      pieces.push(`#${e.id}=${e.type}(${next});`);
      last = e.end;
    }
  }
  pieces.push(text.slice(last));
  let out = pieces.join('');
  if (added.length) {
    const eol = out.includes('\r\n') ? '\r\n' : '\n';
    const data = out.search(/\bDATA\s*;/i);
    const endsec = data < 0 ? -1 : out.indexOf('ENDSEC;', data);
    if (endsec < 0) throw new Error('The file has no DATA section to add to.');
    out = out.slice(0, endsec) + added.join(eol) + eol + out.slice(endsec);
  }
  return out;
}
