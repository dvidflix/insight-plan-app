import type { RelationType } from './types';

const REL_TYPE_MAP: Record<string, RelationType> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };

/** Normalizes both XER's PR_* codes and XML's free-text relationship types
    ("Finish to Start" etc.) to the same FS/SS/FF/SF vocabulary. */
export function normalizeRelType(raw: string | undefined): RelationType {
  if (raw && REL_TYPE_MAP[raw]) return REL_TYPE_MAP[raw];
  const s = String(raw || '');
  if (/start.*start/i.test(s)) return 'SS';
  if (/finish.*finish/i.test(s)) return 'FF';
  if (/start.*finish/i.test(s)) return 'SF';
  return 'FS';
}
