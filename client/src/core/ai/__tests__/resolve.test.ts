import { describe, it, expect } from "vitest";
import { resolveAISuggestions } from "../resolve";
import { createEntity, createColumn } from "../../model/factory";
import type { AIRelationSuggestion } from "../types";
import type { Relation } from "../../model/types";

function makeSuggestion(overrides: Partial<AIRelationSuggestion> = {}): AIRelationSuggestion {
  return {
    sourceEntityName: "orders",
    sourceColumnName: "user_id",
    targetEntityName: "users",
    targetColumnName: "id",
    cardinality: "N:1",
    reasoning: "FK pattern",
    confidence: "high",
    ...overrides,
  };
}

function buildEntities() {
  const userIdCol = createColumn({ name: "id", type: "INT", isPrimaryKey: true });
  const users = createEntity({ name: "users", columns: [userIdCol] });

  const orderUserIdCol = createColumn({ name: "user_id", type: "INT" });
  const orders = createEntity({ name: "orders", columns: [orderUserIdCol] });

  return { users, userIdCol, orders, orderUserIdCol };
}

describe("resolveAISuggestions", () => {
  it("resolves valid suggestions to entity/column IDs", () => {
    const { users, userIdCol, orders, orderUserIdCol } = buildEntities();
    const suggestions = [makeSuggestion()];

    const result = resolveAISuggestions(suggestions, [users, orders], []);

    expect(result).toHaveLength(1);
    expect(result[0].unresolvable).toBe(false);
    expect(result[0].sourceEntityId).toBe(orders.id);
    expect(result[0].sourceColumnId).toBe(orderUserIdCol.id);
    expect(result[0].targetEntityId).toBe(users.id);
    expect(result[0].targetColumnId).toBe(userIdCol.id);
  });

  it("marks as unresolvable when entity not found", () => {
    const { users, orders } = buildEntities();
    const suggestions = [makeSuggestion({ sourceEntityName: "nonexistent" })];

    const result = resolveAISuggestions(suggestions, [users, orders], []);

    expect(result[0].unresolvable).toBe(true);
    expect(result[0].unresolvableReason).toContain("nonexistent");
  });

  it("marks as unresolvable when column not found", () => {
    const { users, orders } = buildEntities();
    const suggestions = [makeSuggestion({ sourceColumnName: "bad_col" })];

    const result = resolveAISuggestions(suggestions, [users, orders], []);

    expect(result[0].unresolvable).toBe(true);
    expect(result[0].unresolvableReason).toContain("bad_col");
  });

  it("detects duplicates against existing relations", () => {
    const { users, userIdCol, orders, orderUserIdCol } = buildEntities();
    const existing: Relation[] = [
      {
        id: "r1",
        sourceEntityId: orders.id,
        sourceColumnId: orderUserIdCol.id,
        targetEntityId: users.id,
        targetColumnId: userIdCol.id,
        cardinality: "N:1",
        source: "ddl",
      },
    ];
    const suggestions = [makeSuggestion()];

    const result = resolveAISuggestions(suggestions, [users, orders], existing);

    expect(result[0].duplicate).toBe(true);
  });

  it("detects reverse-direction duplicates", () => {
    const { users, userIdCol, orders, orderUserIdCol } = buildEntities();
    const existing: Relation[] = [
      {
        id: "r1",
        sourceEntityId: users.id,
        sourceColumnId: userIdCol.id,
        targetEntityId: orders.id,
        targetColumnId: orderUserIdCol.id,
        cardinality: "1:N",
        source: "ddl",
      },
    ];
    const suggestions = [makeSuggestion()];

    const result = resolveAISuggestions(suggestions, [users, orders], existing);

    expect(result[0].duplicate).toBe(true);
  });

  it("marks repeated suggestions in the same response as duplicates", () => {
    const { users, orders } = buildEntities();

    const result = resolveAISuggestions([makeSuggestion(), makeSuggestion()], [users, orders], []);

    expect(result.map((item) => item.duplicate)).toEqual([false, true]);
  });

  it("case-insensitive name matching", () => {
    const { users, orders } = buildEntities();
    const suggestions = [makeSuggestion({ sourceEntityName: "ORDERS", targetEntityName: "USERS" })];

    const result = resolveAISuggestions(suggestions, [users, orders], []);

    expect(result[0].unresolvable).toBe(false);
  });

  it("matches visually identical NFC and NFD names", () => {
    const { users, orders } = buildEntities();
    orders.name = "cafe\u0301_orders";
    const suggestion = makeSuggestion({ sourceEntityName: "café_orders" });

    expect(resolveAISuggestions([suggestion], [users, orders], [])[0].unresolvable).toBe(false);
  });
});
