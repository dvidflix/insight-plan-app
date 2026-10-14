import type { ScheduleCalendar } from './calendar';

export type ActivityStatus = 'not-started' | 'in-progress' | 'completed';
export type ActivityType = 'task' | 'milestone-start' | 'milestone-finish' | 'loe' | 'wbs-summary';
export type RelationType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Relationship {
  predId: string;
  succId: string;
  type: RelationType;
  lagHours: number;
}

export interface ResourceAssignment {
  resourceId: string;
  resourceName: string;
  resourceType: 'labor' | 'material' | 'equipment' | 'other';
  targetQty: number;
  remainQty: number;
  targetCost: number;
  actualCost: number;
  /** Units per hour: for labour, the crew size (people working every day
      of the activity; P6 counts 1 person as 1 hour/hour). Absent when the
      source didn't give it — then crew = targetQty ÷ duration hours. */
  unitsPerTime?: number;
  /** App-only: added by this app (see virtualResources.ts), not part of the
      programme file, so it is never written back to XML. */
  virtual?: boolean;
}

/** A resource of the programme, with its site capacity when known. */
export interface ResourceInfo {
  id: string;
  name: string;
  type: ResourceAssignment['resourceType'];
  /** Labour: people available per day (P6 max units/time); equipment and counted materials (a scenario's pool): how many there are; null if unset. */
  capacity: number | null;
  /** App-only resource (see virtualResources.ts). */
  virtual?: boolean;
}

export interface Activity {
  id: string;
  /** Source P6 project (XER), when a schedule holds several projects. */
  projectId?: string;
  code: string;
  name: string;
  wbsId: string | null;
  wbsPath: string;
  /** The WBS codes along the same path, " / "-joined and segment-for-segment
      parallel to wbsPath — what the WBS tree sorts siblings by. */
  wbsCodePath?: string;
  type: ActivityType;
  status: ActivityStatus;
  targetStart: Date | null;
  targetFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  earlyStart: Date | null;
  earlyFinish: Date | null;
  lateStart: Date | null;
  lateFinish: Date | null;
  durationHours: number;
  remainingDurationHours: number;
  totalFloatHours: number | null;
  freeFloatHours: number | null;
  isCritical: boolean;
  percentComplete: number;
  constraintType: string | null;
  constraintDate: Date | null;
  activityCodes: Record<string, string>;
  resources: ResourceAssignment[];
  calendarId: string | null;
  udf: Record<string, string | number | Date>;
  // Further P6 activity fields. Optional so schedules saved before they were
  // read (e.g. inside an exported configuration file) still load.
  physicalPercentComplete?: number | null;
  durationType?: string;
  percentCompleteType?: string;
  secondaryConstraintType?: string | null;
  secondaryConstraintDate?: Date | null;
  remainingStart?: Date | null;
  remainingFinish?: Date | null;
  suspendDate?: Date | null;
  resumeDate?: Date | null;
  expectedFinish?: Date | null;
  primaryResource?: string;
  longestPath?: boolean;
  /** Place among the activities of its WBS node, as the planner orders them (kept in the project database only; not in an XER). */
  seq?: number;
}

export interface ActivityCodeValue {
  id: string;
  value: string;
  description: string;
  parentId: string | null;
}

export interface ActivityCodeTypeDef {
  id: string;
  name: string;
  values: ActivityCodeValue[];
}

export interface WbsNode {
  id: string;
  name: string;
  /** WBS code (P6 "wbs_short_name" / XML "Code"). */
  code?: string;
  parentId: string | null;
  /** Place among its siblings (P6 seq_num); absent: the siblings are in their natural order. */
  seq?: number;
}

export interface ScheduleProject {
  id: string;
  name: string;
  dataDate: Date | null;
  planStart: Date | null;
  planFinish: Date | null;
}

export interface ScheduleModel {
  /** Stable per-load identifier (distinct from project.id, which can be
      empty or repeat across separate loads of the same P6 project) — lets
      multiple schedules be loaded and told apart at once. */
  id: string;
  sourceFileName: string;
  sourceFormat: 'xer' | 'xml';
  /** Loaded from the project database (ip_programme.id) — the database,
      not this copy, is the source of truth. */
  dbProgrammeId?: number;
  /** A programme edited in place (see db ProgrammeRow.editable): its edits change the model and are written to the database, instead of
      being kept on top of it (state/activityOverridesStore.ts). */
  editable?: boolean;
  project: ScheduleProject;
  activities: Activity[];
  relationships: Relationship[];
  wbs: WbsNode[];
  activityCodeTypes: string[];
  /** Full activity code dictionary (types with their, possibly hierarchical,
      values and descriptions) — as opposed to activityCodeTypes, which is
      just the type names. Optional so schedules saved before this existed
      still load. */
  activityCodeCatalog?: ActivityCodeTypeDef[];
  resourceNames: string[];
  /** Resources with type and capacity. Optional so schedules saved before
      this existed still load. */
  resourceCatalog?: ResourceInfo[];
  calendars: ScheduleCalendar[];
  /** True once total float/critical path have been algorithmically recomputed
      (via cpm.ts) rather than read straight from the source file — used to
      show a "no calendar, approximate" disclaimer in the UI. */
  computedFloat: boolean;
}
