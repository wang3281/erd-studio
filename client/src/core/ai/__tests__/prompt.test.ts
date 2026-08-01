import { describe, it, expect } from "vitest";
import { serializeSchemaForPrompt, buildPromptMessages } from "../prompt";
import { createEntity, createColumn } from "../../model/factory";

describe("serializeSchemaForPrompt", () => {
  it("serializes entities with columns", () => {
    const col1 = createColumn({ name: "id", type: "INT", isPrimaryKey: true, nullable: false });
    const col2 = createColumn({ name: "name", type: "VARCHAR(255)" });
    const entity = createEntity({ name: "users", columns: [col1, col2] });

    const result = serializeSchemaForPrompt([entity], []);

    expect(result).toContain("TABLE users");
    expect(result).toContain("id INT PK NOT NULL");
    expect(result).toContain("name VARCHAR(255)");
  });

  it("includes entity comments", () => {
    const col = createColumn({ name: "id", type: "INT", isPrimaryKey: true });
    const entity = createEntity({ name: "users", comment: "사용자", columns: [col] });

    const result = serializeSchemaForPrompt([entity], []);

    expect(result).toContain("-- 사용자");
  });

  it("includes existing relations", () => {
    const col1 = createColumn({ name: "id", type: "INT", isPrimaryKey: true });
    const col2 = createColumn({ name: "user_id", type: "INT", isForeignKey: true });
    const users = createEntity({ name: "users", columns: [col1] });
    const orders = createEntity({ name: "orders", columns: [col2] });

    const rel = {
      id: "r1",
      sourceEntityId: orders.id,
      sourceColumnId: col2.id,
      targetEntityId: users.id,
      targetColumnId: col1.id,
      cardinality: "N:1" as const,
      source: "ddl" as const,
    };

    const result = serializeSchemaForPrompt([users, orders], [rel]);

    expect(result).toContain("EXISTING RELATIONS:");
    expect(result).toContain("orders.user_id -> users.id (N:1)");
  });

  it("returns empty when no entities", () => {
    const result = serializeSchemaForPrompt([], []);
    expect(result).toBe("");
  });
});

describe("buildPromptMessages", () => {
  it("returns system and user messages", () => {
    const messages = buildPromptMessages("TABLE users (id INT PK)");

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("TABLE users (id INT PK)");
  });

  it("system message instructs JSON response", () => {
    const messages = buildPromptMessages("TABLE t (id INT)");
    expect(messages[0].content).toContain("JSON");
  });
});
