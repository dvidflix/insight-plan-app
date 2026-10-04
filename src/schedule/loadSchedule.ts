import { recomputeCpm } from './cpm';
import { parseXer, type XerTables } from './parsers/xer';
import { hasUsableSourceFloat, listXerProjects, normalizeXer } from './parsers/normalize';
import { parseXml, type XmlTables } from './parsers/xml';
import { hasUsableXmlFloat, listXmlProjects, normalizeXml } from './parsers/normalizeXml';
import { isMsProjectXml, isSpreadsheet, parseExcelSchedule, parseMsProjectXml } from './parsers/otherFormats';
import type { ScheduleModel } from './types';

export type ParsedSchedule =
  | { format: 'xer'; tables: XerTables; fileName: string; projects: { id: string; name: string }[] }
  | { format: 'xml'; tables: XmlTables; fileName: string; projects: { id: string; name: string }[] };

/** Parses the raw file into tables and lists the projects it contains,
    without building the (potentially expensive) full ScheduleModel yet —
    callers should prompt for a project when there's more than one. */
export async function parseScheduleFile(file: File): Promise<ParsedSchedule> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xer')) {
    const text = decodeXerText(await file.arrayBuffer());
    const tables = parseXer(text);
    return { format: 'xer', tables, fileName: file.name, projects: listXerProjects(tables) };
  }
  const tables = await xmlScheduleTables(file);
  return { format: 'xml', tables, fileName: file.name, projects: listXmlProjects(tables) };
}

export const SCHEDULE_ACCEPT = '.xer,.xml,.xlsx,.xlsm,.xls,.csv';

/** A non-XER programme as P6-XML-style tables: a P6 XML, an MS Project XML
    (File > Save As > XML) or an Excel / CSV sheet (see otherFormats.ts). */
export async function xmlScheduleTables(file: File): Promise<XmlTables> {
  const lowerName = file.name.toLowerCase();
  if (isSpreadsheet(lowerName)) return parseExcelSchedule(await file.arrayBuffer(), file.name);
  if (lowerName.endsWith('.mpp') || lowerName.endsWith('.mpt')) {
    throw new Error(`${file.name}: .mpp files can't be read here. In MS Project use File > Save As > XML (*.xml) and import that file.`);
  }
  if (lowerName.endsWith('.xml')) {
    const text = await file.text();
    return isMsProjectXml(text) ? parseMsProjectXml(text) : parseXml(text);
  }
  throw new Error(`Unsupported schedule file type: ${file.name}. Use a P6 .xer / .xml, an MS Project .xml or an Excel / CSV file.`);
}

/** P6 writes XER in the ANSI code page; UTF-8 only if the whole file is valid UTF-8. */
function decodeXerText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** projectId: several ids load those XER projects together as one schedule
    (XML takes the first). */
export function buildScheduleModel(parsed: ParsedSchedule, projectId?: string | string[]): ScheduleModel {
  let model: ScheduleModel;
  let hasFloat: boolean;
  if (parsed.format === 'xer') {
    model = normalizeXer(parsed.tables, parsed.fileName, projectId);
    hasFloat = hasUsableSourceFloat(parsed.tables);
  } else {
    model = normalizeXml(parsed.tables, parsed.fileName, Array.isArray(projectId) ? projectId[0] : projectId);
    hasFloat = hasUsableXmlFloat(parsed.tables);
  }
  model.id = crypto.randomUUID();
  return hasFloat ? model : recomputeCpm(model);
}
