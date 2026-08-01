import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  exportToJSON,
  importFromJSON,
  StorageConflictError,
} from "../index";
import { createColumn, createEntity, createRelation, createSchema } from "../../model/factory";
import type { ERDSchema } from "../../model/types";

const store: Record<string, string> = {};
let projects: Map<string, { schema: ERDSchema; updatedAt: string; version: number }>;
let clock: number;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function nextUpdatedAt(): string {
  clock += 1;
  return `t${clock}`;
}

function validatorFor(updatedAt: string, version: number): string {
  return `${updatedAt}:${version}`;
}

function parseExpectedUpdatedAt(init?: RequestInit): string | undefined {
  const headers = new Headers(init?.headers);
  const ifMatch = headers.get("If-Match");
  if (!ifMatch) return undefined;
  return ifMatch.startsWith('"') && ifMatch.endsWith('"') ? ifMatch.slice(1, -1) : ifMatch;
}

function isCreateOnly(init?: RequestInit): boolean {
  return new Headers(init?.headers).get("If-None-Match") === "*";
}

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k]);
  projects = new Map();
  clock = 0;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/projects" && (init?.method ?? "GET") === "GET") {
      return jsonResponse({
        projects: Array.from(projects.values()).map(({ schema, updatedAt, version }) => ({
          name: schema.name,
          updatedAt,
          version,
        })),
      });
    }

    const match = path.match(/^\/api\/projects\/(.+)$/);
    if (!match) return jsonResponse({ ok: false, error: "not found" }, 404);
    const name = decodeURIComponent(match[1]);
    const method = init?.method ?? "GET";

    if (method === "GET") {
      const project = projects.get(name);
      if (!project) return jsonResponse({ ok: false, error: "not found" }, 404);
      return jsonResponse(
        { schema: project.schema, updatedAt: project.updatedAt, version: project.version },
        200,
        { ETag: `"${validatorFor(project.updatedAt, project.version)}"` },
      );
    }

    if (method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { schema?: ERDSchema; expectedUpdatedAt?: string };
      const schema = body.schema;
      if (!schema) return jsonResponse({ ok: false, error: "schema required" }, 400);
      const expectedValidator = parseExpectedUpdatedAt(init) ?? body.expectedUpdatedAt;
      const current = projects.get(name);
      const currentValidator = current ? validatorFor(current.updatedAt, current.version) : undefined;
      if (isCreateOnly(init) && current) {
        return jsonResponse({
          ok: false,
          error: "project already exists",
          currentUpdatedAt: current.updatedAt,
          currentVersion: current.version,
        }, 409);
      }
      if (expectedValidator !== undefined && currentValidator !== expectedValidator) {
        return jsonResponse({
          ok: false,
          error: "project was modified by another editor",
          currentUpdatedAt: current?.updatedAt ?? null,
          currentVersion: current?.version ?? null,
        }, 409);
      }
      const updatedAt = nextUpdatedAt();
      const version = (current?.version ?? 0) + 1;
      projects.set(name, { schema, updatedAt, version });
      return jsonResponse({ ok: true, updatedAt, version }, 200, { ETag: `"${validatorFor(updatedAt, version)}"` });
    }

    if (method === "DELETE") {
      const current = projects.get(name);
      if (!current) return jsonResponse({ ok: false, error: "not found" }, 404);
      const expectedValidator = parseExpectedUpdatedAt(init);
      if (expectedValidator !== "*" && expectedValidator !== validatorFor(current.updatedAt, current.version)) {
        return jsonResponse({
          ok: false,
          error: "project was modified by another editor",
          currentUpdatedAt: current.updatedAt,
          currentVersion: current.version,
        }, 409);
      }
      projects.delete(name);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, error: "unsupported" }, 405);
  }));
});

describe("storage", () => {
  it("save + load", async () => {
    const schema = createSchema({ name: "test" });
    await saveProject(schema);
    const loaded = await loadProject(schema.name);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("test");
  });

  it("does not overwrite an existing project that was not loaded into this session", async () => {
    const existing = createSchema({ name: "existing-unloaded" });
    projects.set(existing.name, { schema: existing, updatedAt: "external", version: 1 });

    const replacement = { ...existing, viewport: { x: 999, y: 0, zoom: 1 } };
    await expect(saveProject(replacement)).rejects.toBeInstanceOf(StorageConflictError);
    expect(projects.get(existing.name)?.schema.viewport.x).toBe(0);
  });

  it("listProjects", async () => {
    await saveProject(createSchema({ name: "p1" }));
    await saveProject(createSchema({ name: "p2" }));
    const list = await listProjects();
    expect(list).toHaveLength(2);
  });

  it("deleteProject", async () => {
    const schema = createSchema({ name: "del" });
    await saveProject(schema);
    await deleteProject("del");
    await expect(loadProject("del")).resolves.toBeNull();
  });

  it("loads an exact list validator before deleting an uncached project", async () => {
    const schema = createSchema({ name: "uncached-delete" });
    projects.set(schema.name, { schema, updatedAt: "listed", version: 4 });

    await deleteProject(schema.name);

    expect(projects.has(schema.name)).toBe(false);
  });

  it("does not delete a project changed after its list validator was cached", async () => {
    const schema = createSchema({ name: "delete-race" });
    projects.set(schema.name, { schema, updatedAt: "listed", version: 1 });
    await listProjects();
    projects.set(schema.name, {
      schema: { ...schema, viewport: { x: 200, y: 0, zoom: 1 } },
      updatedAt: "newer",
      version: 2,
    });

    await expect(deleteProject(schema.name)).rejects.toBeInstanceOf(StorageConflictError);
    expect(projects.has(schema.name)).toBe(true);
  });

  it("deleteProject clears cached validator so the same name can be recreated", async () => {
    const schema = createSchema({ name: "recreate" });
    await saveProject(schema);
    await loadProject(schema.name);
    await deleteProject(schema.name);

    await expect(saveProject(schema)).resolves.toBeUndefined();
    expect(projects.get(schema.name)?.version).toBe(1);
  });

  it("deleteProject clears cached validator when the server already deleted the project", async () => {
    const schema = createSchema({ name: "recreate-404" });
    await saveProject(schema);
    await loadProject(schema.name);
    projects.delete(schema.name);

    await deleteProject(schema.name);

    await expect(saveProject(schema)).resolves.toBeUndefined();
    expect(projects.get(schema.name)?.version).toBe(1);
  });

  it("loadProject clears cached validator when the server no longer has the project", async () => {
    const schema = createSchema({ name: "load-404-recreate" });
    await saveProject(schema);
    await loadProject(schema.name);
    projects.delete(schema.name);

    await expect(loadProject(schema.name)).resolves.toBeNull();

    await expect(saveProject(schema)).resolves.toBeUndefined();
    expect(projects.get(schema.name)?.version).toBe(1);
  });

  it("uses loaded updatedAt as If-Match and rejects stale saves", async () => {
    const schema = createSchema({ name: "conflict" });
    await saveProject(schema);
    const loaded = await loadProject(schema.name);
    expect(loaded).not.toBeNull();

    projects.set(schema.name, { schema: { ...schema, viewport: { x: 100, y: 0, zoom: 1 } }, updatedAt: "external", version: 2 });

    await expect(saveProject({ ...loaded!, viewport: { x: 1, y: 2, zoom: 1 } })).rejects.toBeInstanceOf(StorageConflictError);
    expect(projects.get(schema.name)?.schema.viewport.x).toBe(100);

    await expect(saveProject({ ...loaded!, viewport: { x: 2, y: 2, zoom: 1 } })).rejects.toBeInstanceOf(StorageConflictError);
    expect(projects.get(schema.name)?.schema.viewport.x).toBe(100);
  });

  it("exportToJSON + importFromJSON", () => {
    const schema = createSchema({ name: "exp" });
    const json = exportToJSON(schema);
    const result = importFromJSON(json);
    expect(result.schema.name).toBe("exp");
    expect(result.error).toBeNull();
  });

  it("importFromJSON drops relations with missing entity or column endpoints", () => {
    const sourceColumn = createColumn({ name: "source_id", type: "INT" });
    const targetColumn = createColumn({ name: "target_id", type: "INT" });
    const source = createEntity({ name: "source", columns: [sourceColumn] });
    const target = createEntity({ name: "target", columns: [targetColumn] });
    const schema = createSchema({ name: "relations" });
    schema.entities = [source, target];
    schema.relations = [
      createRelation({
        sourceEntityId: source.id,
        sourceColumnId: sourceColumn.id,
        targetEntityId: target.id,
        targetColumnId: targetColumn.id,
        cardinality: "N:1",
      }),
      createRelation({
        sourceEntityId: source.id,
        sourceColumnId: "missing-column",
        targetEntityId: "missing-entity",
        targetColumnId: targetColumn.id,
        cardinality: "N:1",
      }),
    ];

    const result = importFromJSON(JSON.stringify(schema));

    expect(result.error).toBeNull();
    expect(result.schema.relations).toHaveLength(1);
    expect(result.schema.relations[0].id).toBe(schema.relations[0].id);
  });

  it("importFromJSON - invalid", () => {
    const result = importFromJSON("not json");
    expect(result.error).not.toBeNull();
  });

  it("rejects duplicate schema identities and malformed entity geometry", () => {
    const first = createEntity({ name: "first", columns: [createColumn({ name: "id", type: "INT" })] });
    const duplicateEntity = createEntity({ name: "second" });
    duplicateEntity.id = first.id;
    const duplicateColumn = createColumn({ name: "other", type: "INT" });
    duplicateColumn.id = first.columns[0].id;

    const duplicateEntities = createSchema({ name: "duplicate-entities" });
    duplicateEntities.entities = [first, duplicateEntity];
    const duplicateColumns = createSchema({ name: "duplicate-columns" });
    duplicateColumns.entities = [{ ...first, columns: [first.columns[0], duplicateColumn] }];
    const malformedGeometry = createSchema({ name: "bad-geometry" });
    malformedGeometry.entities = [{ ...first, width: -1 }];

    expect(importFromJSON(JSON.stringify(duplicateEntities)).error).toMatch(/duplicate entity id/i);
    expect(importFromJSON(JSON.stringify(duplicateColumns)).error).toMatch(/duplicate column id/i);
    expect(importFromJSON(JSON.stringify(malformedGeometry)).error).toMatch(/geometry/i);
  });

  it("rejects duplicate relation identities", () => {
    const source = createEntity({ name: "source", columns: [createColumn({ name: "target_id", type: "INT" })] });
    const target = createEntity({ name: "target", columns: [createColumn({ name: "id", type: "INT" })] });
    const relation = createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[0].id,
      targetEntityId: target.id,
      targetColumnId: target.columns[0].id,
      cardinality: "N:1",
    });
    const schema = createSchema({ name: "duplicate-relations" });
    schema.entities = [source, target];
    schema.relations = [relation, { ...relation }];

    expect(importFromJSON(JSON.stringify(schema)).error).toMatch(/duplicate relation id/i);
  });

  it("importFromJSON - wrong version", () => {
    const result = importFromJSON(JSON.stringify({ version: 999 }));
    expect(result.error).not.toBeNull();
  });

  it("drops malformed headerColor and unknown status", () => {
    const schema = createSchema({ name: "sanitize" });
    schema.entities = [
      {
        id: "entity-1",
        name: "orders",
        columns: [],
        position: { x: 0, y: 0 },
        width: 220,
        height: 40,
        headerColor: "javascript:alert(1)",
        status: "ghost" as never,
      },
    ];

    const result = importFromJSON(JSON.stringify(schema));

    expect(result.error).toBeNull();
    expect(result.schema.entities[0].headerColor).toBeUndefined();
    expect(result.schema.entities[0].status).toBeUndefined();
  });

  it("preserves valid headerColor and status", () => {
    const schema = createSchema({ name: "valid" });
    schema.entities = [
      {
        id: "entity-1",
        name: "orders",
        columns: [],
        position: { x: 0, y: 0 },
        width: 220,
        height: 40,
        headerColor: "#22DD88",
        status: "new",
      },
    ];

    const result = importFromJSON(JSON.stringify(schema));

    expect(result.error).toBeNull();
    expect(result.schema.entities[0].headerColor).toBe("#22DD88");
    expect(result.schema.entities[0].status).toBe("new");
  });

  it("legacy schema without optional entity fields loads unchanged", () => {
    const legacy = {
      version: 1,
      name: "legacy",
      entities: [
        {
          id: "entity-1",
          name: "orders",
          columns: [],
          position: { x: 0, y: 0 },
          width: 220,
          height: 40,
        },
      ],
      relations: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const result = importFromJSON(JSON.stringify(legacy));

    expect(result.error).toBeNull();
    expect(result.schema.entities[0].name).toBe("orders");
    expect(result.schema.entities[0].headerColor).toBeUndefined();
    expect(result.schema.entities[0].status).toBeUndefined();
  });

  it("preserves boolean isUnique across save and load", async () => {
    const schema = createSchema({ name: "unique" });
    schema.entities = [
      createEntity({
        name: "users",
        columns: [createColumn({ name: "email", type: "VARCHAR(255)", isUnique: true })],
      }),
    ];

    await saveProject(schema);
    const loaded = await loadProject("unique");

    expect(loaded?.entities[0].columns[0].isUnique).toBe(true);
  });

  it("drops malformed column isUnique values on import", () => {
    const schema = createSchema({ name: "bad-unique" });
    schema.entities = [
      {
        id: "entity-1",
        name: "users",
        columns: [
          {
            id: "col-1",
            name: "email",
            type: "VARCHAR(255)",
            nullable: true,
            isPrimaryKey: false,
            isForeignKey: false,
            isUnique: "yes" as never,
          },
        ],
        position: { x: 0, y: 0 },
        width: 220,
        height: 68,
      },
    ];

    const result = importFromJSON(JSON.stringify(schema));

    expect(result.error).toBeNull();
    expect(result.schema.entities[0].columns[0].isUnique).toBeUndefined();
  });

  it("legacy schema without isUnique loads columns unchanged", () => {
    const legacy = {
      version: 1,
      name: "legacy-columns",
      entities: [
        {
          id: "entity-1",
          name: "users",
          columns: [
            {
              id: "col-1",
              name: "email",
              type: "VARCHAR(255)",
              nullable: true,
              isPrimaryKey: false,
              isForeignKey: false,
            },
          ],
          position: { x: 0, y: 0 },
          width: 220,
          height: 68,
        },
      ],
      relations: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const result = importFromJSON(JSON.stringify(legacy));

    expect(result.error).toBeNull();
    expect(result.schema.entities[0].columns[0].isUnique).toBeUndefined();
  });
});
