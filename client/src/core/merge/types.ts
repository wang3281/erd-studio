import type { Column, Entity, Relation } from "../model/types";

export type ColumnField =
  | "type"
  | "nullable"
  | "isPrimaryKey"
  | "isForeignKey"
  | "isUnique"
  | "isAutoIncrement"
  | "defaultValue"
  | "comment";

export type EntityField = "comment";

export type DiffKind = "added" | "removed" | "modified" | "unchanged";

export interface ColumnDiff {
  kind: DiffKind;
  current?: Column;
  incoming?: Column;
  changedFields?: ColumnField[];
}

interface EntityDiffBase {
  /** Lowercased name used as match key. */
  key: string;
  /** Display name (incoming wins when present, falls back to current). */
  displayName: string;
  columns: ColumnDiff[];
}

export interface AddedEntityDiff extends EntityDiffBase {
  kind: "added";
  incomingEntity: Entity;
  currentEntity?: never;
  changedFields?: never;
}

export interface RemovedEntityDiff extends EntityDiffBase {
  kind: "removed";
  currentEntity: Entity;
  incomingEntity?: never;
  changedFields?: never;
}

export interface ModifiedEntityDiff extends EntityDiffBase {
  kind: "modified";
  currentEntity: Entity;
  incomingEntity: Entity;
  changedFields?: EntityField[];
}

export interface UnchangedEntityDiff extends EntityDiffBase {
  kind: "unchanged";
  currentEntity: Entity;
  incomingEntity: Entity;
  changedFields?: never;
}

export type EntityDiff =
  | AddedEntityDiff
  | RemovedEntityDiff
  | ModifiedEntityDiff
  | UnchangedEntityDiff;


export type RelationDiffKind = "added" | "removed" | "unchanged";

export interface RelationDiff {
  kind: RelationDiffKind;
  /** Stable string key derived from incoming/current relation endpoints. */
  key: string;
  currentRelation?: Relation;
  incomingRelation?: Relation;
  /** Set when an incoming DDL relation cannot be re-bound to the merged schema. */
  unmapped?: "source" | "target" | "both";
}

export interface SchemaDiff {
  mode: "full" | "partial";
  entities: EntityDiff[];
  relations: RelationDiff[];
  warnings: string[];
  stats: {
    entitiesAdded: number;
    entitiesModified: number;
    entitiesRemoved: number;
    entitiesUnchanged: number;
    relationsAdded: number;
    relationsRemoved: number;
    relationsUnchanged: number;
    relationsUnmapped: number;
  };
}

export interface DiffOptions {
  mode?: "full" | "partial";
  touchedEntityKeys?: Set<string>;
}

export interface ApplyOptions {
  /** When true, removed entities are kept and marked status="deprecated". Default true. */
  markRemovedAsDeprecated: boolean;
  /** Entity ids the user explicitly opted to delete (overrides deprecated marking). */
  removeEntityIds?: string[];
}

export const DEFAULT_APPLY_OPTIONS: ApplyOptions = {
  markRemovedAsDeprecated: true,
  removeEntityIds: [],
};
