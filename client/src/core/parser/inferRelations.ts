import type { Entity, Relation } from "../model/types";
import { createRelation } from "../model/factory";

const EXCLUDED_COLUMNS = new Set([
  "id",
  "uuid",
  "created_at",
  "updated_at",
  "deleted_at",
  "created_by",
  "updated_by",
  "deleted_by",
  "is_deleted",
  "is_active",
  "status",
  "version",
  "created_date",
  "modified_date",
  "modified_at",
]);

/**
 * Infer relations between entities that share identical column names.
 * Skips columns already linked by explicit FK relations and common utility columns.
 */
export function inferRelations(
  entities: Entity[],
  existingRelations: Relation[],
): Relation[] {
  // Build set of already-covered entity pairs per column name
  const coveredPairs = new Set<string>();
  for (const rel of existingRelations) {
    const src = entities.find((e) => e.id === rel.sourceEntityId);
    const tgt = entities.find((e) => e.id === rel.targetEntityId);
    if (!src || !tgt) continue;
    const srcCol = src.columns.find((c) => c.id === rel.sourceColumnId);
    const tgtCol = tgt.columns.find((c) => c.id === rel.targetColumnId);
    if (!srcCol || !tgtCol) continue;

    // If columns have the same name, mark this entity pair as covered for that column
    if (srcCol.name.toLowerCase() === tgtCol.name.toLowerCase()) {
      const [a, b] = [rel.sourceEntityId, rel.targetEntityId].sort();
      coveredPairs.add(`${a}|${b}|${srcCol.name.toLowerCase()}`);
    }
    // Also cover pairs where different column names reference each other
    const [a, b] = [rel.sourceEntityId, rel.targetEntityId].sort();
    coveredPairs.add(`${a}|${b}|${srcCol.name.toLowerCase()}`);
    coveredPairs.add(`${a}|${b}|${tgtCol.name.toLowerCase()}`);
  }

  // Pre-compute PK column count per entity (to detect sole-PK master tables)
  const pkCountByEntity = new Map<string, number>();
  for (const entity of entities) {
    pkCountByEntity.set(entity.id, entity.columns.filter((c) => c.isPrimaryKey).length);
  }

  // Build column name → [{entityId, columnId, isPrimaryKey}] index
  const colIndex = new Map<
    string,
    Array<{ entityId: string; columnId: string; isPrimaryKey: boolean }>
  >();

  for (const entity of entities) {
    for (const col of entity.columns) {
      const key = col.name.toLowerCase();
      if (EXCLUDED_COLUMNS.has(key)) continue;
      if (!colIndex.has(key)) colIndex.set(key, []);
      colIndex.get(key)!.push({
        entityId: entity.id,
        columnId: col.id,
        isPrimaryKey: col.isPrimaryKey,
      });
    }
  }

  const inferred: Relation[] = [];

  for (const [colName, entries] of colIndex) {
    if (entries.length < 2) continue;

    // Find the "master" — the entity where this column is the sole PK
    const master = entries.find(
      (e) => e.isPrimaryKey && pkCountByEntity.get(e.entityId) === 1,
    );
    if (!master) continue;

    // Connect master → each non-PK child only
    for (const child of entries) {
      if (child.entityId === master.entityId) continue;
      if (child.isPrimaryKey) continue;

      const [sortedA, sortedB] = [master.entityId, child.entityId].sort();
      if (coveredPairs.has(`${sortedA}|${sortedB}|${colName}`)) continue;

      inferred.push(
        createRelation({
          sourceEntityId: child.entityId,
          sourceColumnId: child.columnId,
          targetEntityId: master.entityId,
          targetColumnId: master.columnId,
          cardinality: "N:1",
          source: "inferred",
        }),
      );

      coveredPairs.add(`${sortedA}|${sortedB}|${colName}`);
    }
  }

  return inferred;
}
