/** Shared JSON export/import for saved-item collections (link Groups, saved
    Queries, SmartViews) — Navisworks-search-set style: download what you
    built here, hand the file to a teammate, they import it there. */
export function exportJson<T>(kind: string, items: T[]) {
  const payload = { kind, version: 1, exportedAt: new Date().toISOString(), items };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `insight-plan-${kind}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importJson<T>(file: File, expectedKind: string): Promise<T[]> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error('Not a recognized export file (missing "items" array).');
  }
  if (parsed.kind && parsed.kind !== expectedKind) {
    throw new Error(`This file is a "${parsed.kind}" export, not "${expectedKind}".`);
  }
  return parsed.items as T[];
}
