import type { ElementSummary } from '../viewer/types';
import type { PourRow } from '../scenarios/pourOrder';

/** The scenario's pour order as steps of activity ids: rows in play order, rows sharing a step together,
    each row's GlobalId found in the loaded models and mapped to the activities that own that object.
    Rows outside the manual sequence (blank Index) and pours no activity is linked to are left out. */
export function buildPourSequence(
  rows: PourRow[],
  headers: string[],
  loadedModels: { modelId: string; elements: ElementSummary[] }[],
  ownersOf: Map<string, string[]>,
): string[][] {
  const guidCol = headers.indexOf('GUID');
  if (guidCol < 0 || !rows.length) return [];
  const keyOfGuid = new Map<string, string>();
  for (const m of loadedModels) for (const el of m.elements) if (el.guid) keyOfGuid.set(el.guid, `${m.modelId}:${el.localId}`);

  const steps: string[][] = [];
  let lastStep: number | null = null;
  for (const row of rows) {
    if (row.step === null) continue;
    const key = keyOfGuid.get(row.cells[guidCol] ?? '');
    const owners = key ? ownersOf.get(key) ?? [] : [];
    if (row.step !== lastStep) {
      steps.push([]);
      lastStep = row.step;
    }
    const step = steps[steps.length - 1];
    for (const id of owners) if (!step.includes(id)) step.push(id);
  }
  return steps.filter((s) => s.length > 0);
}
