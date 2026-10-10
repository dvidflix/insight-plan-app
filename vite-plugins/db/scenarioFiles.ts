import fs from 'node:fs';
import * as XLSX from 'xlsx';

export type { Crew, Flag, Relation, ScenarioContent, SequenceItem } from '../../src/db/core';
import type { ScenarioContent, SequenceItem, Relation, Crew } from '../../src/db/core';

export const SEQUENCE_SHEET = 'SequenceOrder';

/** <scenario>/<building>.scenario.json — what scenarios were kept in before
    the project database; now only imported once (see projectDb.ts). */
export function readJsonScenario(file: string): ScenarioContent | null {
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { sequence: data.sequence ?? [], relations: data.relations ?? [], crews: data.crews ?? [] };
}

/** An Overrides workbook's SequenceOrder, Relations and Crews sheets
    (read-only import of the legacy Excel workflow). */
export function readLegacyWorkbook(file: string): ScenarioContent | null {
  if (!fs.existsSync(file)) return null;
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  const sheet = (name: string) => (wb.Sheets[name] ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { raw: false, defval: '' }) : []);
  const str = (v: unknown) => String(v ?? '').trim();
  const sequence = sheet(SEQUENCE_SHEET)
    .filter((r) => str(r.GUID) && /^\d+(\.\d+)?$/.test(str(r.Index)))
    .map((r) => ({ GUID: str(r.GUID), Index: Math.trunc(Number(str(r.Index))), Phase: str(r.Phase || r.Activity) }));
  const relations = sheet('Relations')
    .filter((r) => str(r.ActivityID1) && str(r.ActivityID2))
    .map((r) => ({ ActivityID1: str(r.ActivityID1), ActivityID2: str(r.ActivityID2), Relation: str(r.Relation) || 'FS', Lag: Number(str(r.Lag)) || 0 }));
  const crews = sheet('Crews')
    .filter((r) => str(r.Phase) && str(r.Trade))
    .map((r) => ({ Phase: str(r.Phase), PourType: str(r.PourType), Trade: str(r.Trade), Crew: str(r.Crew) }));
  return { sequence, relations, crews };
}
