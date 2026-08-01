import { describe, it, expect } from "vitest";
import { generateDDL } from "../ddl";
import { createSchema, createEntity, createColumn, createRelation } from "../../model/factory";

function schemaWith(
  entities: ReturnType<typeof createEntity>[] = [],
  relations: ReturnType<typeof createRelation>[] = [],
) {
  const s = createSchema({ name: "test" });
  s.entities = entities;
  s.relations = relations;
  return s;
}

describe("generateDDL", () => {
  it("빈 스키마 → 빈 출력", () => {
    const schema = createSchema({ name: "empty" });
    expect(generateDDL(schema).trim()).toBe("");
  });

  it("단일 테이블 + 단일 PK", () => {
    const cols = [
      createColumn({ name: "id", type: "INT", isPrimaryKey: true, nullable: false }),
      createColumn({ name: "name", type: "VARCHAR(100)", nullable: false }),
      createColumn({ name: "email", type: "VARCHAR(255)" }),
    ];
    const entity = createEntity({ name: "users", columns: cols });

    const ddl = generateDDL(schemaWith([entity]));
    expect(ddl).toContain("CREATE TABLE users (");
    expect(ddl).toContain("id INT NOT NULL PRIMARY KEY");
    expect(ddl).toContain("name VARCHAR(100) NOT NULL");
    expect(ddl).toContain("email VARCHAR(255)");
    expect(ddl).toContain(");");
  });

  it("복합 PK → table-level PRIMARY KEY", () => {
    const cols = [
      createColumn({ name: "user_id", type: "INT", isPrimaryKey: true, nullable: false }),
      createColumn({ name: "role_id", type: "INT", isPrimaryKey: true, nullable: false }),
    ];
    const entity = createEntity({ name: "user_roles", columns: cols });

    const ddl = generateDDL(schemaWith([entity]));
    expect(ddl).not.toContain("NOT NULL PRIMARY KEY");
    expect(ddl).toContain("PRIMARY KEY (user_id, role_id)");
  });

  it("DEFAULT 값 출력", () => {
    const cols = [
      createColumn({ name: "status", type: "VARCHAR(20)", defaultValue: "'active'" }),
    ];
    const entity = createEntity({ name: "accounts", columns: cols });

    const ddl = generateDDL(schemaWith([entity]));
    expect(ddl).toContain("DEFAULT 'active'");
  });

  it("FK relation → ALTER TABLE", () => {
    const userCols = [
      createColumn({ name: "id", type: "INT", isPrimaryKey: true, nullable: false }),
    ];
    const orderCols = [
      createColumn({ name: "id", type: "INT", isPrimaryKey: true, nullable: false }),
      createColumn({ name: "user_id", type: "INT", nullable: false }),
    ];
    const users = createEntity({ name: "users", columns: userCols });
    const orders = createEntity({ name: "orders", columns: orderCols });

    const rel = createRelation({
      sourceEntityId: orders.id,
      sourceColumnId: orderCols[1].id,
      targetEntityId: users.id,
      targetColumnId: userCols[0].id,
      cardinality: "N:1",
    });

    const ddl = generateDDL(schemaWith([users, orders], [rel]));
    expect(ddl).toContain("ALTER TABLE orders ADD CONSTRAINT fk_orders_user_id FOREIGN KEY (user_id) REFERENCES users (id);");
  });

  it("relation에 name이 있으면 constraint name으로 사용", () => {
    const userCols = [createColumn({ name: "id", type: "INT", isPrimaryKey: true })];
    const orderCols = [
      createColumn({ name: "id", type: "INT", isPrimaryKey: true }),
      createColumn({ name: "user_id", type: "INT" }),
    ];
    const users = createEntity({ name: "users", columns: userCols });
    const orders = createEntity({ name: "orders", columns: orderCols });

    const rel = createRelation({
      name: "orders_user_fk",
      sourceEntityId: orders.id,
      sourceColumnId: orderCols[1].id,
      targetEntityId: users.id,
      targetColumnId: userCols[0].id,
      cardinality: "N:1",
    });

    const ddl = generateDDL(schemaWith([users, orders], [rel]));
    expect(ddl).toContain("ADD CONSTRAINT orders_user_fk FOREIGN KEY");
  });

  it("존재하지 않는 entity/column ID → skip", () => {
    const rel = createRelation({
      sourceEntityId: "nonexistent",
      sourceColumnId: "c1",
      targetEntityId: "nonexistent2",
      targetColumnId: "c2",
      cardinality: "1:N",
    });

    const ddl = generateDDL(schemaWith([], [rel]));
    expect(ddl).not.toContain("ALTER TABLE");
  });

  it("quotes identifiers that need escaping so exported DDL can round-trip", () => {
    const entity = createEntity({
      name: "order items",
      columns: [createColumn({ name: "select", type: "INT", isPrimaryKey: true, nullable: false })],
    });

    const ddl = generateDDL(schemaWith([entity]));

    expect(ddl).toContain('CREATE TABLE "order items" (');
    expect(ddl).toContain('"select" INT NOT NULL PRIMARY KEY');
  });

  it("quotes parser-recognized SQL keywords so exported DDL is valid", () => {
    const entity = createEntity({
      name: "check",
      columns: [createColumn({ name: "check", type: "INT" })],
    });

    const ddl = generateDDL(schemaWith([entity]));

    expect(ddl).toContain('CREATE TABLE "check" (');
    expect(ddl).toContain('"check" INT');
  });
});

describe("generateDDL dialects", () => {
  it("postgresql 명시 옵션은 기본 출력과 동일하다", () => {
    const entity = createEntity({
      name: "order",
      columns: [createColumn({ name: "id", type: "INT", isPrimaryKey: true, nullable: false })],
    });
    const schema = schemaWith([entity]);

    expect(generateDDL(schema, { dialect: "postgresql" })).toBe(generateDDL(schema));
  });

  it("mysql: 예약어/특수 식별자를 백틱으로 인용한다", () => {
    const entity = createEntity({
      name: "order",
      columns: [
        createColumn({ name: "select", type: "INT", isPrimaryKey: true, nullable: false }),
        createColumn({ name: "full name", type: "VARCHAR(50)" }),
      ],
    });

    const ddl = generateDDL(schemaWith([entity]), { dialect: "mysql" });

    expect(ddl).toContain("CREATE TABLE `order` (");
    expect(ddl).toContain("`select` INT NOT NULL PRIMARY KEY");
    expect(ddl).toContain("`full name` VARCHAR(50)");
    expect(ddl).not.toContain('"order"');
  });

  it("mysql: 식별자 안의 백틱은 두 번 써서 이스케이프한다", () => {
    const entity = createEntity({
      name: "we`ird",
      columns: [createColumn({ name: "id", type: "INT" })],
    });

    const ddl = generateDDL(schemaWith([entity]), { dialect: "mysql" });

    expect(ddl).toContain("CREATE TABLE `we``ird` (");
  });

  it("mysql: FK ALTER 문의 식별자도 백틱으로 인용한다", () => {
    const userCols = [createColumn({ name: "id", type: "INT", isPrimaryKey: true })];
    const orderCols = [
      createColumn({ name: "id", type: "INT", isPrimaryKey: true }),
      createColumn({ name: "user_id", type: "INT" }),
    ];
    const users = createEntity({ name: "users", columns: userCols });
    const orders = createEntity({ name: "order", columns: orderCols });
    const rel = createRelation({
      sourceEntityId: orders.id,
      sourceColumnId: orderCols[1].id,
      targetEntityId: users.id,
      targetColumnId: userCols[0].id,
      cardinality: "N:1",
    });

    const ddl = generateDDL(schemaWith([users, orders], [rel]), { dialect: "mysql" });

    expect(ddl).toContain("ALTER TABLE `order` ADD CONSTRAINT fk_order_user_id FOREIGN KEY (user_id) REFERENCES users (id);");
  });

  it("mysql: 주석은 COMMENT ON 대신 인라인 COMMENT로 방출한다", () => {
    const entity = createEntity({
      name: "users",
      comment: "사용자 테이블",
      columns: [createColumn({ name: "role", type: "VARCHAR(20)", comment: "권한 'admin' 등" })],
    });

    const ddl = generateDDL(schemaWith([entity]), { dialect: "mysql" });

    expect(ddl).not.toContain("COMMENT ON");
    expect(ddl).toContain("role VARCHAR(20) COMMENT '권한 ''admin'' 등'");
    expect(ddl).toContain(") COMMENT='사용자 테이블';");
  });

  it("mysql: isAutoIncrement 컬럼에 AUTO_INCREMENT를 방출한다", () => {
    const entity = createEntity({
      name: "t",
      columns: [createColumn({ name: "id", type: "INT", isPrimaryKey: true, nullable: false, isAutoIncrement: true })],
    });

    const ddl = generateDDL(schemaWith([entity]), { dialect: "mysql" });

    expect(ddl).toContain("id INT NOT NULL AUTO_INCREMENT PRIMARY KEY");
  });

  it("postgresql: 정수형 auto-increment는 SERIAL 계열로 방출한다", () => {
    const entity = createEntity({
      name: "t",
      columns: [
        createColumn({ name: "a", type: "INT", isPrimaryKey: true, nullable: false, isAutoIncrement: true }),
        createColumn({ name: "b", type: "BIGINT", nullable: false, isAutoIncrement: true }),
        createColumn({ name: "c", type: "smallint", nullable: false, isAutoIncrement: true }),
      ],
    });

    const ddl = generateDDL(schemaWith([entity]), { dialect: "postgresql" });

    expect(ddl).toContain("a SERIAL PRIMARY KEY");
    expect(ddl).toContain("b BIGSERIAL");
    expect(ddl).toContain("c SMALLSERIAL");
    expect(ddl).not.toContain("SERIAL NOT NULL");
    expect(ddl).not.toContain("AUTO_INCREMENT");
  });

  it("postgresql: 비정수형 auto-increment는 GENERATED BY DEFAULT AS IDENTITY로 방출한다", () => {
    const entity = createEntity({
      name: "t",
      columns: [createColumn({ name: "id", type: "NUMERIC(10)", nullable: false, isAutoIncrement: true })],
    });

    const ddl = generateDDL(schemaWith([entity]), { dialect: "postgresql" });

    expect(ddl).toContain("id NUMERIC(10) NOT NULL GENERATED BY DEFAULT AS IDENTITY");
  });

  it("postgresql: 주석은 기존처럼 COMMENT ON 문으로 방출한다", () => {
    const entity = createEntity({
      name: "users",
      comment: "사용자 테이블",
      columns: [createColumn({ name: "role", type: "VARCHAR(20)", comment: "권한" })],
    });

    const ddl = generateDDL(schemaWith([entity]), { dialect: "postgresql" });

    expect(ddl).toContain("COMMENT ON TABLE users IS '사용자 테이블';");
    expect(ddl).toContain("COMMENT ON COLUMN users.role IS '권한';");
    expect(ddl).not.toContain("COMMENT='");
  });
});

describe("generateDDL dialect type mapping", () => {
  function col(name: string, type: string, extra: Record<string, unknown> = {}) {
    return createColumn({ name, type, ...extra });
  }
  function ddlFor(types: Array<[string, string]>, dialect: "postgresql" | "mysql") {
    const entity = createEntity({ name: "t", columns: types.map(([n, ty]) => col(n, ty)) });
    return generateDDL(schemaWith([entity]), { dialect });
  }

  it("postgresql: MySQL 전용 타입을 등가 타입으로 매핑한다", () => {
    const ddl = ddlFor(
      [
        ["flag", "TINYINT(1)"],
        ["tiny", "TINYINT"],
        ["med", "MEDIUMINT"],
        ["disp", "INT(11)"],
        ["created", "DATETIME"],
        ["body", "LONGTEXT"],
        ["bin", "BLOB"],
        ["ratio", "DOUBLE"],
        ["yr", "YEAR"],
      ],
      "postgresql",
    );
    expect(ddl).toContain("flag BOOLEAN");
    expect(ddl).toContain("tiny SMALLINT");
    expect(ddl).toContain("med INTEGER");
    expect(ddl).toContain("disp INTEGER");
    expect(ddl).toContain("created TIMESTAMP");
    expect(ddl).toContain("body TEXT");
    expect(ddl).toContain("bin BYTEA");
    expect(ddl).toContain("ratio DOUBLE PRECISION");
    expect(ddl).toContain("yr SMALLINT");
    expect(ddl).not.toContain("TINYINT");
    expect(ddl).not.toContain("LONGTEXT");
  });

  it("postgresql: UNSIGNED 정수는 상위 범위 타입으로 확장한다", () => {
    const ddl = ddlFor(
      [
        ["a", "INT UNSIGNED"],
        ["b", "SMALLINT UNSIGNED"],
        ["c", "BIGINT UNSIGNED"],
        ["d", "TINYINT UNSIGNED"],
      ],
      "postgresql",
    );
    expect(ddl).toContain("a BIGINT");
    expect(ddl).toContain("b INTEGER");
    expect(ddl).toContain("c NUMERIC(20)");
    expect(ddl).toContain("d SMALLINT");
    expect(ddl).not.toContain("UNSIGNED");
  });

  it("postgresql: ENUM은 TEXT + CHECK(IN ...)로 풀어낸다", () => {
    const entity = createEntity({
      name: "t",
      columns: [col("status", "ENUM('a','b')"), col("select", "ENUM('x','y')")],
    });
    const ddl = generateDDL(schemaWith([entity]), { dialect: "postgresql" });
    expect(ddl).toContain("status TEXT CHECK (status IN ('a','b'))");
    expect(ddl).toContain(`"select" TEXT CHECK ("select" IN ('x','y'))`);
    expect(ddl).not.toContain("ENUM");
  });

  it("mysql: PostgreSQL 전용 타입을 등가 타입으로 매핑한다", () => {
    const ddl = ddlFor(
      [
        ["meta", "JSONB"],
        ["uid", "UUID"],
        ["raw", "BYTEA"],
        ["at", "TIMESTAMP WITH TIME ZONE"],
        ["local_at", "TIMESTAMP WITHOUT TIME ZONE"],
        ["ratio", "DOUBLE PRECISION"],
      ],
      "mysql",
    );
    expect(ddl).toContain("meta JSON");
    expect(ddl).toContain("uid CHAR(36)");
    expect(ddl).toContain("raw BLOB");
    expect(ddl).toContain("at TIMESTAMP");
    expect(ddl).toContain("local_at DATETIME");
    expect(ddl).toContain("ratio DOUBLE");
    expect(ddl).not.toContain("JSONB");
    expect(ddl).not.toContain("WITH TIME ZONE");
  });

  it("mysql: 네이티브 타입(ENUM/TINYINT(1))은 그대로 둔다", () => {
    const ddl = ddlFor([["status", "ENUM('a','b')"], ["flag", "TINYINT(1)"]], "mysql");
    expect(ddl).toContain("status ENUM('a','b')");
    expect(ddl).toContain("flag TINYINT(1)");
  });

  it("양쪽: 공통/미지 타입은 그대로 통과한다", () => {
    for (const dialect of ["postgresql", "mysql"] as const) {
      const ddl = ddlFor([["name", "VARCHAR(255)"], ["amount", "DECIMAL(10,2)"], ["odd", "GEOMETRY"]], dialect);
      expect(ddl).toContain("name VARCHAR(255)");
      expect(ddl).toContain("amount DECIMAL(10,2)");
      expect(ddl).toContain("odd GEOMETRY");
    }
  });

  it("postgresql: 매핑 후 타입으로 SERIAL 계열을 결정한다 (INT UNSIGNED + auto-increment → BIGSERIAL)", () => {
    const entity = createEntity({
      name: "t",
      columns: [col("id", "INT UNSIGNED", { isPrimaryKey: true, nullable: false, isAutoIncrement: true })],
    });
    const ddl = generateDDL(schemaWith([entity]), { dialect: "postgresql" });
    expect(ddl).toContain("id BIGSERIAL PRIMARY KEY");
  });
});

describe("generateDDL boolean default mapping", () => {
  it("postgresql: TINYINT(1)→BOOLEAN 매핑 시 숫자 default도 TRUE/FALSE로 변환한다", () => {
    const entity = createEntity({
      name: "t",
      columns: [
        createColumn({ name: "a", type: "TINYINT(1)", defaultValue: "1" }),
        createColumn({ name: "b", type: "TINYINT(1)", defaultValue: "0" }),
        createColumn({ name: "c", type: "TINYINT(1)", defaultValue: "TRUE" }),
      ],
    });
    const ddl = generateDDL(schemaWith([entity]), { dialect: "postgresql" });
    expect(ddl).toContain("a BOOLEAN DEFAULT TRUE");
    expect(ddl).toContain("b BOOLEAN DEFAULT FALSE");
    expect(ddl).toContain("c BOOLEAN DEFAULT TRUE");
  });
});
