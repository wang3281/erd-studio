import type { Column, Entity, ERDSchema, Relation } from "../model/types";
import type {
  ColumnDiff,
  ColumnField,
  DiffOptions,
  EntityDiff,
  RelationDiff,
  SchemaDiff,
} from "./types";

export function normName(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

function normType(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

const COLUMN_FIELDS: ColumnField[] = [
  "type",
  "nullable",
  "isPrimaryKey",
  "isForeignKey",
  "isUnique",
  "isAutoIncrement",
  "defaultValue",
  "comment",
];

function colFieldEqual(a: Column, b: Column, field: ColumnField): boolean {
  switch (field) {
    case "type":
      return normType(a.type) === normType(b.type);
    case "nullable":
      return Boolean(a.nullable) === Boolean(b.nullable);
    case "isPrimaryKey":
      return Boolean(a.isPrimaryKey) === Boolean(b.isPrimaryKey);
    case "isForeignKey":
      return Boolean(a.isForeignKey) === Boolean(b.isForeignKey);
    case "isUnique":
      return Boolean(a.isUnique) === Boolean(b.isUnique);
    case "isAutoIncrement":
      return Boolean(a.isAutoIncrement) === Boolean(b.isAutoIncrement);
    case "defaultValue":
      return (a.defaultValue ?? "") === (b.defaultValue ?? "");
    case "comment":
      return b.comment === undefined || (a.comment ?? "") === b.comment;
  }
}

export function diffColumns(current: Column[], incoming: Column[]): ColumnDiff[] {
  const curByKey = new Map<string, Column>();
  for (const c of current) curByKey.set(normName(c.name), c);

  const incomingKeys = new Set<string>();
  const out: ColumnDiff[] = [];

  for (const inc of incoming) {
    const key = normName(inc.name);
    incomingKeys.add(key);
    const cur = curByKey.get(key);
    if (!cur) {
      out.push({ kind: "added", incoming: inc });
      continue;
    }
    const changed: ColumnField[] = [];
    for (const f of COLUMN_FIELDS) {
      if (!colFieldEqual(cur, inc, f)) changed.push(f);
    }
    // Name casing change is preserved via incoming but not flagged as a diff field.
    const nameDiffers = cur.name !== inc.name;
    if (changed.length === 0 && !nameDiffers) {
      out.push({ kind: "unchanged", current: cur, incoming: inc });
    } else {
      out.push({
        kind: "modified",
        current: cur,
        incoming: inc,
        changedFields: changed,
      });
    }
  }

  for (const cur of current) {
    if (!incomingKeys.has(normName(cur.name))) {
      out.push({ kind: "removed", current: cur });
    }
  }

  return out;
}

function entityCommentChanged(a: Entity, b: Entity): boolean {
  return b.comment !== undefined && (a.comment ?? "") !== b.comment;
}

export function diffEntity(current: Entity | undefined, incoming: Entity | undefined): EntityDiff {
  if (current && !incoming) {
    return {
      kind: "removed",
      key: normName(current.name),
      displayName: current.name,
      currentEntity: current,
      columns: current.columns.map<ColumnDiff>((c) => ({ kind: "removed", current: c })),
    };
  }
  if (!current && incoming) {
    return {
      kind: "added",
      key: normName(incoming.name),
      displayName: incoming.name,
      incomingEntity: incoming,
      columns: incoming.columns.map<ColumnDiff>((c) => ({ kind: "added", incoming: c })),
    };
  }
  if (!current || !incoming) {
    throw new Error("diffEntity requires at least one schema entity.");
  }
  const cols = diffColumns(current.columns, incoming.columns);
  const entityFieldsChanged = entityCommentChanged(current, incoming) ? (["comment"] as const) : [];
  const anyColumnChange = cols.some((c) => c.kind !== "unchanged");
  const isModified = current.name !== incoming.name || anyColumnChange || (entityFieldsChanged?.length ?? 0) > 0;
  const base = {
    key: normName(incoming.name),
    displayName: incoming.name,
    currentEntity: current,
    incomingEntity: incoming,
    columns: cols,
  };
  if (!isModified) {
    return { kind: "unchanged", ...base };
  }
  return {
    kind: "modified",
    ...base,
    changedFields: entityFieldsChanged.length > 0 ? [...entityFieldsChanged] : undefined,
  };
}

interface RelationLookup {
  resolveEntityKey: (entityId: string) => string | undefined;
  resolveColumnKey: (entityId: string, columnId: string) => string | undefined;
}

function makeLookup(schema: ERDSchema): RelationLookup {
  const eMap = new Map<string, Entity>();
  for (const e of schema.entities) eMap.set(e.id, e);
  return {
    resolveEntityKey: (id) => {
      const e = eMap.get(id);
      return e ? normName(e.name) : undefined;
    },
    resolveColumnKey: (entityId, columnId) => {
      const e = eMap.get(entityId);
      if (!e) return undefined;
      const c = e.columns.find((x) => x.id === columnId);
      return c ? normName(c.name) : undefined;
    },
  };
}

export function relationKey(rel: Relation, lookup: RelationLookup): string | null {
  const sE = lookup.resolveEntityKey(rel.sourceEntityId);
  const sC = lookup.resolveColumnKey(rel.sourceEntityId, rel.sourceColumnId);
  const tE = lookup.resolveEntityKey(rel.targetEntityId);
  const tC = lookup.resolveColumnKey(rel.targetEntityId, rel.targetColumnId);
  if (!sE || !sC || !tE || !tC) return null;
  return `${sE}.${sC}->${tE}.${tC}|${rel.cardinality}`;
}

interface IncomingResolution {
  sourceEntityKey?: string;
  sourceColumnKey?: string;
  targetEntityKey?: string;
  targetColumnKey?: string;
}

function resolveIncomingAgainstCurrent(
  rel: Relation,
  incomingLookup: RelationLookup,
  currentEntityNames: Set<string>,
  currentColumnNamesByEntity: Map<string, Set<string>>,
): { mapped: boolean; key: string | null; unmapped?: "source" | "target" | "both"; resolved: IncomingResolution } {
  const sE = incomingLookup.resolveEntityKey(rel.sourceEntityId);
  const sC = incomingLookup.resolveColumnKey(rel.sourceEntityId, rel.sourceColumnId);
  const tE = incomingLookup.resolveEntityKey(rel.targetEntityId);
  const tC = incomingLookup.resolveColumnKey(rel.targetEntityId, rel.targetColumnId);

  const resolved: IncomingResolution = {
    sourceEntityKey: sE,
    sourceColumnKey: sC,
    targetEntityKey: tE,
    targetColumnKey: tC,
  };
  if (!sE || !sC || !tE || !tC) {
    return { mapped: false, key: null, unmapped: "both", resolved };
  }
  // Endpoints are considered resolvable if they exist in EITHER schema (current canvas
  // OR incoming DDL). The merged-name sets passed in are the union of both.
  const sourceInMerged = currentEntityNames.has(sE) && (currentColumnNamesByEntity.get(sE)?.has(sC) ?? false);
  const targetInMerged = currentEntityNames.has(tE) && (currentColumnNamesByEntity.get(tE)?.has(tC) ?? false);

  const key = `${sE}.${sC}->${tE}.${tC}|${rel.cardinality}`;
  const unmappedSrc = !sourceInMerged;
  const unmappedTgt = !targetInMerged;
  let unmapped: "source" | "target" | "both" | undefined;
  if (unmappedSrc && unmappedTgt) unmapped = "both";
  else if (unmappedSrc) unmapped = "source";
  else if (unmappedTgt) unmapped = "target";
  return { mapped: true, key, unmapped, resolved };
}

function buildIncomingNameSets(schema: ERDSchema): {
  entityNames: Set<string>;
  columnNamesByEntity: Map<string, Set<string>>;
} {
  const entityNames = new Set<string>();
  const columnNamesByEntity = new Map<string, Set<string>>();
  for (const e of schema.entities) {
    const ek = normName(e.name);
    entityNames.add(ek);
    columnNamesByEntity.set(ek, new Set(e.columns.map((c) => normName(c.name))));
  }
  return { entityNames, columnNamesByEntity };
}

export function diffSchema(current: ERDSchema, incoming: ERDSchema, options: DiffOptions = {}): SchemaDiff {
  const mode = options.mode ?? "full";
  const warnings: string[] = [];

  // Entity diff (key by lowercase name).
  const incomingByKey = new Map<string, Entity>();
  for (const e of incoming.entities) {
    const k = normName(e.name);
    if (incomingByKey.has(k)) {
      warnings.push(`Duplicate table in DDL: "${e.name}" — only the first occurrence is used.`);
      continue;
    }
    incomingByKey.set(k, e);
  }
  const currentByKey = new Map<string, Entity>();
  for (const e of current.entities) {
    const k = normName(e.name);
    if (!currentByKey.has(k)) currentByKey.set(k, e);
  }

  const entityDiffs: EntityDiff[] = [];
  // Iterate incoming first for stable ordering.
  for (const [k, inc] of incomingByKey) {
    const cur = currentByKey.get(k);
    entityDiffs.push(diffEntity(cur, inc));
  }
  // Removed: in current but not in incoming. Partial imports intentionally do
  // not treat absent tables as deletion requests.
  if (mode === "full") {
    for (const [k, cur] of currentByKey) {
      if (!incomingByKey.has(k)) {
        entityDiffs.push(diffEntity(cur, undefined));
      }
    }
  } else if (options.touchedEntityKeys) {
    for (let index = entityDiffs.length - 1; index >= 0; index--) {
      if (!options.touchedEntityKeys.has(entityDiffs[index].key)) {
        entityDiffs.splice(index, 1);
      }
    }
  }

  // Relations: only ddl-source ones participate in diff. non-ddl are carried through at apply.
  const currentLookup = makeLookup(current);
  const incomingLookup = makeLookup(incoming);

  const currentDdl = current.relations.filter((r) => r.source === "ddl");
  const incomingDdl = incoming.relations.filter((r) => r.source === "ddl");

  const currentByRelKey = new Map<string, Relation>();
  for (const r of currentDdl) {
    const k = relationKey(r, currentLookup);
    if (k && !currentByRelKey.has(k)) currentByRelKey.set(k, r);
  }

  const merged = mergedNameSets(current, incoming);
  const incomingByRelKey = new Map<string, { rel: Relation; unmapped?: "source" | "target" | "both" }>();
  for (const r of incomingDdl) {
    const res = resolveIncomingAgainstCurrent(
      r,
      incomingLookup,
      merged.entityNames,
      merged.columnNamesByEntity,
    );
    if (!res.key) {
      warnings.push(`DDL relation skipped: endpoints could not be resolved (${rendererForRel(r)}).`);
      continue;
    }
    if (!incomingByRelKey.has(res.key)) {
      incomingByRelKey.set(res.key, { rel: r, unmapped: res.unmapped });
    }
  }

  const relationDiffs: RelationDiff[] = [];
  for (const [k, payload] of incomingByRelKey) {
    const existing = currentByRelKey.get(k);
    if (existing) {
      relationDiffs.push({
        kind: "unchanged",
        key: k,
        currentRelation: existing,
        incomingRelation: payload.rel,
      });
    } else {
      relationDiffs.push({
        kind: "added",
        key: k,
        incomingRelation: payload.rel,
        unmapped: payload.unmapped,
      });
    }
  }
  for (const [k, rel] of currentByRelKey) {
    if (!incomingByRelKey.has(k)) {
      if (mode === "partial" && currentRelationStillValidForPartial(rel, currentLookup, incomingByKey, incoming)) {
        relationDiffs.push({ kind: "unchanged", key: k, currentRelation: rel });
      } else {
        relationDiffs.push({ kind: "removed", key: k, currentRelation: rel });
      }
    }
  }

  const stats = {
    entitiesAdded: entityDiffs.filter((d) => d.kind === "added").length,
    entitiesModified: entityDiffs.filter((d) => d.kind === "modified").length,
    entitiesRemoved: entityDiffs.filter((d) => d.kind === "removed").length,
    entitiesUnchanged: entityDiffs.filter((d) => d.kind === "unchanged").length,
    relationsAdded: relationDiffs.filter((d) => d.kind === "added").length,
    relationsRemoved: relationDiffs.filter((d) => d.kind === "removed").length,
    relationsUnchanged: relationDiffs.filter((d) => d.kind === "unchanged").length,
    relationsUnmapped: relationDiffs.filter((d) => d.kind === "added" && d.unmapped).length,
  };

  return { mode, entities: entityDiffs, relations: relationDiffs, warnings, stats };
}

function currentRelationStillValidForPartial(
  rel: Relation,
  currentLookup: RelationLookup,
  incomingByKey: Map<string, Entity>,
  incoming: ERDSchema,
): boolean {
  const sourceEntityKey = currentLookup.resolveEntityKey(rel.sourceEntityId);
  const sourceColumnKey = currentLookup.resolveColumnKey(rel.sourceEntityId, rel.sourceColumnId);
  const targetEntityKey = currentLookup.resolveEntityKey(rel.targetEntityId);
  const targetColumnKey = currentLookup.resolveColumnKey(rel.targetEntityId, rel.targetColumnId);
  if (!sourceEntityKey || !sourceColumnKey || !targetEntityKey || !targetColumnKey) return false;
  return (
    partialEndpointStillValid(sourceEntityKey, sourceColumnKey, incomingByKey, incoming) &&
    partialEndpointStillValid(targetEntityKey, targetColumnKey, incomingByKey, incoming)
  );
}

function partialEndpointStillValid(
  entityKey: string,
  columnKey: string,
  incomingByKey: Map<string, Entity>,
  incoming: ERDSchema,
): boolean {
  const incomingEntity = incomingByKey.get(entityKey);
  if (!incomingEntity) return true;
  const incomingSchemaEntity = incoming.entities.find((entity) => normName(entity.name) === entityKey);
  return Boolean(incomingSchemaEntity?.columns.some((column) => normName(column.name) === columnKey));
}

function mergedNameSets(current: ERDSchema, incoming: ERDSchema): {
  entityNames: Set<string>;
  columnNamesByEntity: Map<string, Set<string>>;
} {
  const cur = buildIncomingNameSets(current);
  const inc = buildIncomingNameSets(incoming);
  const entityNames = new Set<string>([...cur.entityNames, ...inc.entityNames]);
  const columnNamesByEntity = new Map<string, Set<string>>();
  for (const k of entityNames) {
    const set = new Set<string>();
    cur.columnNamesByEntity.get(k)?.forEach((v) => set.add(v));
    inc.columnNamesByEntity.get(k)?.forEach((v) => set.add(v));
    columnNamesByEntity.set(k, set);
  }
  return { entityNames, columnNamesByEntity };
}

function rendererForRel(r: Relation): string {
  return `${r.sourceEntityId}.${r.sourceColumnId}->${r.targetEntityId}.${r.targetColumnId}`;
}

export function isAllUnchanged(diff: SchemaDiff): boolean {
  const s = diff.stats;
  return (
    s.entitiesAdded === 0 &&
    s.entitiesModified === 0 &&
    s.entitiesRemoved === 0 &&
    s.relationsAdded === 0 &&
    s.relationsRemoved === 0
  );
}
