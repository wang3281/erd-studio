import type {
  AlterDirective,
  Column,
  Entity,
  ERDSchema,
  ParseResult,
  ParsedForeignKey,
  Relation,
} from "../model/types";
import { createRelation } from "../model/factory";
import { normName } from "./diff";

export interface MaterializedAlters {
  incoming: ERDSchema;
  touchedEntityKeys: Set<string>;
  warnings: string[];
}

export interface PreparedSmartMergeInput extends MaterializedAlters {
  unresolvedForeignKeys: ParsedForeignKey[];
}

export function materializeAltersToIncoming(
  current: ERDSchema,
  incoming: ERDSchema,
  alters: AlterDirective[],
): MaterializedAlters {
  const materialized: ERDSchema = {
    ...incoming,
    entities: incoming.entities.map(cloneEntity),
    relations: incoming.relations.map(cloneRelation),
  };
  const touchedEntityKeys = new Set(materialized.entities.map((entity) => normName(entity.name)));
  const warnings: string[] = [];

  for (const alter of alters) {
    const tableKey = normName(alter.tableName);
    let entity = materialized.entities.find((candidate) => normName(candidate.name) === tableKey);
    if (!entity) {
      const currentEntity = current.entities.find((candidate) => normName(candidate.name) === tableKey);
      if (!currentEntity) {
        warnings.push(`ALTER TABLE ${alter.tableName}: table not found in canvas or import - skipped.`);
        continue;
      }
      entity = cloneEntity(currentEntity);
      materialized.entities.push(entity);
    }

    touchedEntityKeys.add(tableKey);
    applyAlter(entity, alter);
  }

  return { incoming: materialized, touchedEntityKeys, warnings };
}

/**
 * Builds the partial-import schema used by Smart Merge. Parsed foreign keys
 * retain logical endpoint names, so references to tables that only exist on
 * the current canvas can be rebound without treating those context tables as
 * DDL changes.
 */
export function prepareSmartMergeInput(
  current: ERDSchema,
  parsed: ParseResult,
): PreparedSmartMergeInput {
  const materialized = materializeAltersToIncoming(
    current,
    parsed.schema,
    parsed.alters,
  );
  const incoming: ERDSchema = {
    ...materialized.incoming,
    entities: materialized.incoming.entities.map(cloneEntity),
    relations: materialized.incoming.relations
      .filter((relation) => relation.source !== "ddl")
      .map(cloneRelation),
  };
  const warnings = [...materialized.warnings];
  const unresolvedForeignKeys: ParsedForeignKey[] = [];

  function ensureEntity(name: string): Entity | undefined {
    const key = normName(name);
    const existing = incoming.entities.find((entity) => normName(entity.name) === key);
    if (existing) return existing;
    const fromCurrent = current.entities.find((entity) => normName(entity.name) === key);
    if (!fromCurrent) return undefined;
    const cloned = cloneEntity(fromCurrent);
    incoming.entities.push(cloned);
    return cloned;
  }

  const seen = new Set<string>();
  for (const foreignKey of parsed.foreignKeys) {
    const sourceEntity = ensureEntity(foreignKey.sourceTable);
    const targetEntity = ensureEntity(foreignKey.targetTable);
    const sourceColumn = sourceEntity?.columns.find(
      (column) => normName(column.name) === normName(foreignKey.sourceColumn),
    );
    const targetColumn = targetEntity?.columns.find(
      (column) => normName(column.name) === normName(foreignKey.targetColumn),
    );

    const missing: string[] = [];
    if (!sourceEntity) missing.push(`source table ${foreignKey.sourceTable}`);
    else if (!sourceColumn) {
      missing.push(`source column ${foreignKey.sourceTable}.${foreignKey.sourceColumn}`);
    }
    if (!targetEntity) missing.push(`target table ${foreignKey.targetTable}`);
    else if (!targetColumn) {
      missing.push(`target column ${foreignKey.targetTable}.${foreignKey.targetColumn}`);
    }
    if (missing.length > 0 || !sourceEntity || !sourceColumn || !targetEntity || !targetColumn) {
      unresolvedForeignKeys.push(foreignKey);
      warnings.push(`Line ${foreignKey.line}: FOREIGN KEY unresolved (${missing.join(", ")}).`);
      continue;
    }

    materialized.touchedEntityKeys.add(normName(foreignKey.sourceTable));
    sourceColumn.isForeignKey = true;
    const key = [
      normName(sourceEntity.name),
      normName(sourceColumn.name),
      normName(targetEntity.name),
      normName(targetColumn.name),
      foreignKey.cardinality,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    incoming.relations.push(createRelation({
      sourceEntityId: sourceEntity.id,
      sourceColumnId: sourceColumn.id,
      targetEntityId: targetEntity.id,
      targetColumnId: targetColumn.id,
      cardinality: foreignKey.cardinality,
      source: "ddl",
      name: foreignKey.name,
    }));
  }

  return {
    incoming,
    touchedEntityKeys: materialized.touchedEntityKeys,
    warnings,
    unresolvedForeignKeys,
  };
}

function applyAlter(entity: Entity, alter: AlterDirective): void {
  if (alter.kind === "addColumn" || alter.kind === "modifyColumn") {
    upsertColumn(entity, alter.column);
    return;
  }
  if (alter.kind === "dropColumn") {
    removeColumn(entity, alter.columnName);
    return;
  }

  const existing = entity.columns.find((column) => normName(column.name) === normName(alter.from));
  if (existing) {
    upsertColumn(entity, { ...alter.column, id: existing.id });
    if (normName(alter.from) !== normName(alter.column.name)) {
      removeColumn(entity, alter.from);
    }
    return;
  }
  upsertColumn(entity, alter.column);
}

function upsertColumn(entity: Entity, column: Column): void {
  const existingIndex = entity.columns.findIndex((candidate) => normName(candidate.name) === normName(column.name));
  if (existingIndex >= 0) {
    entity.columns[existingIndex] = { ...column, id: entity.columns[existingIndex].id };
    return;
  }
  entity.columns.push(cloneColumn(column));
}

function removeColumn(entity: Entity, columnName: string): void {
  entity.columns = entity.columns.filter((column) => normName(column.name) !== normName(columnName));
}

function cloneEntity(entity: Entity): Entity {
  return {
    ...entity,
    position: { ...entity.position },
    columns: entity.columns.map(cloneColumn),
  };
}

function cloneColumn(column: Column): Column {
  return { ...column };
}

function cloneRelation(relation: Relation): Relation {
  return { ...relation };
}
