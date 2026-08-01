import { describe, it, expect } from "vitest";
import { createColumn, createEntity, createRelation, createSchema, calcEntityHeight } from "../factory";

describe("createColumn", () => {
  it("기본 컬럼 생성", () => {
    const col = createColumn({ name: "id", type: "INT" });
    expect(col.id).toBeTruthy();
    expect(col.name).toBe("id");
    expect(col.type).toBe("INT");
    expect(col.nullable).toBe(true);
    expect(col.isPrimaryKey).toBe(false);
    expect(col.isForeignKey).toBe(false);
    expect(col.isUnique).toBe(false);
  });

  it("PK 컬럼 생성", () => {
    const col = createColumn({ name: "id", type: "INT", isPrimaryKey: true, nullable: false });
    expect(col.isPrimaryKey).toBe(true);
    expect(col.nullable).toBe(false);
  });

  it("UQ 컬럼 생성", () => {
    const col = createColumn({ name: "email", type: "VARCHAR(255)", isUnique: true });
    expect(col.isUnique).toBe(true);
  });
});

describe("createEntity", () => {
  it("빈 엔티티 생성", () => {
    const entity = createEntity({ name: "users" });
    expect(entity.id).toBeTruthy();
    expect(entity.name).toBe("users");
    expect(entity.columns).toEqual([]);
    expect(entity.position).toEqual({ x: 0, y: 0 });
  });

  it("컬럼 포함 엔티티 - 높이 자동 계산", () => {
    const cols = [
      createColumn({ name: "id", type: "INT" }),
      createColumn({ name: "name", type: "VARCHAR" }),
    ];
    const entity = createEntity({ name: "users", columns: cols });
    expect(entity.height).toBe(40 + 28 * 2); // header + 2 rows
  });
});

describe("calcEntityHeight", () => {
  it("컬럼 0개 = 헤더만", () => {
    expect(calcEntityHeight(0)).toBe(40);
  });
  it("컬럼 3개", () => {
    expect(calcEntityHeight(3)).toBe(40 + 28 * 3);
  });
});

describe("createRelation", () => {
  it("수동 관계 생성", () => {
    const rel = createRelation({
      sourceEntityId: "e1",
      sourceColumnId: "c1",
      targetEntityId: "e2",
      targetColumnId: "c2",
      cardinality: "1:N",
    });
    expect(rel.source).toBe("manual");
    expect(rel.cardinality).toBe("1:N");
  });
});

describe("createSchema", () => {
  it("빈 스키마 생성", () => {
    const schema = createSchema({ name: "test" });
    expect(schema.version).toBe(1);
    expect(schema.entities).toEqual([]);
    expect(schema.relations).toEqual([]);
    expect(schema.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});
