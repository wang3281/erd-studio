import type { Column, Entity, ERDSchema, Relation } from "../model/types";
import { findEmptyPosition } from "../layout/index";
import { recalcEntityDimensions } from "../../canvas/measure";
import type { ApplyOptions, ColumnDiff, SchemaDiff } from "./types";
import { DEFAULT_APPLY_OPTIONS } from "./types";
import { normName } from "./diff";

export interface ApplyResult {
  schema: ERDSchema;
  warnings: string[];
  /** Entity ids that were dropped from the merged schema (hard-removed). */
  removedEntityIds: string[];
  /** Relation ids that were dropped (e.g. dangling endpoint after column removal). */
  removedRelationIds: string[];
}

/**
 * Build a merged ERDSchema by applying a SchemaDiff against `current`, drawing
 * incoming column/entity content from `incoming`. Preserves user-edited
 * metadata: position, headerColor, comment (when not changed by DDL),
 * existing entity/column ids, and all non-ddl relations.
 */
export function applyDiff(
  current: ERDSchema,
  incoming: ERDSchema,
  diff: SchemaDiff,
  options: Partial<ApplyOptions> = {},
): ApplyResult {
  const opts: ApplyOptions = { ...DEFAULT_APPLY_OPTIONS, ...options };
  const warnings: string[] = [...diff.warnings];
  const removedEntityIds: string[] = [];
  const removedRelationIds: string[] = [];

  // Quick lookups.
  const incomingByKey = new Map<string, Entity>();
  for (const e of incoming.entities) incomingByKey.set(normName(e.name), e);
  const currentByKey = new Map<string, Entity>();
  for (const e of current.entities) currentByKey.set(normName(e.name), e);

  // Resulting entities, in stable order: keep current order first, then append
  // newly added entities (in the order they appear in incoming).
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const e of current.entities) {
    const k = normName(e.name);
    if (!seen.has(k)) {
      orderedKeys.push(k);
      seen.add(k);
    }
  }
  for (const e of incoming.entities) {
    const k = normName(e.name);
    if (!seen.has(k)) {
      orderedKeys.push(k);
      seen.add(k);
    }
  }

  const diffByKey = new Map(diff.entities.map((d) => [d.key, d]));

  // Build merged entities.
  const merged: Entity[] = [];
  // Track positional context for findEmptyPosition: pass the running merged list.
  for (const k of orderedKeys) {
    const d = diffByKey.get(k);
    if (!d) {
      // Defensive: entity present in current but missing from diff means unchanged.
      const cur = currentByKey.get(k);
      if (cur) merged.push(cur);
      continue;
    }
    switch (d.kind) {
      case "removed": {
        const cur = d.currentEntity;
        const explicitlyDelete = (opts.removeEntityIds ?? []).includes(cur.id);
        if (!explicitlyDelete && opts.markRemovedAsDeprecated) {
          merged.push({ ...cur, status: "deprecated" });
        } else {
          // Hard delete.
          removedEntityIds.push(cur.id);
        }
        break;
      }
      case "added": {
        const inc = d.incomingEntity;
        const pos = findEmptyPosition(merged, inc);
        const newEntity: Entity = {
          ...inc,
          position: pos,
          status: "new",
        };
        merged.push(recalcEntityDimensions(newEntity));
        break;
      }
      case "unchanged": {
        merged.push(d.currentEntity);
        break;
      }
      case "modified": {
        const cur = d.currentEntity;
        const inc = d.incomingEntity;
        const mergedColumns = mergeColumns(cur.columns, inc.columns, d.columns);
        const mergedEntity: Entity = {
          ...cur,
          // Use incoming name (DDL is SSOT for naming/casing).
          name: inc.name,
          // Update comment from incoming when DDL provides one; otherwise preserve current.
          comment: inc.comment !== undefined ? inc.comment : cur.comment,
          columns: mergedColumns,
          status: "modified",
        };
        merged.push(recalcEntityDimensions(mergedEntity));
        break;
      }
    }
  }

  // ---- Relations ----
  // 1) Carry through every non-ddl relation from current, dropping any whose endpoint entity/column no longer exists.
  // 2) For ddl relations, follow the diff: keep unchanged (preserve id), drop removed, add new (rebind ids by name).
  const mergedEntityById = new Map(merged.map((e) => [e.id, e]));
  const mergedEntityByKey = new Map(merged.map((e) => [normName(e.name), e]));

  function findColumnByName(entityKey: string, columnKey: string): { entityId: string; columnId: string } | null {
    const e = mergedEntityByKey.get(entityKey);
    if (!e) return null;
    const c = e.columns.find((col) => normName(col.name) === columnKey);
    if (!c) return null;
    return { entityId: e.id, columnId: c.id };
  }

  function endpointStillValid(entityId: string, columnId: string): boolean {
    const e = mergedEntityById.get(entityId);
    if (!e) return false;
    return e.columns.some((c) => c.id === columnId);
  }

  const mergedRelations: Relation[] = [];

  // Carry through non-ddl relations.
  for (const r of current.relations) {
    if (r.source === "ddl") continue;
    if (!endpointStillValid(r.sourceEntityId, r.sourceColumnId) || !endpointStillValid(r.targetEntityId, r.targetColumnId)) {
      removedRelationIds.push(r.id);
      continue;
    }
    mergedRelations.push(r);
  }

  // Process ddl relations from the diff.
  // Build a lookup from current ddl relation key -> Relation (preserve id when unchanged).
  for (const rd of diff.relations) {
    if (rd.kind === "unchanged" && rd.currentRelation) {
      // Re-validate endpoint after potential column name/casing changes.
      const r = rd.currentRelation;
      const cur = current.entities.find((e) => e.id === r.sourceEntityId);
      const tgt = current.entities.find((e) => e.id === r.targetEntityId);
      if (!cur || !tgt) {
        removedRelationIds.push(r.id);
        continue;
      }
      const sCol = cur.columns.find((c) => c.id === r.sourceColumnId);
      const tCol = tgt.columns.find((c) => c.id === r.targetColumnId);
      if (!sCol || !tCol) {
        removedRelationIds.push(r.id);
        continue;
      }
      const sLookup = findColumnByName(normName(cur.name), normName(sCol.name));
      const tLookup = findColumnByName(normName(tgt.name), normName(tCol.name));
      if (!sLookup || !tLookup) {
        removedRelationIds.push(r.id);
        continue;
      }
      mergedRelations.push({
        ...r,
        name: rd.incomingRelation?.name ?? r.name,
        sourceEntityId: sLookup.entityId,
        sourceColumnId: sLookup.columnId,
        targetEntityId: tLookup.entityId,
        targetColumnId: tLookup.columnId,
      });
      continue;
    }

    if (rd.kind === "removed" && rd.currentRelation) {
      removedRelationIds.push(rd.currentRelation.id);
      continue;
    }

    if (rd.kind === "added" && rd.incomingRelation) {
      const r = rd.incomingRelation;
      // Resolve incoming endpoint names against merged schema by name.
      const srcEntity = incoming.entities.find((e) => e.id === r.sourceEntityId);
      const tgtEntity = incoming.entities.find((e) => e.id === r.targetEntityId);
      if (!srcEntity || !tgtEntity) {
        warnings.push(`DDL relation dropped: endpoint entity not found in incoming schema.`);
        continue;
      }
      const srcCol = srcEntity.columns.find((c) => c.id === r.sourceColumnId);
      const tgtCol = tgtEntity.columns.find((c) => c.id === r.targetColumnId);
      if (!srcCol || !tgtCol) {
        warnings.push(`DDL relation dropped: endpoint column not found in incoming schema.`);
        continue;
      }
      const sLookup = findColumnByName(normName(srcEntity.name), normName(srcCol.name));
      const tLookup = findColumnByName(normName(tgtEntity.name), normName(tgtCol.name));
      if (!sLookup || !tLookup) {
        warnings.push(`DDL relation dropped: ${srcEntity.name}.${srcCol.name} -> ${tgtEntity.name}.${tgtCol.name} (endpoint missing on canvas).`);
        continue;
      }
      mergedRelations.push({
        ...r,
        sourceEntityId: sLookup.entityId,
        sourceColumnId: sLookup.columnId,
        targetEntityId: tLookup.entityId,
        targetColumnId: tLookup.columnId,
        source: "ddl",
      });
    }
  }

  const mergedSchema: ERDSchema = {
    ...current,
    entities: merged,
    relations: mergedRelations,
  };

  return { schema: mergedSchema, warnings, removedEntityIds, removedRelationIds };
}

/**
 * Merge columns inside a single entity:
 *  - unchanged → keep current Column (id preserved).
 *  - modified → start from current (id preserved), override mutable fields from incoming.
 *  - added → keep incoming Column (parser-generated id is fine).
 *  - removed → drop from output.
 *
 * Output ordering follows the incoming column order, with any remaining current-only
 * (already-removed) columns naturally absent. This means DDL-driven re-ordering takes effect.
 */
function mergeColumns(currentCols: Column[], incomingCols: Column[], colDiffs: ColumnDiff[]): Column[] {
  const currentByKey = new Map<string, Column>();
  for (const c of currentCols) currentByKey.set(normName(c.name), c);

  const diffByIncomingKey = new Map<string, ColumnDiff>();
  for (const d of colDiffs) {
    if (d.incoming) diffByIncomingKey.set(normName(d.incoming.name), d);
  }

  const out: Column[] = [];
  for (const inc of incomingCols) {
    const key = normName(inc.name);
    const d = diffByIncomingKey.get(key);
    const cur = currentByKey.get(key);
    if (d?.kind === "unchanged" && cur) {
      out.push(cur);
    } else if (d?.kind === "modified" && cur) {
      out.push({
        ...cur,
        name: inc.name,
        type: inc.type,
        nullable: inc.nullable,
        isPrimaryKey: inc.isPrimaryKey,
        isForeignKey: inc.isForeignKey,
        isUnique: inc.isUnique,
        isAutoIncrement: inc.isAutoIncrement,
        defaultValue: inc.defaultValue,
        comment: inc.comment !== undefined ? inc.comment : cur.comment,
      });
    } else {
      // added (or fallback)
      out.push(inc);
    }
  }
  return out;
}
