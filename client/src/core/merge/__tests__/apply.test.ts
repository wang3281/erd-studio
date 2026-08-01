import { describe, it, expect, vi, beforeAll } from "vitest";
import { applyDiff } from "../apply";
import { diffSchema } from "../diff";
import { materializeAltersToIncoming } from "../index";
import { createColumn, createEntity, createRelation, createSchema } from "../../model/factory";
import type { AlterDirective, ERDSchema } from "../../model/types";

// recalcEntityDimensions reaches into document.createElement("canvas"); stub it
// in the same way other unit tests in this repo do (see canvas/__tests__/measure.test.ts).
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

function buildCurrent(): ERDSchema {
  const userId = createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false });
  const userEmail = createColumn({ name: "email", type: "VARCHAR(255)", nullable: false });
  const users = createEntity({
    name: "users",
    columns: [userId, userEmail],
    position: { x: 200, y: 150 },
    headerColor: "#bada55",
  });
  users.comment = "user accounts";
  const orderId = createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false });
  const orderUserId = createColumn({ name: "user_id", type: "BIGINT", isForeignKey: true, nullable: false });
  const orders = createEntity({
    name: "orders",
    columns: [orderId, orderUserId],
    position: { x: 600, y: 150 },
  });
  const schema = createSchema({ name: "S" });
  schema.entities = [users, orders];
  schema.relations = [
    createRelation({
      sourceEntityId: orders.id,
      sourceColumnId: orderUserId.id,
      targetEntityId: users.id,
      targetColumnId: userId.id,
      cardinality: "N:1",
      source: "ddl",
    }),
  ];
  return schema;
}

function buildIncomingSameAsCurrent(): ERDSchema {
  // Mimic what parseDDL would emit: same tables/columns but with fresh ids.
  const userId = createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false });
  const userEmail = createColumn({ name: "email", type: "VARCHAR(255)", nullable: false });
  const users = createEntity({ name: "users", columns: [userId, userEmail] });
  const orderId = createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false });
  const orderUserId = createColumn({ name: "user_id", type: "BIGINT", isForeignKey: true, nullable: false });
  const orders = createEntity({ name: "orders", columns: [orderId, orderUserId] });
  const schema = createSchema({ name: "S" });
  schema.entities = [users, orders];
  schema.relations = [
    createRelation({
      sourceEntityId: orders.id,
      sourceColumnId: orderUserId.id,
      targetEntityId: users.id,
      targetColumnId: userId.id,
      cardinality: "N:1",
      source: "ddl",
    }),
  ];
  return schema;
}

describe("applyDiff", () => {
  it("preserves position, headerColor, comment, and entity id when DDL re-imported unchanged", () => {
    const current = buildCurrent();
    const incoming = buildIncomingSameAsCurrent();
    const diff = diffSchema(current, incoming);
    const result = applyDiff(current, incoming, diff);
    const users = result.schema.entities.find((e) => e.name === "users")!;
    const oldUsers = current.entities.find((e) => e.name === "users")!;
    expect(users.id).toBe(oldUsers.id);
    expect(users.position).toEqual({ x: 200, y: 150 });
    expect(users.headerColor).toBe("#bada55");
    expect(users.comment).toBe("user accounts");
    // Column ids preserved.
    expect(users.columns[0].id).toBe(oldUsers.columns[0].id);
    // ddl relation rebound to the existing user/order ids.
    expect(result.schema.relations).toHaveLength(1);
    expect(result.schema.relations[0].source).toBe("ddl");
    expect(result.schema.relations[0].targetEntityId).toBe(oldUsers.id);
  });

  it("marks entity as deprecated when incoming DDL drops it", () => {
    const current = buildCurrent();
    const incoming = buildIncomingSameAsCurrent();
    incoming.entities = incoming.entities.filter((e) => e.name !== "orders");
    incoming.relations = [];
    const diff = diffSchema(current, incoming);
    const result = applyDiff(current, incoming, diff);
    const orders = result.schema.entities.find((e) => e.name === "orders");
    expect(orders).toBeDefined();
    expect(orders!.status).toBe("deprecated");
    expect(result.removedEntityIds).toEqual([]);
  });

  it("hard-deletes entity when removeEntityIds opt-in is provided", () => {
    const current = buildCurrent();
    const incoming = buildIncomingSameAsCurrent();
    incoming.entities = incoming.entities.filter((e) => e.name !== "orders");
    incoming.relations = [];
    const ordersId = current.entities.find((e) => e.name === "orders")!.id;
    const diff = diffSchema(current, incoming);
    const result = applyDiff(current, incoming, diff, { removeEntityIds: [ordersId] });
    expect(result.schema.entities.find((e) => e.name === "orders")).toBeUndefined();
    expect(result.removedEntityIds).toContain(ordersId);
    // The dangling FK relation must also be removed (its source entity is gone).
    expect(result.schema.relations).toHaveLength(0);
  });

  it("preserves manual relations across re-import", () => {
    const current = buildCurrent();
    const incoming = buildIncomingSameAsCurrent();
    // Add a manual relation between users.email and orders.user_id (synthetic) to current.
    const users = current.entities.find((e) => e.name === "users")!;
    const orders = current.entities.find((e) => e.name === "orders")!;
    const manual = createRelation({
      sourceEntityId: orders.id,
      sourceColumnId: orders.columns[1].id, // user_id
      targetEntityId: users.id,
      targetColumnId: users.columns[1].id, // email
      cardinality: "1:1",
      source: "manual",
      name: "manual_rel",
    });
    current.relations = [...current.relations, manual];

    const diff = diffSchema(current, incoming);
    const result = applyDiff(current, incoming, diff);
    const survivingManual = result.schema.relations.find((r) => r.source === "manual");
    expect(survivingManual).toBeDefined();
    expect(survivingManual!.name).toBe("manual_rel");
  });

  it("adds new entity with status='new' and a non-(0,0) auto-position", () => {
    const current = buildCurrent();
    const incoming = buildIncomingSameAsCurrent();
    incoming.entities.push(
      createEntity({
        name: "products",
        columns: [createColumn({ name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false })],
      }),
    );
    const diff = diffSchema(current, incoming);
    const result = applyDiff(current, incoming, diff);
    const products = result.schema.entities.find((e) => e.name === "products")!;
    expect(products).toBeDefined();
    expect(products.status).toBe("new");
    expect(products.position).toBeDefined();
  });

  it("modifies entity status to 'modified' and updates column attrs while preserving column id", () => {
    const current = buildCurrent();
    const incoming = buildIncomingSameAsCurrent();
    // Change users.email to nullable=true with new comment.
    const users = incoming.entities.find((e) => e.name === "users")!;
    users.columns[1].nullable = true;
    users.columns[1].comment = "user email";
    const diff = diffSchema(current, incoming);
    const result = applyDiff(current, incoming, diff);
    const updatedUsers = result.schema.entities.find((e) => e.name === "users")!;
    expect(updatedUsers.status).toBe("modified");
    const oldUsers = current.entities.find((e) => e.name === "users")!;
    // Column id preserved across modification.
    expect(updatedUsers.columns[1].id).toBe(oldUsers.columns[1].id);
    expect(updatedUsers.columns[1].nullable).toBe(true);
    expect(updatedUsers.columns[1].comment).toBe("user email");
    // Position preserved.
    expect(updatedUsers.position).toEqual({ x: 200, y: 150 });
  });

  it("preserves a user column comment when incoming DDL omits it", () => {
    const current = buildCurrent();
    current.entities[0].columns[1].comment = "user-authored email note";
    const incoming = buildIncomingSameAsCurrent();
    incoming.entities[0].columns[1].nullable = true;

    const result = applyDiff(current, incoming, diffSchema(current, incoming));

    expect(result.schema.entities[0].columns[1].comment).toBe("user-authored email note");
  });

  it("applies an incoming FK constraint name while preserving the relation id", () => {
    const current = buildCurrent();
    current.relations[0].name = "fk_old";
    const incoming = buildIncomingSameAsCurrent();
    incoming.relations[0].name = "fk_new";

    const result = applyDiff(current, incoming, diffSchema(current, incoming));

    expect(result.schema.relations[0].id).toBe(current.relations[0].id);
    expect(result.schema.relations[0].name).toBe("fk_new");
  });

  it("preserves the current FK constraint name when incoming DDL omits it", () => {
    const current = buildCurrent();
    current.relations[0].name = "fk_named";
    const incoming = buildIncomingSameAsCurrent();
    incoming.relations[0].name = undefined;

    const result = applyDiff(current, incoming, diffSchema(current, incoming));

    expect(result.schema.relations[0].id).toBe(current.relations[0].id);
    expect(result.schema.relations[0].name).toBe("fk_named");
  });

  it("drops a manual relation whose endpoint column was removed by DDL", () => {
    const current = buildCurrent();
    // Manual relation pinned to orders.user_id (which we'll drop in incoming).
    const users = current.entities.find((e) => e.name === "users")!;
    const orders = current.entities.find((e) => e.name === "orders")!;
    const manual = createRelation({
      sourceEntityId: orders.id,
      sourceColumnId: orders.columns[1].id,
      targetEntityId: users.id,
      targetColumnId: users.columns[0].id,
      cardinality: "1:1",
      source: "manual",
    });
    current.relations = [...current.relations, manual];
    const incoming = buildIncomingSameAsCurrent();
    // Drop user_id from incoming orders.
    const incOrders = incoming.entities.find((e) => e.name === "orders")!;
    incOrders.columns = incOrders.columns.filter((c) => c.name !== "user_id");
    incoming.relations = []; // FK gone too
    const diff = diffSchema(current, incoming);
    const result = applyDiff(current, incoming, diff);
    expect(result.schema.relations.find((r) => r.source === "manual")).toBeUndefined();
    expect(result.removedRelationIds.length).toBeGreaterThan(0);
  });

  it("applies case-only entity name changes from incoming DDL", () => {
    const current = buildCurrent();
    const incoming = buildIncomingSameAsCurrent();
    incoming.entities[0].name = "Users";

    const diff = diffSchema(current, incoming);
    const result = applyDiff(current, incoming, diff);

    const oldUsers = current.entities.find((e) => e.name === "users")!;
    const updatedUsers = result.schema.entities.find((e) => e.id === oldUsers.id)!;
    expect(updatedUsers.name).toBe("Users");
  });

  it("materializes ALTER directives against current while preserving existing ids", () => {
    const current = buildCurrent();
    const users = current.entities.find((e) => e.name === "users")!;
    const oldEmailId = users.columns.find((c) => c.name === "email")!.id;
    const alters: AlterDirective[] = [
      { kind: "addColumn", tableName: "users", column: createColumn({ name: "nickname", type: "VARCHAR(50)" }) },
      { kind: "modifyColumn", tableName: "users", column: createColumn({ name: "email", type: "TEXT", nullable: false }) },
      { kind: "dropColumn", tableName: "orders", columnName: "user_id" },
    ];

    const incoming = createSchema({ name: "Incoming" });
    const materialized = materializeAltersToIncoming(current, incoming, alters);
    const diff = diffSchema(current, materialized.incoming, {
      mode: "partial",
      touchedEntityKeys: materialized.touchedEntityKeys,
    });
    const result = applyDiff(current, materialized.incoming, diff);

    const mergedUsers = result.schema.entities.find((e) => e.name === "users")!;
    expect(mergedUsers.columns.find((c) => c.name === "nickname")).toBeDefined();
    expect(mergedUsers.columns.find((c) => c.name === "email")?.type).toBe("TEXT");
    expect(mergedUsers.columns.find((c) => c.name === "email")?.id).toBe(oldEmailId);
    expect(result.schema.entities.find((e) => e.name === "orders")?.columns.some((c) => c.name === "user_id")).toBe(false);
    expect(diff.stats.entitiesRemoved).toBe(0);
  });
});
