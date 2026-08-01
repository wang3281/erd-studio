import type { ERDSchema, Entity, Column } from "../model/types";

export type SQLDialect = "postgresql" | "mysql";

export interface GenerateDDLOptions {
  dialect?: SQLDialect;
}

function escapeComment(text: string, dialect: SQLDialect): string {
  // MySQL treats backslash as an escape character inside string literals
  // (unless NO_BACKSLASH_ESCAPES is set); PostgreSQL does not.
  const base = dialect === "mysql" ? text.replace(/\\/g, "\\\\") : text;
  return base.replace(/'/g, "''");
}

const RESERVED_IDENTIFIERS = new Set([
  "ACTION", "ADD", "ALTER", "AUTO_INCREMENT", "BIGINT", "BIGSERIAL", "BLOB", "BOOLEAN",
  "CASCADE", "CHANGE", "CHAR", "CHECK", "CLOB", "COLUMN", "COMMENT", "CONSTRAINT",
  "CREATE", "DATE", "DATETIME", "DECIMAL", "DEFAULT", "DELETE", "DOUBLE", "DROP",
  "EXISTS", "FLOAT", "FOREIGN", "FROM", "GRANT", "GROUP", "IF", "INDEX", "INSERT",
  "INT", "INTEGER", "INTO", "IS", "JSON", "JSONB", "KEY", "MODIFY", "NO", "NOT",
  "NULL", "NUMERIC", "ON", "ORDER", "PRIMARY", "REFERENCES", "RENAME", "RESTRICT",
  "REVOKE", "SELECT", "SERIAL", "SET", "SMALLINT", "TABLE", "TEXT", "TIME", "TIMESTAMP",
  "TINYINT", "TO", "TYPE", "UNIQUE", "UPDATE", "UUID", "VALUES", "VARCHAR", "WHERE",
]);

function quoteIdentifier(name: string, dialect: SQLDialect): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED_IDENTIFIERS.has(name.toUpperCase())) {
    return name;
  }
  if (dialect === "mysql") {
    return `\`${name.replace(/`/g, "``")}\``;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

// PostgreSQL integer types that have a serial pseudo-type shorthand.
const PG_SERIAL_BY_BASE: Record<string, string> = {
  INT: "SERIAL",
  INTEGER: "SERIAL",
  BIGINT: "BIGSERIAL",
  SMALLINT: "SMALLSERIAL",
};

// MySQL unsigned integers exceed the range of the same-width signed
// PostgreSQL type, so they widen one step (pgloader's default casts).
const PG_UNSIGNED_WIDEN: Record<string, string> = {
  TINYINT: "SMALLINT",
  SMALLINT: "INTEGER",
  MEDIUMINT: "INTEGER",
  INT: "BIGINT",
  INTEGER: "BIGINT",
  BIGINT: "NUMERIC(20)",
};

const PG_SIGNED_INT_BASE: Record<string, string> = {
  TINYINT: "SMALLINT",
  SMALLINT: "SMALLINT",
  MEDIUMINT: "INTEGER",
  INT: "INTEGER",
  INTEGER: "INTEGER",
  BIGINT: "BIGINT",
};

// Map a MySQL-flavored type to its PostgreSQL equivalent. `check` carries an
// inline constraint when the type only translates with one (ENUM). Types that
// are valid in both dialects pass through untouched.
function mapTypeToPostgres(rawType: string, quotedName: string): { type: string; check?: string } {
  const type = rawType.trim();
  const upper = type.toUpperCase().replace(/\s+/g, " ");

  const enumMatch = /^ENUM\s*(\(.+\))$/i.exec(type.replace(/\s+/g, " "));
  if (enumMatch) {
    return { type: "TEXT", check: `CHECK (${quotedName} IN ${enumMatch[1]})` };
  }
  if (/^SET\s*\(.+\)$/i.test(upper)) return { type: "TEXT" };

  const unsigned = /^([A-Z]+)(\(\d+\))? UNSIGNED$/.exec(upper);
  if (unsigned) {
    const widened = PG_UNSIGNED_WIDEN[unsigned[1]];
    if (widened) return { type: widened };
    return { type: `${unsigned[1]}${unsigned[2] ?? ""}` };
  }

  if (upper === "TINYINT(1)") return { type: "BOOLEAN" };
  const intType = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)(\(\d+\))?$/.exec(upper);
  if (intType) {
    // INT/INTEGER/SMALLINT/BIGINT are valid PostgreSQL as-is; rewrite only
    // MySQL-specific bases and display widths like INT(11).
    const needsRewrite = intType[1] === "TINYINT" || intType[1] === "MEDIUMINT" || intType[2] !== undefined;
    return needsRewrite ? { type: PG_SIGNED_INT_BASE[intType[1]] } : { type };
  }

  const datetime = /^DATETIME(\(\d+\))?$/.exec(upper);
  if (datetime) return { type: `TIMESTAMP${datetime[1] ?? ""}` };
  if (upper === "DOUBLE") return { type: "DOUBLE PRECISION" };
  if (upper === "TINYTEXT" || upper === "MEDIUMTEXT" || upper === "LONGTEXT") return { type: "TEXT" };
  if (/^(TINY|MEDIUM|LONG)?BLOB$/.test(upper)) return { type: "BYTEA" };
  if (/^(VAR)?BINARY(\(\d+\))?$/.test(upper)) return { type: "BYTEA" };
  if (upper === "YEAR") return { type: "SMALLINT" };
  return { type };
}

// Map a PostgreSQL-flavored type to its MySQL equivalent.
function mapTypeToMysql(rawType: string): string {
  const type = rawType.trim();
  const upper = type.toUpperCase().replace(/\s+/g, " ");

  if (upper === "JSONB") return "JSON";
  if (upper === "UUID") return "CHAR(36)";
  if (upper === "BYTEA") return "BLOB";
  if (upper === "TIMESTAMPTZ") return "TIMESTAMP";
  const tsWithTz = /^TIMESTAMP(\(\d+\))? WITH TIME ZONE$/.exec(upper);
  if (tsWithTz) return `TIMESTAMP${tsWithTz[1] ?? ""}`;
  const tsWithoutTz = /^TIMESTAMP(\(\d+\))? WITHOUT TIME ZONE$/.exec(upper);
  if (tsWithoutTz) return `DATETIME${tsWithoutTz[1] ?? ""}`;
  const timeTz = /^TIME(\(\d+\))? WITH(OUT)? TIME ZONE$/.exec(upper);
  if (timeTz) return `TIME${timeTz[1] ?? ""}`;
  if (upper === "DOUBLE PRECISION") return "DOUBLE";
  return type;
}

function formatColumn(col: Column, emitInlinePK: boolean, dialect: SQLDialect): string {
  const quotedName = quoteIdentifier(col.name, dialect);
  let type: string;
  let checkSuffix = "";
  if (dialect === "postgresql") {
    const mapped = mapTypeToPostgres(col.type, quotedName);
    type = mapped.type;
    checkSuffix = mapped.check ?? "";
  } else {
    type = mapTypeToMysql(col.type);
  }

  let identitySuffix = "";
  let emitNotNull = !col.nullable;
  if (col.isAutoIncrement && dialect === "postgresql") {
    const serial = PG_SERIAL_BY_BASE[type.trim().toUpperCase()];
    if (serial) {
      type = serial;
      emitNotNull = false; // serial types are implicitly NOT NULL
    } else {
      identitySuffix = "GENERATED BY DEFAULT AS IDENTITY";
    }
  }

  const parts = [quotedName, type];
  if (emitNotNull) parts.push("NOT NULL");
  if (col.isAutoIncrement && dialect === "mysql") parts.push("AUTO_INCREMENT");
  if (identitySuffix) parts.push(identitySuffix);
  if (emitInlinePK && col.isPrimaryKey) parts.push("PRIMARY KEY");
  if (col.isUnique) parts.push("UNIQUE");
  if (col.defaultValue !== undefined && col.defaultValue !== "") {
    let defaultValue = col.defaultValue;
    // TINYINT(1) → BOOLEAN rewrites carry numeric defaults that PostgreSQL
    // rejects on a boolean column; translate the 0/1 idiom alongside the type.
    if (dialect === "postgresql" && type === "BOOLEAN" && col.type.toUpperCase() !== "BOOLEAN") {
      if (defaultValue === "1") defaultValue = "TRUE";
      else if (defaultValue === "0") defaultValue = "FALSE";
    }
    parts.push(`DEFAULT ${defaultValue}`);
  }
  if (checkSuffix) parts.push(checkSuffix);
  if (dialect === "mysql" && col.comment) {
    parts.push(`COMMENT '${escapeComment(col.comment, dialect)}'`);
  }
  return parts.join(" ");
}

export function generateDDL(schema: ERDSchema, options: GenerateDDLOptions = {}): string {
  const dialect = options.dialect ?? "postgresql";
  const quote = (name: string) => quoteIdentifier(name, dialect);
  const lines: string[] = [];
  const comments: string[] = [];

  for (const entity of schema.entities) {
    const pkCols = entity.columns.filter((c) => c.isPrimaryKey);
    const useInlinePK = pkCols.length <= 1;

    const colDefs = entity.columns.map((col) =>
      `  ${formatColumn(col, useInlinePK, dialect)}`,
    );

    if (!useInlinePK) {
      const pkNames = pkCols.map((c) => quote(c.name)).join(", ");
      colDefs.push(`  PRIMARY KEY (${pkNames})`);
    }

    lines.push(`CREATE TABLE ${quote(entity.name)} (`);
    lines.push(colDefs.join(",\n"));
    if (dialect === "mysql" && entity.comment) {
      lines.push(`) COMMENT='${escapeComment(entity.comment, dialect)}';\n`);
    } else {
      lines.push(");\n");
    }

    // PostgreSQL has no inline comment syntax; collect COMMENT ON statements.
    if (dialect === "postgresql") {
      if (entity.comment) {
        comments.push(`COMMENT ON TABLE ${quote(entity.name)} IS '${escapeComment(entity.comment, dialect)}';`);
      }
      for (const col of entity.columns) {
        if (col.comment) {
          comments.push(`COMMENT ON COLUMN ${quote(entity.name)}.${quote(col.name)} IS '${escapeComment(col.comment, dialect)}';`);
        }
      }
    }
  }

  const entityById = new Map<string, Entity>(
    schema.entities.map((e) => [e.id, e]),
  );

  for (const rel of schema.relations) {
    const src = entityById.get(rel.sourceEntityId);
    const tgt = entityById.get(rel.targetEntityId);
    if (!src || !tgt) continue;

    const srcCol = src.columns.find((c) => c.id === rel.sourceColumnId);
    const tgtCol = tgt.columns.find((c) => c.id === rel.targetColumnId);
    if (!srcCol || !tgtCol) continue;

    const constraintName = quote(rel.name || `fk_${src.name}_${srcCol.name}`);

    if (rel.source === "inferred") {
      lines.push(`-- Inferred FK (based on matching column name)`);
    }
    lines.push(
      `ALTER TABLE ${quote(src.name)} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${quote(srcCol.name)}) REFERENCES ${quote(tgt.name)} (${quote(tgtCol.name)});`,
    );
  }

  if (comments.length > 0) {
    lines.push("");
    lines.push(...comments);
  }

  return lines.join("\n") + "\n";
}
