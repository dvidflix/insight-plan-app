import { useLinkGroupsStore } from './linkGroupsStore';
import { useAppearanceStore } from './appearanceStore';
import { useScheduleStore } from './scheduleStore';
import { useModelsStore } from './modelsStore';
import { usePendingImportsStore, type PendingFile } from './pendingImportsStore';
import type { LinkGroup } from '../schedule/linkGroups';
import type { AppearanceProfile } from '../schedule/appearance';
import type { ScheduleModel } from '../schedule/types';
import { snapshotPersistedConfig, restorePersistedConfig } from '../utils/persistedState';

const CONFIG_KIND = 'insight-plan-app-config';
// v3 adds optional `path` hints on model/schedule references (see
// PendingFile) and a `scheduleReferences` list — both purely additive, so a
// v2 file still imports fine (every new field falls back to `[]`/undefined).
const CONFIG_VERSION = 3;

/** Marks a Date so it survives JSON.stringify/parse — ScheduleModel has
    Date fields scattered through activities/UDFs/calendars with no fixed
    schema (UDF values in particular are only Date sometimes, per-project),
    so this walks the whole tree instead of converting known field names. */
function dateAwareReplacer(_key: string, value: unknown): unknown {
  return value instanceof Date ? { __isDate: true, iso: value.toISOString() } : value;
}

function dateAwareReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && (value as { __isDate?: boolean }).__isDate) {
    return new Date((value as { iso: string }).iso);
  }
  return value;
}

/** The whole-app "Configuration" file: Link Groups, Appearance Profiles,
    every loaded Programme (full schedule data — these are plain JSON under
    the hood, so they round-trip completely) plus which ones are hidden
    ("unload without removing"), every persisted UI setting (column
    arrangements, color/group/sort rules, palettes, zoom, Gantt/Sequencing
    toggles, viewer display settings — see utils/persistedState.ts), and
    reference lists of loaded 3D Models and Programmes with their hidden
    state. Models (and, optionally, Programmes — see scheduleReferences) are
    NOT re-embedded by name/id/hidden alone: IFC/fragments geometry is tens
    to hundreds of MB, not a fit for a settings file, so only their name/id/
    hidden flag is recorded and importAppConfig asks the user to re-add the
    matching files. Neither reference ever gets a real filesystem `path`
    from a normal export — browsers don't expose one from a file picker or
    drop — so `path` only shows up on a config someone hand-edited to
    include one (as a hint for where to browse to); it's optional and
    otherwise just absent. */
export function exportAppConfig() {
  const modelsState = useModelsStore.getState();
  const scheduleState = useScheduleStore.getState();
  const payload = {
    kind: CONFIG_KIND,
    version: CONFIG_VERSION,
    exportedAt: new Date().toISOString(),
    linkGroups: useLinkGroupsStore.getState().groups,
    appearanceProfiles: useAppearanceStore.getState().profiles,
    schedules: scheduleState.schedules,
    hiddenScheduleIds: [...scheduleState.hiddenScheduleIds],
    scheduleReferences: scheduleState.schedules.map((s) => ({ name: s.sourceFileName })),
    modelReferences: modelsState.models.map((m) => ({
      modelId: m.modelId,
      name: m.name,
      elementCount: m.elementCount,
      hidden: modelsState.hiddenModelIds.has(m.modelId),
    })),
    settings: snapshotPersistedConfig(),
  };
  const json = JSON.stringify(payload, dateAwareReplacer, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'insight-plan-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

export interface ImportAppConfigResult {
  /** Models referenced by the file that aren't currently loaded — their
      geometry wasn't in the file, so the caller should prompt the user to
      re-add these from the Inputs tab. Also pushed to usePendingImportsStore
      so the Inputs tab itself can show the list without prop-drilling. */
  missingModels: PendingFile[];
  /** Programmes referenced (via scheduleReferences) but not present in this
      file's own embedded `schedules` and not already loaded — e.g. a config
      that was deliberately stripped of its embedded schedule data in favor
      of just a path hint. */
  missingSchedules: PendingFile[];
}

export async function importAppConfig(file: File): Promise<ImportAppConfigResult> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, dateAwareReviver);
  } catch {
    throw new Error('Not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { kind?: string }).kind !== CONFIG_KIND) {
    throw new Error('Not a recognized Insight Plan configuration file.');
  }
  const { linkGroups, appearanceProfiles, schedules, hiddenScheduleIds, scheduleReferences, modelReferences, settings } = parsed as {
    linkGroups?: unknown;
    appearanceProfiles?: unknown;
    schedules?: unknown;
    hiddenScheduleIds?: unknown;
    scheduleReferences?: unknown;
    modelReferences?: unknown;
    settings?: unknown;
  };

  const importedSchedules = Array.isArray(schedules) ? (schedules as ScheduleModel[]) : [];
  useLinkGroupsStore.getState().replaceAll(Array.isArray(linkGroups) ? (linkGroups as LinkGroup[]) : []);
  useAppearanceStore.getState().replaceAll(Array.isArray(appearanceProfiles) ? (appearanceProfiles as AppearanceProfile[]) : []);
  useScheduleStore
    .getState()
    .replaceAll(importedSchedules, Array.isArray(hiddenScheduleIds) ? (hiddenScheduleIds as string[]) : []);
  if (settings && typeof settings === 'object') restorePersistedConfig(settings as Record<string, string>);

  const modelRefs = Array.isArray(modelReferences) ? (modelReferences as { name: string; hidden?: boolean; path?: string }[]) : [];
  const hiddenNames = modelRefs.filter((m) => m.hidden).map((m) => m.name);
  const modelsState = useModelsStore.getState();
  // Already-loaded models with a matching name are hidden immediately;
  // anything not currently loaded is remembered so re-adding it from Inputs
  // (after the user re-imports the IFC file, since geometry isn't in this
  // config file) re-applies the hidden flag automatically.
  const loadedByName = new Map(modelsState.models.map((m) => [m.name, m.modelId]));
  const hiddenModelIds = new Set(modelsState.hiddenModelIds);
  const stillPending: string[] = [];
  for (const name of hiddenNames) {
    const id = loadedByName.get(name);
    if (id) hiddenModelIds.add(id);
    else stillPending.push(name);
  }
  useModelsStore.setState({ hiddenModelIds });
  modelsState.setPendingHiddenNames(stillPending);

  const loadedModelNames = new Set(modelsState.models.map((m) => m.name));
  const missingModels = modelRefs.filter((m) => !loadedModelNames.has(m.name)).map((m) => ({ name: m.name, path: m.path }));

  const scheduleRefs = Array.isArray(scheduleReferences) ? (scheduleReferences as { name: string; path?: string }[]) : [];
  const namesInThisFile = new Set(importedSchedules.map((s) => s.sourceFileName));
  const alreadyLoadedNames = new Set(useScheduleStore.getState().schedules.map((s) => s.sourceFileName));
  const missingSchedules = scheduleRefs
    .filter((s) => !namesInThisFile.has(s.name) && !alreadyLoadedNames.has(s.name))
    .map((s) => ({ name: s.name, path: s.path }));

  usePendingImportsStore.getState().setPending(missingModels, missingSchedules);

  return { missingModels, missingSchedules };
}
