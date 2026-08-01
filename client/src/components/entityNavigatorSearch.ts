import type { Entity } from "../core/model/types";

export interface EntityNavigatorResult {
  entity: Entity;
  matchingColumns: string[];
}

export function filterEntityNavigatorResults(
  entities: Entity[],
  query: string,
): EntityNavigatorResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return entities.map((entity) => ({ entity, matchingColumns: [] }));
  }

  return entities.flatMap((entity) => {
    const tableMatches = entity.name.toLocaleLowerCase().includes(normalized);
    const matchingColumns = entity.columns
      .filter((column) => column.name.toLocaleLowerCase().includes(normalized))
      .map((column) => column.name);
    return tableMatches || matchingColumns.length > 0
      ? [{ entity, matchingColumns }]
      : [];
  });
}
