import { describe, it, expect } from "vitest";
import { inferRelations } from "../inferRelations";
import { createEntity, createColumn, createRelation } from "../../model/factory";

function makeEntity(name: string, columns: Array<{ name: string; isPrimaryKey?: boolean }>) {
  const cols = columns.map((c) =>
    createColumn({ name: c.name, type: "INT", isPrimaryKey: c.isPrimaryKey ?? false }),
  );
  return createEntity({ name, columns: cols });
}

describe("inferRelations", () => {
  it("단독PK 마스터 → non-PK 하위 테이블 연결", () => {
    const departments = makeEntity("departments", [{ name: "dept_id", isPrimaryKey: true }, { name: "name" }]);
    const employees = makeEntity("employees", [{ name: "id", isPrimaryKey: true }, { name: "dept_id" }]);

    const result = inferRelations([departments, employees], []);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("inferred");
    expect(result[0].cardinality).toBe("N:1");
    expect(result[0].targetEntityId).toBe(departments.id);
  });

  it("복합PK 테이블은 마스터로 취급 안됨", () => {
    // dept_id가 복합PK의 일부인 테이블 → 마스터 아님
    const deptHist = makeEntity("dept_hist", [
      { name: "dept_id", isPrimaryKey: true },
      { name: "seq", isPrimaryKey: true },
    ]);
    const employees = makeEntity("employees", [{ name: "id", isPrimaryKey: true }, { name: "dept_id" }]);

    const result = inferRelations([deptHist, employees], []);
    // dept_hist는 복합PK(dept_id, seq) → dept_id의 단독PK 마스터가 없음 → 연결 없음
    expect(result).toHaveLength(0);
  });

  it("단독PK 마스터가 있으면 복합PK 하위테이블도 연결", () => {
    const departments = makeEntity("departments", [{ name: "dept_id", isPrimaryKey: true }]);
    const deptHist = makeEntity("dept_hist", [
      { name: "dept_id", isPrimaryKey: true },
      { name: "seq", isPrimaryKey: true },
    ]);
    const employees = makeEntity("employees", [{ name: "id", isPrimaryKey: true }, { name: "dept_id" }]);

    const result = inferRelations([departments, deptHist, employees], []);
    // departments(단독PK) → employees(non-PK)만 연결
    // departments → deptHist는 skip (deptHist의 dept_id가 PK이므로 child 조건 불충족)
    expect(result).toHaveLength(1);
    expect(result[0].targetEntityId).toBe(departments.id);
    expect(result[0].sourceEntityId).toBe(employees.id);
  });

  it("하위 테이블끼리는 연결 안됨", () => {
    const master = makeEntity("codes", [{ name: "code_id", isPrimaryKey: true }]);
    const child1 = makeEntity("orders", [{ name: "id", isPrimaryKey: true }, { name: "code_id" }]);
    const child2 = makeEntity("products", [{ name: "id", isPrimaryKey: true }, { name: "code_id" }]);

    const result = inferRelations([master, child1, child2], []);
    // master→child1, master→child2만. child1↔child2는 없음
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.targetEntityId === master.id)).toBe(true);
  });

  it("non-PK↔non-PK → 관계 생성 안됨", () => {
    const a = makeEntity("table_a", [{ name: "region" }]);
    const b = makeEntity("table_b", [{ name: "region" }]);

    const result = inferRelations([a, b], []);
    expect(result).toHaveLength(0);
  });

  it("제외 목록 컬럼(id, created_at 등)은 매칭 안됨", () => {
    const a = makeEntity("table_a", [
      { name: "id", isPrimaryKey: true },
      { name: "created_at" },
    ]);
    const b = makeEntity("table_b", [
      { name: "id", isPrimaryKey: true },
      { name: "created_at" },
    ]);

    const result = inferRelations([a, b], []);
    expect(result).toHaveLength(0);
  });

  it("기존 FK와 중복 시 skip", () => {
    const departments = makeEntity("departments", [{ name: "dept_id", isPrimaryKey: true }]);
    const employees = makeEntity("employees", [{ name: "dept_id" }]);

    const existingRel = createRelation({
      sourceEntityId: employees.id,
      sourceColumnId: employees.columns[0].id,
      targetEntityId: departments.id,
      targetColumnId: departments.columns[0].id,
      cardinality: "N:1",
      source: "ddl",
    });

    const result = inferRelations([departments, employees], [existingRel]);
    expect(result).toHaveLength(0);
  });

  it("case-insensitive 매칭", () => {
    const a = makeEntity("table_a", [{ name: "User_Id", isPrimaryKey: true }]);
    const b = makeEntity("table_b", [{ name: "user_id" }]);

    const result = inferRelations([a, b], []);
    expect(result).toHaveLength(1);
  });

  it("빈 입력 → 빈 배열", () => {
    const result = inferRelations([], []);
    expect(result).toHaveLength(0);
  });
});
