export interface ModelTreeNode {
  category: string;
  localId: number | null;
  children: ModelTreeNode[];
}

export interface ElementSummary {
  localId: number;
  guid: string;
  name: string;
  category: string;
  /** IFC Description attribute ('' when absent). */
  description?: string;
  /** File name of the model this element was loaded from. */
  fileName: string;
  /** Flattened "PsetName.PropName" -> value, plus top-level attributes. */
  props: Record<string, unknown>;
}

export interface LoadedModelInfo {
  modelId: string;
  name: string;
  elementCount: number;
  elements: ElementSummary[];
  tree: ModelTreeNode;
}
