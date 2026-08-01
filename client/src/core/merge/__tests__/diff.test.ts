import { describe, it, expect } from "vitest";
import { diffSchema, isAllUnchanged } from "../diff";
import { createColumn, createEntity, createRelation, createSchema } from "../../model/factory";
import type { ERDSchema } from "../../model/types";

function schemaWithUsers(): ERDSchema {
  const idCol = createColumn({ name: "id", type: "BIGINT", nullable: false, isPrimaryKey: true });
  const emailCol = createColumn({ name: "email", type: "VARCHAR(255)", nullable: false, isUnique: true });
  const users = createEntity({ name: "users", columns: [idCol, emailCol] });
  const schema = createSchema({ name: "S" });
  schema.entities = [users];
  return schema;
}

describe("diffSchema", () => {
  it("identical schemas → all unchanged, isAllUnchanged true", () => {
    const a = schemaWithUsers();
    const b = schemaWithUsers();
    const diff = diffSchema(a, b);
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].kind).toBe("unchanged");
    expect(diff.stats.entitiesUnchanged).toBe(1);
    expect(diff.stats.entitiesAdded).toBe(0);
    expect(diff.stats.entitiesRemoved).toBe(0);
    expect(diff.stats.entitiesModified).toBe(0);
    expect(isAllUnchanged(diff)).toBe(true);
  });

  it("added column → entity modified with one column added", () => {
    const a = schemaWithUsers();
    const b = schemaWithUsers();
    b.entities[0].columns.push(
      createColumn({ name: "nickname", type: "VARCHAR(50)", nullable: true }),
    );
    const diff = diffSchema(a, b);
    const usersDiff = diff.entities[0];
    expect(usersDiff.kind).toBe("modified");
    const added = usersDiff.columns.filter((c) => c.kind === "added");
    expect(added).toHaveLength(1);
    expect(added[0].incoming?.name).toBe("nickname");
    expect(diff.stats.entitiesModified).toBe(1);
    expect(isAllUnchanged(diff)).toBe(false);
  });

  it("dropped column → entity modified with one removed", () => {
    const a = schemaWithUsers();
    const b = schemaWithUsers();
    b.entities[0].columns = b.entities[0].columns.slice(0, 1); // keep only id
    const diff = diffSchema(a, b);
    expect(diff.entities[0].kind).toBe("modified");
    expect(diff.entities[0].columns.filter((c) => c.kind === "removed")).toHaveLength(1);
  });

  it("type change → modified with changedFields=['type']", () => {
    const a = schemaWithUsers();
    const b = schemaWithUsers();
    b.entities[0].columns[1].type = "TEXT";
    const diff = diffSchema(a, b);
    const colDiffs = diff.entities[0].columns;
    const modified = colDiffs.find((c) => c.kind === "modified");
    expect(modified).toBeDefined();
    expect(modified!.changedFields).toContain("type");
  });

  it("table dropped from incoming → kind=removed", () => {
    const a = schemaWithUsers();
    const b = schemaWithUsers();
    b.entities = []; // dropped
    const diff = diffSchema(a, b);
    expect(diff.stats.entitiesRemoved).toBe(1);
    expect(diff.entities[0].kind).toBe("removed");
    expect(diff.mode).toBe("full");
  });

  it("partial mode does not classify absent current tables as removed", () => {
    const current = schemaWithUsers();
    const incoming = schemaWithUsers();
    incoming.entities = [];
    const diff = diffSchema(current, incoming, { mode: "partial" });

    expect(diff.mode).toBe("partial");
    expect(diff.stats.entitiesRemoved).toBe(0);
    expect(diff.entities).toHaveLength(0);
  });

  it("new table in incoming → kind=added", () => {
    const a = schemaWithUsers();
    const b = schemaWithUsers();
    b.entities.push(
      createEntity({
        name: "orders",
        columns: [createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false })],
      }),
    );
    const diff = diffSchema(a, b);
    expect(diff.stats.entitiesAdded).toBe(1);
    const ordersDiff = diff.entities.find((e) => e.displayName === "orders");
    expect(ordersDiff?.kind).toBe("added");
  });

  it("case-insensitive entity matching", () => {
    const a = schemaWithUsers();
    const b = schemaWithUsers();
    b.entities[0].name = "USERS"; // case-only change
    const diff = diffSchema(a, b);
    expect(diff.entities).toHaveLength(1);
    expect(diff.entities[0].kind).toBe("modified");
  });

  it("duplicate table in incoming emits warning and uses first", () => {
    const a = schemaWithUsers();
    const b = schemaWithUsers();
    b.entities.push(
      createEntity({
        name: "users",
        columns: [createColumn({ name: "id", type: "INT", isPrimaryKey: true, nullable: false })],
      }),
    );
    const diff = diffSchema(a, b);
    expect(diff.warnings.some((w) => w.includes("Duplicate table"))).toBe(true);
  });

  it("ddl relation removed when incoming drops the FK", () => {
    const a = createSchema({ name: "S" });
    const userId = createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false });
    const users = createEntity({ name: "users", columns: [userId] });
    const orderId = createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false });
    const orderUserId = createColumn({ name: "user_id", type: "BIGINT", isForeignKey: true, nullable: false });
    const orders = createEntity({ name: "orders", columns: [orderId, orderUserId] });
    a.entities = [users, orders];
    a.relations = [
      createRelation({
        sourceEntityId: orders.id,
        sourceColumnId: orderUserId.id,
        targetEntityId: users.id,
        targetColumnId: userId.id,
        cardinality: "N:1",
        source: "ddl",
      }),
    ];
    // incoming has same tables but no FK at all
    const userId2 = createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false });
    const users2 = createEntity({ name: "users", columns: [userId2] });
    const orderId2 = createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false });
    const orderUserId2 = createColumn({ name: "user_id", type: "BIGINT", isForeignKey: false, nullable: false });
    const orders2 = createEntity({ name: "orders", columns: [orderId2, orderUserId2] });
    const b = createSchema({ name: "S" });
    b.entities = [users2, orders2];
    const diff = diffSchema(a, b);
    expect(diff.stats.relationsRemoved).toBe(1);
  });

  it("ignores manual relation in current when computing diff", () => {
    const a = schemaWithUsers();
    a.relations = []; // not actually used here, just sanity
    const b = schemaWithUsers();
    const diff = diffSchema(a, b);
    expect(diff.relations).toHaveLength(0);
  });
});

describe("isAutoIncrement diff", () => {
  it("isAutoIncrement 변경을 modified로 감지한다", () => {
    const a = createSchema({ name: "S" });
    a.entities = [createEntity({ name: "t", columns: [createColumn({ name: "id", type: "INT" })] })];
    const b = createSchema({ name: "S" });
    b.entities = [createEntity({ name: "t", columns: [createColumn({ name: "id", type: "INT", isAutoIncrement: true })] })];

    const diff = diffSchema(a, b);
    const colDiff = diff.entities[0].columns[0];
    expect(colDiff.kind).toBe("modified");
    expect(colDiff.changedFields).toContain("isAutoIncrement");
  });
});
