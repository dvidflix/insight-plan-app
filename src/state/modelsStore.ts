import { create } from 'zustand';
import type { LoadedModelInfo } from '../viewer/types';

interface ModelsState {
  models: LoadedModelInfo[];
  selectedModelId: string | null;
  selectedLocalId: number | null;
  /** Models toggled off from the Inputs list — stay loaded (geometry kept
      in the viewer engine, so toggling back on is instant) but hidden from
      the 3D view, the "unload without removing" ask. */
  hiddenModelIds: Set<string>;
  /** Model names an imported app configuration remembered as hidden, but
      whose geometry isn't in that file (see appConfig.ts) — re-applied to
      hiddenModelIds the moment a model with a matching name gets (re-)added,
      since config import can't restore live 3D state by itself. */
  pendingHiddenNames: Set<string>;
  addModel: (model: LoadedModelInfo) => void;
  removeModel: (modelId: string) => void;
  select: (modelId: string | null, localId: number | null) => void;
  toggleModelHidden: (modelId: string) => void;
  setPendingHiddenNames: (names: string[]) => void;
}

export const useModelsStore = create<ModelsState>((set) => ({
  models: [],
  selectedModelId: null,
  selectedLocalId: null,
  hiddenModelIds: new Set(),
  pendingHiddenNames: new Set(),
  addModel: (model) =>
    set((s) => {
      const hiddenModelIds = new Set(s.hiddenModelIds);
      const pendingHiddenNames = new Set(s.pendingHiddenNames);
      if (pendingHiddenNames.has(model.name)) {
        hiddenModelIds.add(model.modelId);
        pendingHiddenNames.delete(model.name);
      }
      return {
        models: [...s.models.filter((m) => m.modelId !== model.modelId), model],
        selectedModelId: model.modelId,
        hiddenModelIds,
        pendingHiddenNames,
      };
    }),
  removeModel: (modelId) =>
    set((s) => {
      const models = s.models.filter((m) => m.modelId !== modelId);
      const wasSelected = s.selectedModelId === modelId;
      const hiddenModelIds = new Set(s.hiddenModelIds);
      hiddenModelIds.delete(modelId);
      return {
        models,
        hiddenModelIds,
        selectedModelId: wasSelected ? (models[0]?.modelId ?? null) : s.selectedModelId,
        selectedLocalId: wasSelected ? null : s.selectedLocalId,
      };
    }),
  select: (modelId, localId) => set({ selectedModelId: modelId, selectedLocalId: localId }),
  toggleModelHidden: (modelId) =>
    set((s) => {
      const hiddenModelIds = new Set(s.hiddenModelIds);
      if (hiddenModelIds.has(modelId)) hiddenModelIds.delete(modelId);
      else hiddenModelIds.add(modelId);
      return { hiddenModelIds };
    }),
  setPendingHiddenNames: (names) => set({ pendingHiddenNames: new Set(names) }),
}));
