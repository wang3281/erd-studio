import type { Cardinality, ERDSchema, Entity, EntityStatus, Relation } from "../model/types";

const HEADER_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ENTITY_STATUS_VALUES = new Set<EntityStatus>(["new", "existing", "modified", "deprecated"]);
const CARDINALITY_VALUES = new Set<Cardinality>(["1:1", "1:N", "N:1", "N:M"]);
const RELATION_SOURCE_VALUES = new Set<Relation["source"]>(["ddl", "manual", "inferred", "ai"]);

export interface ProjectMeta {
  name: string;
  updatedAt: string;
  version?: number;
}

export class StorageAuthError extends Error {
  constructor(message = "editor permission required") {
    super(message);
    this.name = "StorageAuthError";
  }
}

export class StorageConflictError extends Error {
  readonly currentUpdatedAt: string | null;

  constructor(currentUpdatedAt: string | null, message = "project was modified by another editor") {
    super(message);
    this.name = "StorageConflictError";
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

const projectVersions = new Map<string, string>();

function etagFor(updatedAt: string): string {
  return `"${updatedAt.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseETag(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : trimmed;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("erd-auth-fail"));
    }
  }
  return res;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const res = await request("/api/projects");
  if (!res.ok) throw new Error(`Failed to list projects (${res.status})`);
  const data = (await res.json().catch(() => null)) as { projects?: ProjectMeta[] } | null;
  const projects = Array.isArray(data?.projects) ? data.projects : [];
  for (const project of projects) {
    if (typeof project.updatedAt === "string") {
      projectVersions.set(
        project.name,
        project.version === undefined ? project.updatedAt : `${project.updatedAt}:${project.version}`,
      );
    }
  }
  return projects;
}

export async function loadProject(name: string): Promise<ERDSchema | null> {
  const res = await request(`/api/projects/${encodeURIComponent(name)}`);
  if (res.status === 404) {
    projectVersions.delete(name);
    return null;
  }
  if (!res.ok) throw new Error(`Failed to load project (${res.status})`);
  const data = (await res.json().catch(() => null)) as { schema?: ERDSchema; updatedAt?: string } | null;
  const schema = data?.schema;
  if (!schema) return null;
  const structureError = validateSchemaStructure(schema);
  if (structureError) throw new Error(`Invalid project schema: ${structureError}`);
  const sanitizedSchema = sanitizeSchema(schema);
  const updatedAt = parseETag(res.headers.get("ETag")) ?? data?.updatedAt;
  if (typeof updatedAt === "string") {
    projectVersions.set(sanitizedSchema.name, updatedAt);
  }
  return sanitizedSchema;
}

export async function saveProject(schema: ERDSchema): Promise<void> {
  const expectedUpdatedAt = projectVersions.get(schema.name);
  const headers = new Headers();
  if (expectedUpdatedAt) {
    headers.set("If-Match", etagFor(expectedUpdatedAt));
  } else {
    headers.set("If-None-Match", "*");
  }

  const res = await request(`/api/projects/${encodeURIComponent(schema.name)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ schema, expectedUpdatedAt }),
  });
  if (res.status === 401) throw new StorageAuthError();
  if (res.status === 409) {
    const data = (await res.json().catch(() => null)) as { currentUpdatedAt?: unknown } | null;
    const currentUpdatedAt = typeof data?.currentUpdatedAt === "string" ? data.currentUpdatedAt : null;
    throw new StorageConflictError(currentUpdatedAt);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to save project (${res.status}): ${text}`);
  }
  const data = (await res.json().catch(() => null)) as { updatedAt?: unknown } | null;
  const updatedAt = parseETag(res.headers.get("ETag")) ?? (typeof data?.updatedAt === "string" ? data.updatedAt : undefined);
  if (updatedAt) projectVersions.set(schema.name, updatedAt);
}

export async function deleteProject(name: string): Promise<void> {
  if (!projectVersions.has(name)) {
    const projects = await listProjects();
    if (!projects.some((project) => project.name === name)) return;
  }
  const expectedValidator = projectVersions.get(name);
  if (!expectedValidator) throw new Error("Project validator is unavailable");
  const headers = new Headers({ "If-Match": etagFor(expectedValidator) });
  const res = await request(`/api/projects/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers,
  });
  if (res.status === 401) throw new StorageAuthError();
  if (res.status === 404) {
    projectVersions.delete(name);
    return;
  }
  if (res.status === 409) {
    const data = (await res.json().catch(() => null)) as { currentUpdatedAt?: unknown } | null;
    throw new StorageConflictError(typeof data?.currentUpdatedAt === "string" ? data.currentUpdatedAt : null);
  }
  if (!res.ok) {
    throw new Error(`Failed to delete project (${res.status})`);
  }
  projectVersions.delete(name);
}

export function exportToJSON(schema: ERDSchema): string {
  return JSON.stringify(schema, null, 2);
}

export function importFromJSON(json: string): { schema: ERDSchema; error: string | null } {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { schema: parsed as ERDSchema, error: "Invalid schema structure" };
    }
    const version = (parsed as { version?: unknown }).version;
    if (version !== 1) return { schema: parsed as ERDSchema, error: "Unsupported schema version" };
    const structureError = validateSchemaStructure(parsed);
    if (structureError) return { schema: parsed as ERDSchema, error: structureError };
    const schema = parsed as ERDSchema;
    return {
      schema: sanitizeSchema(schema),
      error: null,
    };
  } catch {
    return { schema: null as unknown as ERDSchema, error: "Invalid JSON" };
  }
}

function validateSchemaStructure(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Invalid schema structure";
  const schema = value as Partial<ERDSchema>;
  if (typeof schema.name !== "string" || schema.name.length === 0 || !Array.isArray(schema.entities)) {
    return "Invalid schema structure";
  }
  if (schema.viewport !== undefined && (
    !Number.isFinite(schema.viewport.x) ||
    !Number.isFinite(schema.viewport.y) ||
    !Number.isFinite(schema.viewport.zoom) ||
    schema.viewport.zoom <= 0
  )) return "Invalid viewport geometry";

  const entityIds = new Set<string>();
  for (const valueEntity of schema.entities as unknown[]) {
    if (!valueEntity || typeof valueEntity !== "object") return "Invalid entity structure";
    const entity = valueEntity as Partial<Entity>;
    if (typeof entity.id !== "string" || typeof entity.name !== "string" || !Array.isArray(entity.columns)) {
      return "Invalid entity structure";
    }
    if (entityIds.has(entity.id)) return `Duplicate entity id: ${entity.id}`;
    entityIds.add(entity.id);
    if (!entity.position || !Number.isFinite(entity.position.x) || !Number.isFinite(entity.position.y) ||
        !Number.isFinite(entity.width) || !Number.isFinite(entity.height) || (entity.width ?? 0) <= 0 || (entity.height ?? 0) <= 0) {
      return `Invalid entity geometry: ${entity.name}`;
    }
    const columnIds = new Set<string>();
    for (const valueColumn of entity.columns as unknown[]) {
      if (!valueColumn || typeof valueColumn !== "object") return `Invalid column structure: ${entity.name}`;
      const column = valueColumn as { id?: unknown; name?: unknown; type?: unknown };
      if (typeof column.id !== "string" || typeof column.name !== "string" || typeof column.type !== "string") {
        return `Invalid column structure: ${entity.name}`;
      }
      if (columnIds.has(column.id)) return `Duplicate column id: ${column.id}`;
      columnIds.add(column.id);
    }
  }
  const relationIds = new Set<string>();
  if (Array.isArray(schema.relations)) {
    for (const relation of schema.relations) {
      if (!isRelation(relation)) continue;
      if (relationIds.has(relation.id)) return `Duplicate relation id: ${relation.id}`;
      relationIds.add(relation.id);
    }
  }
  return null;
}

function sanitizeSchema(schema: ERDSchema): ERDSchema {
  const entities = Array.isArray(schema.entities) ? schema.entities.map(sanitizeEntity) : [];
  const columnIdsByEntity = new Map(entities.map((entity) => [
    entity.id,
    new Set(entity.columns.map((column) => column.id)),
  ]));
  const relations = Array.isArray(schema.relations)
    ? schema.relations.filter((relation) => {
      if (!isRelation(relation)) return false;
      const sourceColumns = columnIdsByEntity.get(relation.sourceEntityId);
      const targetColumns = columnIdsByEntity.get(relation.targetEntityId);
      return sourceColumns?.has(relation.sourceColumnId) === true && targetColumns?.has(relation.targetColumnId) === true;
    })
    : [];

  return {
    ...schema,
    entities,
    relations,
    viewport: schema.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
}

function isRelation(value: unknown): value is Relation {
  if (!value || typeof value !== "object") return false;
  const relation = value as Partial<Relation>;
  return typeof relation.id === "string" &&
    typeof relation.sourceEntityId === "string" &&
    typeof relation.sourceColumnId === "string" &&
    typeof relation.targetEntityId === "string" &&
    typeof relation.targetColumnId === "string" &&
    CARDINALITY_VALUES.has(relation.cardinality as Cardinality) &&
    RELATION_SOURCE_VALUES.has(relation.source as Relation["source"]);
}

function sanitizeEntity(entity: Entity): Entity {
  return {
    ...entity,
    columns: Array.isArray(entity.columns) ? entity.columns.map((column) => ({
      ...column,
      isUnique: typeof column.isUnique === "boolean" ? column.isUnique : undefined,
      isAutoIncrement: typeof column.isAutoIncrement === "boolean" ? column.isAutoIncrement : undefined,
    })) : [],
    headerColor: typeof entity.headerColor === "string" && HEADER_COLOR_RE.test(entity.headerColor)
      ? entity.headerColor
      : undefined,
    status: isEntityStatus(entity.status) ? entity.status : undefined,
  };
}

function isEntityStatus(value: unknown): value is EntityStatus {
  return typeof value === "string" && ENTITY_STATUS_VALUES.has(value as EntityStatus);
}
