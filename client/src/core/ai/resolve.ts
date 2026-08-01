import type { Entity, Relation } from "../model/types";
import type { AIRelationSuggestion, ResolvedSuggestion } from "./types";

function normName(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

export function resolveAISuggestions(
  suggestions: AIRelationSuggestion[],
  entities: Entity[],
  existingRelations: Relation[],
): ResolvedSuggestion[] {
  const entityByName = new Map<string, Entity>();
  for (const e of entities) {
    entityByName.set(normName(e.name), e);
  }

  const existingPairs = new Set<string>();
  for (const rel of existingRelations) {
    existingPairs.add(pairKey(rel.sourceEntityId, rel.sourceColumnId, rel.targetEntityId, rel.targetColumnId));
    existingPairs.add(pairKey(rel.targetEntityId, rel.targetColumnId, rel.sourceEntityId, rel.sourceColumnId));
  }

  return suggestions.map((s) => {
    const srcEntity = entityByName.get(normName(s.sourceEntityName));
    const tgtEntity = entityByName.get(normName(s.targetEntityName));

    if (!srcEntity) {
      return unresolvedResult(s, `Entity "${s.sourceEntityName}" not found`);
    }
    if (!tgtEntity) {
      return unresolvedResult(s, `Entity "${s.targetEntityName}" not found`);
    }

    const srcCol = srcEntity.columns.find(
      (c) => normName(c.name) === normName(s.sourceColumnName),
    );
    const tgtCol = tgtEntity.columns.find(
      (c) => normName(c.name) === normName(s.targetColumnName),
    );

    if (!srcCol) {
      return unresolvedResult(s, `Column "${s.sourceColumnName}" not found in "${s.sourceEntityName}"`);
    }
    if (!tgtCol) {
      return unresolvedResult(s, `Column "${s.targetColumnName}" not found in "${s.targetEntityName}"`);
    }

    const key = pairKey(srcEntity.id, srcCol.id, tgtEntity.id, tgtCol.id);
    const duplicate = existingPairs.has(key);
    if (!duplicate) {
      existingPairs.add(key);
      existingPairs.add(pairKey(tgtEntity.id, tgtCol.id, srcEntity.id, srcCol.id));
    }

    return {
      suggestion: s,
      sourceEntityId: srcEntity.id,
      sourceColumnId: srcCol.id,
      targetEntityId: tgtEntity.id,
      targetColumnId: tgtCol.id,
      duplicate,
      unresolvable: false,
    };
  });
}

function pairKey(srcEnt: string, srcCol: string, tgtEnt: string, tgtCol: string): string {
  return `${srcEnt}:${srcCol}->${tgtEnt}:${tgtCol}`;
}

function unresolvedResult(s: AIRelationSuggestion, reason: string): ResolvedSuggestion {
  return {
    suggestion: s,
    sourceEntityId: "",
    sourceColumnId: "",
    targetEntityId: "",
    targetColumnId: "",
    duplicate: false,
    unresolvable: true,
    unresolvableReason: reason,
  };
}
