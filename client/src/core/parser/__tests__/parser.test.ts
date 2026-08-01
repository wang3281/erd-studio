import { describe, it, expect } from "vitest";
import { parseDDL } from "../index";
import { generateDDL } from "../../generator/ddl";
import { createColumn, createEntity, createSchema } from "../../model/factory";
import { canApplyDDLImport } from "../../../components/ddlImportState";

describe("parseDDL", () => {
  it("단순 CREATE TABLE", () => {
    const ddl = `
      CREATE TABLE users (
        id INT NOT NULL,
        name VARCHAR(255),
        email VARCHAR(100) DEFAULT 'none'
      );
    `;
    const result = parseDDL(ddl);
    expect(result.errors).toHaveLength(0);
    expect(result.schema.entities).toHaveLength(1);

    const users = result.schema.entities[0];
    expect(users.name).toBe("users");
    expect(users.columns).toHaveLength(3);
    expect(users.columns[0].name).toBe("id");
    expect(users.columns[0].type).toBe("INT");
    expect(users.columns[0].nullable).toBe(false);
    expect(users.columns[1].name).toBe("name");
    expect(users.columns[1].nullable).toBe(true);
    expect(users.columns[2].defaultValue).toBe("'none'");
  });

  it("PRIMARY KEY 인라인", () => {
    const ddl = `CREATE TABLE t (id INT PRIMARY KEY, name TEXT);`;
    const result = parseDDL(ddl);
    expect(result.schema.entities[0].columns[0].isPrimaryKey).toBe(true);
  });

  it("PRIMARY KEY 테이블 레벨", () => {
    const ddl = `CREATE TABLE t (id INT, name TEXT, PRIMARY KEY (id));`;
    const result = parseDDL(ddl);
    expect(result.schema.entities[0].columns[0].isPrimaryKey).toBe(true);
  });

  it("인라인 UNIQUE를 컬럼에 매핑한다", () => {
    const ddl = `CREATE TABLE users (email VARCHAR(255) UNIQUE, name TEXT);`;
    const result = parseDDL(ddl);

    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.message.includes("UNIQUE constraint ignored"))).toBe(false);
    expect(result.schema.entities[0].columns[0].isUnique).toBe(true);
    expect(result.schema.entities[0].columns[1].isUnique).toBe(false);
  });

  it("표현할 수 없는 복합 UNIQUE를 개별 컬럼 UNIQUE로 왜곡하지 않는다", () => {
    const ddl = `CREATE TABLE users (email VARCHAR(255), phone VARCHAR(20), UNIQUE (email, phone));`;
    const result = parseDDL(ddl);

    expect(result.errors).toHaveLength(0);
    expect(result.schema.entities[0].columns[0].isUnique).toBe(false);
    expect(result.schema.entities[0].columns[1].isUnique).toBe(false);
    expect(result.warnings.some((warning) => warning.message.includes("Composite UNIQUE"))).toBe(true);
  });

  it("CREATE UNIQUE INDEX를 컬럼에 매핑하고 일반 INDEX는 무시한다", () => {
    const ddl = `
      CREATE TABLE public.users (email VARCHAR(255), phone VARCHAR(20));
      CREATE UNIQUE INDEX ux_users_email ON public.users (email);
      CREATE INDEX ix_users_phone ON public.users (phone);
    `;
    const result = parseDDL(ddl);
    const [email, phone] = result.schema.entities[0].columns;

    expect(result.errors).toHaveLength(0);
    expect(email.isUnique).toBe(true);
    expect(phone.isUnique).toBe(false);
  });

  it("복합 UNIQUE INDEX를 개별 컬럼 UNIQUE로 왜곡하지 않는다", () => {
    const result = parseDDL(`
      CREATE TABLE users (email VARCHAR(255), phone VARCHAR(20));
      CREATE UNIQUE INDEX ux_users_email_phone ON users (email, phone);
    `);

    expect(result.schema.entities[0].columns.every((column) => !column.isUnique)).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes("Composite UNIQUE"))).toBe(true);
  });

  it("partial UNIQUE INDEX를 전역 컬럼 UNIQUE로 왜곡하지 않는다", () => {
    const result = parseDDL(`
      CREATE TABLE users (email VARCHAR(255), deleted_at TIMESTAMP);
      CREATE UNIQUE INDEX ux_active_email ON users (email) WHERE deleted_at IS NULL;
    `);

    expect(result.schema.entities[0].columns[0].isUnique).toBe(false);
    expect(result.warnings.some((warning) => warning.message.includes("Unsupported UNIQUE INDEX"))).toBe(true);
  });

  it("FOREIGN KEY 테이블 레벨", () => {
    const ddl = `
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        user_id INT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `;
    const result = parseDDL(ddl);
    expect(result.schema.relations).toHaveLength(1);
    const rel = result.schema.relations[0];
    expect(rel.cardinality).toBe("N:1");
    expect(rel.source).toBe("ddl");
  });

  it("인라인 REFERENCES", () => {
    const ddl = `
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (
        id INT PRIMARY KEY,
        user_id INT REFERENCES users(id)
      );
    `;
    const result = parseDDL(ddl);
    expect(result.schema.relations).toHaveLength(1);
  });

  it("인라인 REFERENCES 뒤의 ON DELETE/UPDATE 액션이 컬럼 수정자를 오염시키지 않는다", () => {
    const result = parseDDL(`CREATE TABLE t (
      col INT NOT NULL REFERENCES u(id) ON DELETE SET NULL,
      status_id INT NOT NULL DEFAULT 1 REFERENCES s(id) ON UPDATE CASCADE ON DELETE SET DEFAULT
    );`);
    const [col, status] = result.schema.entities[0].columns;
    // "SET NULL"의 NULL이 nullable을 되돌리면 안 된다.
    expect(col.nullable).toBe(false);
    expect(col.isForeignKey).toBe(true);
    // "SET DEFAULT"의 DEFAULT가 기존 default 값을 지우면 안 된다.
    expect(status.defaultValue).toBe("1");
    expect(status.nullable).toBe(false);
  });

  it("REFERENCES 뒤의 bare DEFAULT/NOT NULL 수정자는 (ON 없이) 그대로 유지된다", () => {
    const result = parseDDL(`CREATE TABLE t (
      a INT REFERENCES u(id) DEFAULT 5,
      b INT REFERENCES u(id) NOT NULL
    );`);
    const [a, b] = result.schema.entities[0].columns;
    expect(a.defaultValue).toBe("5");
    expect(b.nullable).toBe(false);
  });

  it("FK 액션 절 뒤에 오는 DEFAULT/NOT NULL 수정자를 보존한다", () => {
    const result = parseDDL(`CREATE TABLE t (
      a INT REFERENCES u(id) ON DELETE CASCADE DEFAULT 5,
      b INT REFERENCES u(id) ON UPDATE RESTRICT NOT NULL,
      c INT REFERENCES u(id) ON DELETE NO ACTION ON UPDATE SET NULL DEFAULT 7
    );`);
    expect(result.errors).toHaveLength(0);
    const [a, b, c] = result.schema.entities[0].columns;
    // 액션 절은 구조적으로만 소비되고, 그 뒤의 컬럼 수정자는 살아남아야 한다.
    expect(a.defaultValue).toBe("5");
    expect(a.isForeignKey).toBe(true);
    expect(b.nullable).toBe(false);
    expect(c.defaultValue).toBe("7");
  });

  it("MATCH 절이 낀 FK 액션도 구조적으로 소비된다", () => {
    const result = parseDDL(`CREATE TABLE t (
      a INT NOT NULL REFERENCES u(id) MATCH FULL ON DELETE SET NULL,
      b INT REFERENCES u(id) MATCH SIMPLE ON UPDATE CASCADE DEFAULT 3
    );`);
    const [a, b] = result.schema.entities[0].columns;
    // MATCH를 남겨두면 액션의 꼬리 NULL이 nullability를 오염시킨다.
    expect(a.nullable).toBe(false);
    expect(a.isForeignKey).toBe(true);
    expect(b.defaultValue).toBe("3");
  });

  it("테이블 레벨 FK의 MATCH 절이 유령 컬럼을 만들지 않는다", () => {
    const result = parseDDL(`CREATE TABLE u (id INT PRIMARY KEY);
    CREATE TABLE t (
      a INT,
      FOREIGN KEY (a) REFERENCES u(id) MATCH FULL ON DELETE CASCADE
    );`);
    const table = result.schema.entities.find((e) => e.name === "t")!;
    expect(table.columns.map((c) => c.name)).toEqual(["a"]);
    expect(result.schema.relations).toHaveLength(1);
  });

  it("ALTER TABLE FK", () => {
    const ddl = `
      CREATE TABLE public.users (id INT PRIMARY KEY);
      CREATE TABLE public.orders (id INT PRIMARY KEY, user_id INT);
      ALTER TABLE public.orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES public.users(id);
    `;
    const result = parseDDL(ddl);
    expect(result.schema.relations).toHaveLength(1);
    expect(result.schema.relations[0].name).toBe("fk_user");
  });

  it("ALTER TABLE ADD COLUMN on an existing CREATE adds the column", () => {
    const result = parseDDL(`
      CREATE TABLE users (id INT PRIMARY KEY);
      ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL UNIQUE;
    `);

    const users = result.schema.entities[0];
    expect(result.errors).toHaveLength(0);
    expect(result.alters).toHaveLength(0);
    expect(users.columns.map((column) => column.name)).toEqual(["id", "email"]);
    expect(users.columns[1].type).toBe("VARCHAR(255)");
    expect(users.columns[1].nullable).toBe(false);
    expect(users.columns[1].isUnique).toBe(true);
  });

  it("ALTER TABLE column directives without CREATE are returned as alters", () => {
    const result = parseDDL(`
      ALTER TABLE users ADD COLUMN nickname VARCHAR(50);
      ALTER TABLE users DROP COLUMN old_name;
      ALTER TABLE users MODIFY COLUMN email TEXT NOT NULL;
      ALTER TABLE users CHANGE COLUMN nickname display_name VARCHAR(80);
    `);

    expect(result.schema.entities).toHaveLength(0);
    expect(result.alters.map((alter) => alter.kind)).toEqual([
      "addColumn",
      "dropColumn",
      "modifyColumn",
      "renameColumn",
    ]);
  });

  it("ALTER TABLE ADD CONSTRAINT non-FK is skipped instead of parsed as a column", () => {
    const result = parseDDL(`
      CREATE TABLE users (id INT, email TEXT);
      ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);
    `);

    expect(result.schema.entities[0].columns.map((column) => column.name)).toEqual(["id", "email"]);
    expect(result.warnings.some((warning) => warning.message.includes("unsupported ADD CONSTRAINT"))).toBe(true);
  });

  it("여러 테이블", () => {
    const ddl = `
      CREATE TABLE a (id INT);
      CREATE TABLE b (id INT);
      CREATE TABLE c (id INT);
    `;
    const result = parseDDL(ddl);
    expect(result.schema.entities).toHaveLength(3);
  });

  it("미종료 문자열 리터럴은 오류로 표시하고 다음 문장을 계속 파싱한다", () => {
    const result = parseDDL(`
      CREATE TABLE broken (note TEXT DEFAULT 'oops
      CREATE TABLE survived (id INT);
    `);

    expect(result.errors.some((error) => error.message.includes("Unterminated string literal"))).toBe(true);
    expect(result.schema.entities.some((entity) => entity.name === "survived")).toBe(true);
  });

  it("DEFAULT 함수·캐스트·음수 표현식을 한 단위로 보존한다", () => {
    const result = parseDDL(`
      CREATE TABLE defaults (
        created_at TIMESTAMP DEFAULT now() NOT NULL,
        delta INT DEFAULT -1,
        label TEXT DEFAULT 'a'::text,
        wrapped INT DEFAULT (1 + 2)
      );
    `);

    const columns = result.schema.entities[0].columns;
    expect(columns[0].defaultValue).toBe("now()");
    expect(columns[0].nullable).toBe(false);
    expect(columns[1].defaultValue).toBe("-1");
    expect(columns[2].defaultValue).toBe("'a'::text");
    expect(columns[3].defaultValue).toBe("(1+2)");
  });

  it("DEFAULT는 MySQL의 ON UPDATE 절에서 멈춘다", () => {
    const result = parseDDL(
      `CREATE TABLE t (updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, id INT);`,
    );
    expect(result.errors).toHaveLength(0);
    const columns = result.schema.entities[0].columns;
    expect(columns[0].defaultValue).toBe("CURRENT_TIMESTAMP");
    expect(columns.map((c) => c.name)).toEqual(["updated_at", "id"]);
  });

  it("이스케이프된 작은따옴표를 DEFAULT 문자열 안에 보존한다", () => {
    const result = parseDDL(`CREATE TABLE quotes (label TEXT DEFAULT 'It''s ok');`);
    expect(result.errors).toHaveLength(0);
    expect(result.schema.entities[0].columns[0].defaultValue).toBe("'It''s ok'");
  });

  it("대소문자 무관", () => {
    const ddl = `create table Users (Id int primary key);`;
    const result = parseDDL(ddl);
    expect(result.schema.entities[0].name).toBe("Users");
    expect(result.schema.entities[0].columns[0].isPrimaryKey).toBe(true);
  });

  it("비인용 Unicode 테이블·컬럼 식별자를 파싱한다", () => {
    const result = parseDDL("CREATE TABLE 사용자 (아이디 INT, 이름 TEXT);");

    expect(result.errors).toHaveLength(0);
    expect(result.schema.entities[0].name).toBe("사용자");
    expect(result.schema.entities[0].columns.map((column) => column.name)).toEqual(["아이디", "이름"]);
  });

  it("부분 성공 - 알 수 없는 구문은 건너뜀", () => {
    const ddl = `
      CREATE TABLE users (id INT);
      GRANT SELECT ON users TO public;
      CREATE TABLE orders (id INT);
    `;
    const result = parseDDL(ddl);
    expect(result.schema.entities).toHaveLength(2);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("schema-qualified CREATE TABLE imports the table name without silently dropping it", () => {
    const result = parseDDL(`CREATE TABLE public.users (id INT PRIMARY KEY);`);

    expect(result.errors).toHaveLength(0);
    expect(result.schema.entities.map((entity) => entity.name)).toEqual(["users"]);
  });

  it("keeps unresolved FK descriptors without returning dangling relation ids", () => {
    const result = parseDDL(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (
        user_id INT,
        FOREIGN KEY (user_id) REFERENCES users(missing)
      );
      CREATE TABLE audits (
        actor_id INT,
        FOREIGN KEY (actor_id) REFERENCES missing_users(id)
      );
    `);

    expect(result.schema.relations).toHaveLength(0);
    expect(result.foreignKeys).toHaveLength(2);
    expect(result.foreignKeys.map((foreignKey) => foreignKey.targetTable)).toEqual([
      "users",
      "missing_users",
    ]);
    expect(result.foreignKeys.every((foreignKey) => foreignKey.line > 1)).toBe(true);
  });

  it("ALTER TABLE FK without a matching CREATE is retained for Smart Merge", () => {
    const result = parseDDL(`ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);`);

    expect(result.schema.relations).toHaveLength(0);
    expect(result.foreignKeys).toEqual([
      {
        sourceTable: "orders",
        sourceColumn: "user_id",
        targetTable: "users",
        targetColumn: "id",
        cardinality: "N:1",
        name: "fk_user",
        line: 1,
      },
    ]);
  });

  it("composite foreign keys are skipped with a warning instead of partially parsed", () => {
    const result = parseDDL(`
      CREATE TABLE users (id INT, org_id INT);
      CREATE TABLE orders (
        user_id INT,
        org_id INT,
        CONSTRAINT fk_user FOREIGN KEY (user_id, org_id) REFERENCES users(id, org_id)
      );
    `);

    const orders = result.schema.entities.find((entity) => entity.name === "orders");
    expect(result.schema.relations).toHaveLength(0);
    expect(orders?.columns.map((column) => column.name)).toEqual(["user_id", "org_id"]);
    expect(result.warnings.some((warning) => warning.message.includes("Composite FOREIGN KEY"))).toBe(true);
  });

  it("schema-qualified COMMENT ON TABLE and bracket identifiers are parsed", () => {
    const result = parseDDL(`
      CREATE TABLE [User] ([id] INT PRIMARY KEY);
      CREATE TABLE public.users (id INT);
      COMMENT ON TABLE public.users IS 'it''s ok';
    `);

    expect(result.errors).toHaveLength(0);
    expect(result.schema.entities.map((entity) => entity.name)).toEqual(["User", "users"]);
    expect(result.schema.entities[0].columns[0].name).toBe("id");
    expect(result.schema.entities[1].comment).toBe("it's ok");
  });

  it("generator-escaped double quotes in identifiers round-trip without dropping the table", () => {
    const schema = createSchema({ name: "quoted-identifiers" });
    schema.entities = [
      createEntity({
        name: 'order"items',
        columns: [createColumn({ name: 'col"name', type: "TEXT" })],
      }),
    ];

    const result = parseDDL(generateDDL(schema));

    expect(result.errors).toHaveLength(0);
    expect(result.schema.entities).toHaveLength(1);
    expect(result.schema.entities[0].name).toBe('order"items');
    expect(result.schema.entities[0].columns[0].name).toBe('col"name');
  });

  it("generator UNIQUE constraints round-trip without being dropped", () => {
    const schema = createSchema({ name: "unique-column" });
    schema.entities = [
      createEntity({
        name: "users",
        columns: [createColumn({ name: "email", type: "VARCHAR(255)", isUnique: true })],
      }),
    ];

    const ddl = generateDDL(schema);
    const result = parseDDL(ddl);

    expect(ddl).toContain("email VARCHAR(255) UNIQUE");
    expect(result.schema.entities[0].columns[0].isUnique).toBe(true);
  });

  it("SQL Server bracket identifiers unescape doubled closing brackets", () => {
    const result = parseDDL("CREATE TABLE [order]]items] ([col]]name] INT);");

    expect(result.errors).toHaveLength(0);
    expect(result.schema.entities).toHaveLength(1);
    expect(result.schema.entities[0].name).toBe("order]items");
    expect(result.schema.entities[0].columns[0].name).toBe("col]name");
  });

  it("미종료 quoted identifier를 오류로 보고한다", () => {
    const result = parseDDL('CREATE TABLE "unterminated (id INT);');

    expect(result.schema.entities).toHaveLength(0);
    expect(result.errors.some((error) => error.message.includes("Unterminated quoted identifier"))).toBe(true);
  });

  it("schema-qualified COMMENT ON COLUMN is parsed", () => {
    const result = parseDDL(`
      CREATE TABLE public.users (id INT);
      COMMENT ON COLUMN public.users.id IS 'schema col';
    `);

    const users = result.schema.entities.find((entity) => entity.name === "users");
    expect(users?.columns[0].comment).toBe("schema col");
  });

  it("FOREIGN KEY SET DEFAULT action is skipped instead of parsed as a column", () => {
    const result = parseDDL(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (
        user_id INT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET DEFAULT
      );
    `);

    const orders = result.schema.entities.find((entity) => entity.name === "orders");
    expect(result.schema.relations).toHaveLength(1);
    expect(orders?.columns.map((column) => column.name)).toEqual(["user_id"]);
  });

  it("resolves FOREIGN KEY source columns case-insensitively and drops missing sources", () => {
    const result = parseDDL(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (
        user_id INT,
        FOREIGN KEY (USER_ID) REFERENCES users(id),
        FOREIGN KEY (missing_id) REFERENCES users(id)
      );
    `);

    const orders = result.schema.entities.find((entity) => entity.name === "orders")!;
    expect(result.schema.relations).toHaveLength(1);
    expect(result.schema.relations[0].sourceColumnId).toBe(orders.columns[0].id);
    const warning = result.warnings.find((item) => item.message.includes("missing source column"));
    expect(warning).toMatchObject({ line: 6, snippet: "missing_id" });
  });

  it("resolves visually identical NFC and NFD foreign-key names", () => {
    const result = parseDDL(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE café_orders (user_id INT);
      ALTER TABLE café_orders ADD FOREIGN KEY (user_id) REFERENCES users(id);
    `);

    expect(result.schema.relations).toHaveLength(1);
  });

  it("preserves inline REFERENCES from ALTER TABLE ADD COLUMN", () => {
    const result = parseDDL(`
      CREATE TABLE users (id INT PRIMARY KEY);
      CREATE TABLE orders (id INT PRIMARY KEY);
      ALTER TABLE orders ADD COLUMN user_id INT REFERENCES users(id);
    `);

    const orders = result.schema.entities.find((entity) => entity.name === "orders")!;
    const userId = orders.columns.find((column) => column.name === "user_id");
    expect(userId?.isForeignKey).toBe(true);
    expect(result.schema.relations).toHaveLength(1);
    expect(result.schema.relations[0].sourceColumnId).toBe(userId?.id);
  });

  it("preserves supported multi-word SQL types", () => {
    const result = parseDDL(`
      CREATE TABLE metrics (
        ratio DOUBLE PRECISION,
        happened_at TIMESTAMP WITH TIME ZONE,
        label CHARACTER VARYING(120),
        count INT UNSIGNED
      );
    `);

    expect(result.schema.entities[0].columns.map((column) => column.type)).toEqual([
      "DOUBLE PRECISION",
      "TIMESTAMP WITH TIME ZONE",
      "CHARACTER VARYING(120)",
      "INT UNSIGNED",
    ]);
  });

  it("warns when additional comma-separated ALTER actions are skipped", () => {
    const result = parseDDL(`
      CREATE TABLE users (id INT PRIMARY KEY);
      ALTER TABLE users ADD COLUMN first_name TEXT, ADD COLUMN last_name TEXT;
    `);

    expect(result.schema.entities[0].columns.some((column) => column.name === "first_name")).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes("additional ALTER actions"))).toBe(true);
  });

  it("빈 입력", () => {
    const result = parseDDL("");
    expect(result.schema.entities).toEqual([]);
    expect(result.errors).toHaveLength(0);
  });

  it("blocks applying a partial parse when DDL contains errors", () => {
    const invalid = parseDDL("CREATE TABLE kept (id INT); CREATE TABLE broken (name 'unterminated");
    const valid = parseDDL("CREATE TABLE kept (id INT);");

    expect(invalid.errors.length).toBeGreaterThan(0);
    expect(canApplyDDLImport(true, invalid)).toBe(false);
    expect(canApplyDDLImport(true, valid)).toBe(true);
  });

  it("인라인 CHECK 제약 뒤의 컬럼을 계속 파싱한다", () => {
    const result = parseDDL(`CREATE TABLE t (id INT CHECK (id > 0), s TEXT);`);
    expect(result.errors).toHaveLength(0);
    const cols = result.schema.entities[0].columns.map((c) => c.name);
    expect(cols).toEqual(["id", "s"]);
  });

  it("중첩 괄호/IN 리스트를 가진 인라인 CHECK 뒤의 컬럼을 유지한다", () => {
    const nested = parseDDL(`CREATE TABLE t (id INT CHECK (id > (0)), s TEXT);`);
    expect(nested.schema.entities[0].columns.map((c) => c.name)).toEqual(["id", "s"]);

    const inList = parseDDL(`CREATE TABLE t (st TEXT CHECK (st IN ('a','b')), s TEXT);`);
    expect(inList.schema.entities[0].columns.map((c) => c.name)).toEqual(["st", "s"]);
  });

  it("컬럼 레벨 CONSTRAINT ... CHECK 뒤의 컬럼을 유지한다", () => {
    const result = parseDDL(`CREATE TABLE t (id INT CONSTRAINT c1 CHECK (id > 0), s TEXT);`);
    expect(result.schema.entities[0].columns.map((c) => c.name)).toEqual(["id", "s"]);
  });
});

describe("auto-increment 보존", () => {
  it("AUTO_INCREMENT 수정자 → isAutoIncrement 플래그", () => {
    const result = parseDDL("CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT);");
    expect(result.errors).toHaveLength(0);
    const [id, name] = result.schema.entities[0].columns;
    expect(id.isAutoIncrement).toBe(true);
    expect(id.nullable).toBe(false);
    expect(name.isAutoIncrement).toBeFalsy();
  });

  it("SERIAL 계열 타입 → 정수형 정규화 + 플래그 + NOT NULL", () => {
    const result = parseDDL("CREATE TABLE t (a SERIAL, b BIGSERIAL, c SMALLSERIAL);");
    const [a, b, c] = result.schema.entities[0].columns;
    expect(a.type).toBe("INTEGER");
    expect(b.type).toBe("BIGINT");
    expect(c.type).toBe("SMALLINT");
    for (const col of [a, b, c]) {
      expect(col.isAutoIncrement).toBe(true);
      expect(col.nullable).toBe(false);
    }
  });

  it("GENERATED BY DEFAULT AS IDENTITY → 플래그, defaultValue 오염 없음", () => {
    const result = parseDDL("CREATE TABLE t (id INT GENERATED BY DEFAULT AS IDENTITY, name TEXT);");
    const [id, name] = result.schema.entities[0].columns;
    expect(id.isAutoIncrement).toBe(true);
    expect(id.nullable).toBe(false);
    expect(id.defaultValue).toBeUndefined();
    expect(name.name).toBe("name");
  });

  it("GENERATED ALWAYS AS IDENTITY (START WITH 5) → 플래그 + 뒤 컬럼 유지", () => {
    const result = parseDDL("CREATE TABLE t (id BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 5), s TEXT);");
    const cols = result.schema.entities[0].columns;
    expect(cols.map((c) => c.name)).toEqual(["id", "s"]);
    expect(cols[0].isAutoIncrement).toBe(true);
  });

  it("GENERATED ALWAYS AS (expr) STORED 생성 컬럼 → 플래그 없음, 뒤 컬럼 유지", () => {
    const result = parseDDL("CREATE TABLE t (total INT GENERATED ALWAYS AS (a + b) STORED, s TEXT);");
    const cols = result.schema.entities[0].columns;
    expect(cols.map((c) => c.name)).toEqual(["total", "s"]);
    expect(cols[0].isAutoIncrement).toBeFalsy();
  });

  it("auto-increment는 방언 왕복에서 보존된다 (MySQL 입력 → 양쪽 방언 출력)", () => {
    const parsed = parseDDL("CREATE TABLE t (id INT AUTO_INCREMENT PRIMARY KEY);");
    const pg = generateDDL(parsed.schema, { dialect: "postgresql" });
    const my = generateDDL(parsed.schema, { dialect: "mysql" });
    expect(pg).toContain("id SERIAL PRIMARY KEY");
    expect(my).toContain("id INT NOT NULL AUTO_INCREMENT PRIMARY KEY");

    const reparsed = parseDDL(pg);
    expect(reparsed.schema.entities[0].columns[0].isAutoIncrement).toBe(true);
  });
});
