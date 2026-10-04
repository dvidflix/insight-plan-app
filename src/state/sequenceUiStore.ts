import { create } from 'zustand';
import type { ModelPanels } from '../viewer/viewerUI';
import type { Activity } from '../schedule/types';

interface SequenceUiState {
  /** The Models page's Configuration tab contents, built with the viewer. */
  modelPanels: ModelPanels | null;
  /** Current 4D colour of a task (Appearance Profile stage), for the video export's Tasks table. */
  taskColorOf: ((a: Activity) => string | null) | null;
}

export const useSequenceUiStore = create<SequenceUiState>(() => ({
  modelPanels: null,
  taskColorOf: null,
}));
