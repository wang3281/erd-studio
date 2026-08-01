export type {
  ApplyOptions,
  ColumnDiff,
  ColumnField,
  DiffOptions,
  DiffKind,
  EntityDiff,
  EntityField,
  RelationDiff,
  RelationDiffKind,
  SchemaDiff,
} from "./types";
export { DEFAULT_APPLY_OPTIONS } from "./types";
export { diffColumns, diffEntity, diffSchema, isAllUnchanged, normName, relationKey } from "./diff";
export { applyDiff } from "./apply";
export type { ApplyResult } from "./apply";
export { materializeAltersToIncoming, prepareSmartMergeInput } from "./alters";
export type { MaterializedAlters, PreparedSmartMergeInput } from "./alters";
