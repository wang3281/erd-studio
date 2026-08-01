import { describe, it, expect } from "vitest";
import { generateDBML } from "../dbml";
import { createSchema, createEntity, createColumn, createRelation } from "../../model/factory";

describe("generateDBML", () => {
  it("빈 스키마 → 빈 출력", () => {
    expect(generateDBML(createSchema({ name: "empty" })).trim()).toBe("");
  });

  it("Table 블록과 컬럼 설정(pk/not null/unique/default/note)을 방출한다", () => {
    const cols = [
      createColumn({ name: "id", type: "int", isPrimaryKey: true, nullable: false }),
      createColumn({ name: "name", type: "varchar", nullable: false }),
      createColumn({ name: "email", type: "varchar", isUnique: true }),
      createColumn({ name: "role", type: "varchar", defaultValue: "'user'", comment: "권한" }),
    ];
    const schema = createSchema({ name: "s" });
    schema.entities = [createEntity({ name: "users", columns: cols, comment: "사용자" })];

    const out = generateDBML(schema);
    expect(out).toContain("Table users {");
    expect(out).toContain("id int [pk]");
    expect(out).toContain("name varchar [not null]");
    expect(out).toContain("email varchar [unique]");
    expect(out).toContain("role varchar [default: `'user'`, note: '권한']");
    expect(out).toContain("Note: '사용자'");
  });

  it("auto-increment 컬럼은 increment 설정을 갖는다", () => {
    const schema = createSchema({ name: "s" });
    schema.entities = [
      createEntity({
        name: "t",
        columns: [createColumn({ name: "id", type: "int", isPrimaryKey: true, nullable: false, isAutoIncrement: true })],
      }),
    ];

    expect(generateDBML(schema)).toContain("id int [pk, increment]");
  });

  it("비정상 식별자는 따옴표로 감싼다", () => {
    const schema = createSchema({ name: "s" });
    schema.entities = [createEntity({ name: "my table", columns: [createColumn({ name: "full name", type: "text" })] })];
    const out = generateDBML(schema);
    expect(out).toContain('Table "my table" {');
    expect(out).toContain('"full name" text');
  });

  it("인용된 식별자와 note의 역슬래시 및 따옴표를 모두 이스케이프한다", () => {
    const schema = createSchema({ name: "s" });
    schema.entities = [
      createEntity({
        name: String.raw`path\to "quoted"`,
        columns: [
          createColumn({
            name: String.raw`value\part "x"`,
            type: "text",
            comment: String.raw`one\two's`,
          }),
        ],
      }),
    ];

    const out = generateDBML(schema);
    expect(out).toContain(String.raw`Table "path\\to \"quoted\"" {`);
    expect(out).toContain(String.raw`"value\\part \"x\"" text [note: 'one\\two\'s']`);
  });

  it("cardinality를 DBML ref 연산자로 매핑한다 (source:target)", () => {
    const child = createEntity({ name: "child", columns: [createColumn({ name: "pid", type: "int", isForeignKey: true })] });
    const parent = createEntity({ name: "parent", columns: [createColumn({ name: "id", type: "int", isPrimaryKey: true })] });
    const schema = createSchema({ name: "s" });
    schema.entities = [child, parent];
    schema.relations = [
      createRelation({
        sourceEntityId: child.id,
        sourceColumnId: child.columns[0].id,
        targetEntityId: parent.id,
        targetColumnId: parent.columns[0].id,
        cardinality: "N:1",
      }),
    ];
    const out = generateDBML(schema);
    expect(out).toContain("Ref: child.pid > parent.id");
  });

  it("컬럼이 해석되지 않는 관계는 Ref를 만들지 않는다", () => {
    const schema = createSchema({ name: "s" });
    schema.entities = [createEntity({ name: "a", columns: [createColumn({ name: "id", type: "int" })] })];
    schema.relations = [
      createRelation({
        sourceEntityId: "missing",
        sourceColumnId: "missing",
        targetEntityId: "missing",
        targetColumnId: "missing",
        cardinality: "1:1",
      }),
    ];
    expect(generateDBML(schema)).not.toContain("Ref:");
  });
});
