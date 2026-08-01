import { describe, it, expect, vi, beforeAll } from "vitest";
import MARKETPLACE_BASE from "../../../../../examples/marketplace-platform.sql?raw";
import MARKETPLACE_INCREMENTAL from "../../../../../examples/marketplace-incremental.sql?raw";
import { parseDDL } from "../../parser/index";
import { diffSchema } from "../diff";
import { applyDiff } from "../apply";
import { materializeAltersToIncoming, prepareSmartMergeInput } from "../index";
import type { ERDSchema } from "../../model/types";
import { createRelation } from "../../model/factory";

beforeAll(() => {
  const mockCtx = {
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  const mockCanvas = {
    width: 1,
    height: 1,
    getContext: () => mockCtx,
  };
  vi.stubGlobal("document", {
    createElement: () => mockCanvas,
  });
});

const DDL_V1 = `
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);
`;

const DDL_V2_ADD_COLUMN = `
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  nickname VARCHAR(50),
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);
`;

const DDL_V3_DROP_TABLE = `
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  nickname VARCHAR(50),
  created_at TIMESTAMP NOT NULL
);
`;

function parseAsCurrent(ddl: string): ERDSchema {
  const r = parseDDL(ddl);
  expect(r.errors).toHaveLength(0);
  return r.schema;
}

describe("Smart Merge end-to-end (parse → diff → apply)", () => {
  it("v1 → v2 (add column) preserves existing entity ids/positions and adds the new column", () => {
    const v1 = parseAsCurrent(DDL_V1);
    // Simulate user-edited canvas state: pin positions and headerColor.
    v1.entities = v1.entities.map((e, i) => ({
      ...e,
      position: { x: 100 + i * 400, y: 100 },
      headerColor: i === 0 ? "#abcdef" : undefined,
      status: "existing" as const,
    }));
    const v2 = parseAsCurrent(DDL_V2_ADD_COLUMN);
    const diff = diffSchema(v1, v2);
    expect(diff.stats.entitiesModified).toBe(1);
    expect(diff.stats.entitiesAdded).toBe(0);
    expect(diff.stats.entitiesRemoved).toBe(0);
    const result = applyDiff(v1, v2, diff);

    const users = result.schema.entities.find((e) => e.name === "users")!;
    const oldUsers = v1.entities.find((e) => e.name === "users")!;
    expect(users.id).toBe(oldUsers.id);
    expect(users.position).toEqual({ x: 100, y: 100 });
    expect(users.headerColor).toBe("#abcdef");
    expect(users.status).toBe("modified");
    // nickname column added.
    expect(users.columns.find((c) => c.name === "nickname")).toBeDefined();
    // FK relation to users.id remains.
    expect(result.schema.relations.find((r) => r.source === "ddl")).toBeDefined();
  });

  it("v2 → v3 (drop orders) marks orders deprecated by default", () => {
    const v2 = parseAsCurrent(DDL_V2_ADD_COLUMN);
    v2.entities = v2.entities.map((e, i) => ({
      ...e,
      position: { x: 100 + i * 400, y: 100 },
      status: "existing" as const,
    }));
    const v3 = parseAsCurrent(DDL_V3_DROP_TABLE);
    const diff = diffSchema(v2, v3);
    expect(diff.stats.entitiesRemoved).toBe(1);
    // Removed ddl FK.
    expect(diff.stats.relationsRemoved).toBe(1);
    const result = applyDiff(v2, v3, diff);
    const orders = result.schema.entities.find((e) => e.name === "orders");
    expect(orders).toBeDefined();
    expect(orders!.status).toBe("deprecated");
    // Position preserved.
    expect(orders!.position).toEqual({ x: 500, y: 100 });
    // FK to a now-deprecated entity should be dropped (its ddl-source diff removed it).
    expect(result.schema.relations.filter((r) => r.source === "ddl")).toHaveLength(0);
  });

  it("v2 → v3 with hard-delete opt-in actually removes orders and cascades the relation", () => {
    const v2 = parseAsCurrent(DDL_V2_ADD_COLUMN);
    const ordersId = v2.entities.find((e) => e.name === "orders")!.id;
    const v3 = parseAsCurrent(DDL_V3_DROP_TABLE);
    const diff = diffSchema(v2, v3);
    const result = applyDiff(v2, v3, diff, { removeEntityIds: [ordersId] });
    expect(result.schema.entities.find((e) => e.name === "orders")).toBeUndefined();
    expect(result.removedEntityIds).toContain(ordersId);
    expect(result.schema.relations).toHaveLength(0);
  });

  it("identical DDL re-import is detected as zero-change", () => {
    const v1 = parseAsCurrent(DDL_V1);
    const v1again = parseAsCurrent(DDL_V1);
    const diff = diffSchema(v1, v1again);
    expect(diff.stats.entitiesAdded).toBe(0);
    expect(diff.stats.entitiesModified).toBe(0);
    expect(diff.stats.entitiesRemoved).toBe(0);
    expect(diff.stats.relationsAdded).toBe(0);
    expect(diff.stats.relationsRemoved).toBe(0);
  });

  it("ALTER-only import modifies the touched table without removing unrelated tables", () => {
    const current = parseAsCurrent(DDL_V1);
    const parsed = parseDDL("ALTER TABLE users ADD COLUMN nickname VARCHAR(50);");
    const materialized = materializeAltersToIncoming(current, parsed.schema, parsed.alters);
    const diff = diffSchema(current, materialized.incoming, {
      mode: "partial",
      touchedEntityKeys: materialized.touchedEntityKeys,
    });
    const result = applyDiff(current, materialized.incoming, diff);

    expect(parsed.schema.entities).toHaveLength(0);
    expect(diff.stats.entitiesModified).toBe(1);
    expect(diff.stats.entitiesRemoved).toBe(0);
    expect(result.schema.entities.find((e) => e.name === "orders")).toBeDefined();
    expect(result.schema.entities.find((e) => e.name === "users")?.columns.some((c) => c.name === "nickname")).toBe(true);
  });

  it("CREATE plus ALTER applies both changes and preserves unrelated canvas tables", () => {
    const current = parseAsCurrent(DDL_V1);
    const parsed = parseDDL(`
      CREATE TABLE invoices (id BIGINT PRIMARY KEY);
      ALTER TABLE users ADD COLUMN nickname VARCHAR(50);
    `);
    const materialized = materializeAltersToIncoming(current, parsed.schema, parsed.alters);
    const diff = diffSchema(current, materialized.incoming, {
      mode: "partial",
      touchedEntityKeys: materialized.touchedEntityKeys,
    });
    const result = applyDiff(current, materialized.incoming, diff);

    expect(diff.stats.entitiesAdded).toBe(1);
    expect(diff.stats.entitiesModified).toBe(1);
    expect(diff.stats.entitiesRemoved).toBe(0);
    expect(result.schema.entities.find((e) => e.name === "orders")).toBeDefined();
    expect(result.schema.entities.find((e) => e.name === "invoices")).toBeDefined();
  });

  it("ALTER for an unknown table warns and leaves the canvas unchanged", () => {
    const current = parseAsCurrent(DDL_V1);
    const parsed = parseDDL("ALTER TABLE missing ADD COLUMN nickname VARCHAR(50);");
    const materialized = materializeAltersToIncoming(current, parsed.schema, parsed.alters);
    const diff = diffSchema(current, materialized.incoming, {
      mode: "partial",
      touchedEntityKeys: materialized.touchedEntityKeys,
    });

    expect(materialized.warnings).toEqual([
      "ALTER TABLE missing: table not found in canvas or import - skipped.",
    ]);
    expect(diff.stats.entitiesAdded).toBe(0);
    expect(diff.stats.entitiesModified).toBe(0);
    expect(diff.stats.entitiesRemoved).toBe(0);
  });

  it("incremental CREATE statements keep foreign keys that target existing canvas tables", () => {
    const current = parseAsCurrent(`
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE organizations (id BIGINT PRIMARY KEY);
    `);
    const originalIds = new Map(current.entities.map((entity) => [entity.name, entity.id]));
    const parsed = parseDDL(`
      CREATE TABLE invoices (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        organization_id BIGINT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (organization_id) REFERENCES organizations(id)
      );
      CREATE TABLE invoice_items (
        id BIGINT PRIMARY KEY,
        invoice_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        organization_id BIGINT NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (organization_id) REFERENCES organizations(id)
      );
    `);

    const prepared = prepareSmartMergeInput(current, parsed);
    const diff = diffSchema(current, prepared.incoming, {
      mode: "partial",
      touchedEntityKeys: prepared.touchedEntityKeys,
    });
    const result = applyDiff(current, prepared.incoming, diff);

    expect(prepared.warnings).toEqual([]);
    expect(diff.stats.entitiesAdded).toBe(2);
    expect(diff.stats.entitiesRemoved).toBe(0);
    expect(diff.stats.relationsAdded).toBe(5);
    expect(diff.stats.relationsRemoved).toBe(0);
    expect(result.schema.entities).toHaveLength(4);
    expect(result.schema.relations.filter((relation) => relation.source === "ddl")).toHaveLength(5);
    expect(result.schema.entities.find((entity) => entity.name === "users")?.id).toBe(originalIds.get("users"));
    expect(result.schema.entities.find((entity) => entity.name === "organizations")?.id).toBe(originalIds.get("organizations"));
  });

  it("ALTER-only foreign keys resolve against the existing canvas", () => {
    const current = parseAsCurrent(`
      CREATE TABLE users (id BIGINT PRIMARY KEY);
      CREATE TABLE orders (
        id BIGINT PRIMARY KEY,
        user_id BIGINT NOT NULL
      );
    `);
    const parsed = parseDDL(`
      ALTER TABLE orders
      ADD CONSTRAINT fk_orders_user
      FOREIGN KEY (user_id) REFERENCES users(id);
    `);

    const prepared = prepareSmartMergeInput(current, parsed);
    const diff = diffSchema(current, prepared.incoming, {
      mode: "partial",
      touchedEntityKeys: prepared.touchedEntityKeys,
    });
    const result = applyDiff(current, prepared.incoming, diff);

    expect(prepared.warnings).toEqual([]);
    expect(diff.stats.entitiesAdded).toBe(0);
    expect(diff.stats.entitiesRemoved).toBe(0);
    expect(diff.stats.relationsAdded).toBe(1);
    expect(result.schema.relations).toHaveLength(1);
    expect(result.schema.relations[0].name).toBe("fk_orders_user");
  });

  it("merges the public 26-table marketplace fixture into 28 tables and 52 DDL foreign keys without data loss", () => {
    const baseParsed = parseDDL(MARKETPLACE_BASE);
    expect(baseParsed.errors).toEqual([]);
    expect(baseParsed.warnings).toEqual([]);
    expect(baseParsed.schema.entities).toHaveLength(26);
    expect(baseParsed.schema.entities.reduce((sum, entity) => sum + entity.columns.length, 0)).toBe(242);
    expect(baseParsed.schema.relations).toHaveLength(47);

    const current = baseParsed.schema;
    current.entities = current.entities.map((entity, index) => ({
      ...entity,
      position: { x: 100 + (index % 6) * 360, y: 100 + Math.floor(index / 6) * 360 },
    }));
    const originalOrganizations = current.entities.find((entity) => entity.name === "organizations")!;
    const originalPosition = { ...originalOrganizations.position };
    const users = current.entities.find((entity) => entity.name === "users")!;
    const manualRelation = createRelation({
      sourceEntityId: originalOrganizations.id,
      sourceColumnId: originalOrganizations.columns.find((column) => column.name === "slug")!.id,
      targetEntityId: users.id,
      targetColumnId: users.columns.find((column) => column.name === "email")!.id,
      cardinality: "N:M",
      source: "manual",
    });
    current.relations.push(manualRelation);

    const incrementalParsed = parseDDL(MARKETPLACE_INCREMENTAL);
    expect(incrementalParsed.errors).toEqual([]);
    expect(incrementalParsed.schema.entities).toHaveLength(2);
    expect(incrementalParsed.foreignKeys).toHaveLength(5);

    const prepared = prepareSmartMergeInput(current, incrementalParsed);
    const diff = diffSchema(current, prepared.incoming, {
      mode: "partial",
      touchedEntityKeys: prepared.touchedEntityKeys,
    });
    const result = applyDiff(current, prepared.incoming, diff);

    expect(prepared.warnings).toEqual([]);
    expect(diff.stats.entitiesAdded).toBe(2);
    expect(diff.stats.entitiesRemoved).toBe(0);
    expect(diff.stats.relationsAdded).toBe(5);
    expect(diff.stats.relationsRemoved).toBe(0);
    expect(result.schema.entities).toHaveLength(28);
    expect(result.schema.relations.filter((relation) => relation.source === "ddl")).toHaveLength(52);
    expect(result.schema.relations.some((relation) => relation.id === manualRelation.id)).toBe(true);
    expect(result.schema.entities.find((entity) => entity.name === "organizations")?.id).toBe(originalOrganizations.id);
    expect(result.schema.entities.find((entity) => entity.name === "organizations")?.position).toEqual(originalPosition);
  });
});
