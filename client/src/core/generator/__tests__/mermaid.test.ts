import { describe, it, expect } from "vitest";
import { generateMermaid } from "../mermaid";
import { createSchema, createEntity, createColumn, createRelation } from "../../model/factory";

describe("generateMermaid", () => {
  it("빈 스키마 → erDiagram 헤더만", () => {
    expect(generateMermaid(createSchema({ name: "empty" })).trim()).toBe("erDiagram");
  });

  it("테이블과 컬럼을 attribute로 방출하고 PK/FK/UK를 표기한다", () => {
    const cols = [
      createColumn({ name: "id", type: "INT", isPrimaryKey: true, nullable: false }),
      createColumn({ name: "email", type: "VARCHAR(255)", isUnique: true }),
      createColumn({ name: "org_id", type: "INT", isForeignKey: true }),
    ];
    const schema = createSchema({ name: "s" });
    schema.entities = [createEntity({ name: "users", columns: cols })];

    const out = generateMermaid(schema);
    expect(out).toContain("erDiagram");
    expect(out).toContain("users {");
    expect(out).toContain("INT id PK");
    expect(out).toContain("VARCHAR(255) email UK");
    expect(out).toContain("INT org_id FK");
  });

  it("공백이 있는 타입과 비정상 식별자를 안전한 토큰으로 정리한다", () => {
    const cols = [createColumn({ name: "full name", type: "double precision" })];
    const schema = createSchema({ name: "s" });
    schema.entities = [createEntity({ name: "my table", columns: cols })];

    const out = generateMermaid(schema);
    expect(out).toContain("my_table {");
    expect(out).toContain("double_precision full_name");
  });

  it("cardinality를 crow's-foot 기호로 매핑한다 (source:target)", () => {
    const parent = createEntity({ name: "parent", columns: [createColumn({ name: "id", type: "INT", isPrimaryKey: true })] });
    const child = createEntity({ name: "child", columns: [createColumn({ name: "pid", type: "INT", isForeignKey: true })] });
    const schema = createSchema({ name: "s" });
    schema.entities = [child, parent];
    schema.relations = [
      createRelation({
        sourceEntityId: child.id,
        sourceColumnId: child.columns[0].id,
        targetEntityId: parent.id,
        targetColumnId: parent.columns[0].id,
        cardinality: "N:1",
        name: "child_parent",
      }),
    ];

    const out = generateMermaid(schema);
    expect(out).toContain(`child }o--|| parent : "child_parent"`);
  });

  it("N:M을 many-to-many crow's-foot로 매핑한다", () => {
    const a = createEntity({ name: "a", columns: [createColumn({ name: "id", type: "INT", isPrimaryKey: true })] });
    const b = createEntity({ name: "b", columns: [createColumn({ name: "id", type: "INT", isPrimaryKey: true })] });
    const schema = createSchema({ name: "s" });
    schema.entities = [a, b];
    schema.relations = [
      createRelation({
        sourceEntityId: a.id,
        sourceColumnId: a.columns[0].id,
        targetEntityId: b.id,
        targetColumnId: b.columns[0].id,
        cardinality: "N:M",
        name: "a_b",
      }),
    ];

    const out = generateMermaid(schema);
    expect(out).toContain(`a }o--o{ b : "a_b"`);
  });

  it("엔티티가 사라진 관계는 건너뛴다", () => {
    const schema = createSchema({ name: "s" });
    schema.entities = [createEntity({ name: "a", columns: [createColumn({ name: "id", type: "INT" })] })];
    schema.relations = [
      createRelation({
        sourceEntityId: "missing-1",
        sourceColumnId: "missing-c",
        targetEntityId: "missing-2",
        targetColumnId: "missing-c2",
        cardinality: "1:N",
      }),
    ];
    const out = generateMermaid(schema);
    expect(out).not.toContain("-->");
    expect(out).not.toContain("missing");
  });
});
