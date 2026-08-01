import type { Token } from "./tokenizer";
import type {
  AlterDirective,
  Entity,
  Column,
  Relation,
  ParseError,
  ParseWarning,
  ParsedForeignKey,
} from "../model/types";
import { createColumn, createEntity, createRelation } from "../model/factory";
import { readColumnType, readDefaultExpressionTokens } from "./tokenReaders";

interface ParserState {
  tokens: Token[];
  pos: number;
  entities: Entity[];
  relations: Relation[];
  alters: AlterDirective[];
  foreignKeys: ParsedForeignKey[];
  errors: ParseError[];
  warnings: ParseWarning[];
  input: string;
}

function peek(state: ParserState): Token | null {
  return state.pos < state.tokens.length ? state.tokens[state.pos] : null;
}

function advance(state: ParserState): Token | null {
  if (state.pos < state.tokens.length) {
    return state.tokens[state.pos++];
  }
  return null;
}

function matchKeyword(state: ParserState, keyword: string): boolean {
  const t = peek(state);
  return t !== null && t.type === "KEYWORD" && t.value.toUpperCase() === keyword;
}

// Like matchKeyword but also accepts IDENTIFIER tokens, for SQL words that are
// not in the tokenizer's keyword list (e.g. GENERATED, IDENTITY).
function matchWord(state: ParserState, word: string): boolean {
  const t = peek(state);
  return t !== null && (t.type === "KEYWORD" || t.type === "IDENTIFIER") && t.value.toUpperCase() === word;
}

function expectKeyword(state: ParserState, keyword: string): boolean {
  if (matchKeyword(state, keyword)) {
    advance(state);
    return true;
  }
  return false;
}

function matchSymbol(state: ParserState, symbol: string): boolean {
  const t = peek(state);
  return t !== null && t.type === "SYMBOL" && t.value === symbol;
}

function expectSymbol(state: ParserState, symbol: string): boolean {
  if (matchSymbol(state, symbol)) {
    advance(state);
    return true;
  }
  return false;
}

function readIdentifier(state: ParserState): string | null {
  const t = peek(state);
  if (t && (t.type === "IDENTIFIER" || t.type === "KEYWORD")) {
    advance(state);
    return t.value;
  }
  return null;
}

function readQualifiedIdentifier(state: ParserState): string | null {
  const first = readIdentifier(state);
  if (!first) return null;
  let name = first;
  while (matchSymbol(state, ".")) {
    advance(state);
    const part = readIdentifier(state);
    if (!part) break;
    name = part;
  }
  return name;
}

function readSqlStringLiteral(state: ParserState): string | null {
  const t = peek(state);
  if (!t || t.type !== "LITERAL") return null;
  advance(state);
  return t.value.replace(/^'|'$/g, "").replace(/''/g, "'");
}

function getLineNumber(input: string, position: number): number {
  return input.substring(0, position).split("\n").length;
}

function addWarning(state: ParserState, position: number, message: string, snippet: string): void {
  state.warnings.push({ line: getLineNumber(state.input, position), message, snippet });
}

function normName(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function findEntityByName(state: ParserState, tableName: string): Entity | undefined {
  return state.entities.find((entity) => normName(entity.name) === normName(tableName));
}

function findColumnByName(entity: Entity, columnName: string): Column | undefined {
  return entity.columns.find((column) => normName(column.name) === normName(columnName));
}

function readIdentifierList(state: ParserState): string[] | null {
  if (!expectSymbol(state, "(")) return null;

  const names: string[] = [];
  while (state.pos < state.tokens.length && !matchSymbol(state, ")")) {
    const name = readIdentifier(state);
    if (!name) return null;
    names.push(name);

    if (matchSymbol(state, ",")) {
      advance(state);
      continue;
    }

    if (!matchSymbol(state, ")")) return null;
  }

  if (!expectSymbol(state, ")") || names.length === 0) return null;
  return names;
}

// One referential action: CASCADE | RESTRICT | NO ACTION | SET NULL | SET DEFAULT.
function skipReferentialAction(state: ParserState): void {
  if (expectKeyword(state, "CASCADE") || expectKeyword(state, "RESTRICT")) return;
  if (matchKeyword(state, "NO")) {
    advance(state);
    expectKeyword(state, "ACTION");
    return;
  }
  if (matchKeyword(state, "SET")) {
    advance(state);
    if (!expectKeyword(state, "NULL")) expectKeyword(state, "DEFAULT");
  }
}

const FK_MATCH_TYPES = new Set(["SIMPLE", "FULL", "PARTIAL"]);

// Consume repeated `[MATCH SIMPLE|FULL|PARTIAL] ON DELETE|UPDATE <action>`
// clauses. Parses the clause structure instead of eating a keyword set, so a
// bare DEFAULT/NOT NULL column modifier after the FK actions is left for the
// column-modifier loop. MATCH must be consumed here too: left behind, its
// action's trailing NULL/DEFAULT would corrupt column metadata.
function skipForeignKeyActions(state: ParserState): void {
  for (;;) {
    if (matchWord(state, "MATCH")) {
      const next = state.tokens[state.pos + 1];
      const matchType =
        next && (next.type === "KEYWORD" || next.type === "IDENTIFIER") ? next.value.toUpperCase() : "";
      if (!FK_MATCH_TYPES.has(matchType)) return;
      advance(state);
      advance(state);
      continue;
    }
    if (!matchKeyword(state, "ON")) return;
    const next = state.tokens[state.pos + 1];
    const verb = next && next.type === "KEYWORD" ? next.value.toUpperCase() : "";
    if (verb !== "DELETE" && verb !== "UPDATE") return;
    advance(state);
    advance(state);
    skipReferentialAction(state);
  }
}

function readDefaultExpression(state: ParserState): string | undefined {
  const result = readDefaultExpressionTokens(state.tokens, state.pos);
  state.pos = result.nextPosition;
  return result.value;
}

// Consume a balanced parenthesised group starting at the current "(" token.
// Used to skip inline constraint expressions (e.g. CHECK (id > 0)) so their
// inner ")" is not mistaken for the end of the column list. No-op if the
// current token is not "(".
function skipBalancedParens(state: ParserState): void {
  if (!matchSymbol(state, "(")) return;
  let depth = 0;
  while (state.pos < state.tokens.length) {
    const token = advance(state);
    if (!token) break;
    if (token.type === "SYMBOL" && token.value === "(") depth++;
    else if (token.type === "SYMBOL" && token.value === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
}

function skipToNextStatement(state: ParserState): void {
  while (state.pos < state.tokens.length) {
    const t = state.tokens[state.pos];
    if (t.type === "SYMBOL" && t.value === ";") {
      state.pos++;
      return;
    }
    if (t.type === "KEYWORD" && (t.value.toUpperCase() === "CREATE" || t.value.toUpperCase() === "ALTER")) {
      return;
    }
    state.pos++;
  }
}

function parseColumnType(state: ParserState): string {
  const result = readColumnType(state.tokens, state.pos);
  if (!result) return "UNKNOWN";
  state.pos = result.nextPosition;
  return result.value;
}

const SERIAL_TYPE_BASE: Record<string, string> = {
  SERIAL: "INTEGER",
  BIGSERIAL: "BIGINT",
  SMALLSERIAL: "SMALLINT",
};

function parseColumnDefinition(state: ParserState): {
  column: Column;
  inlineRef: { refTable: string; refColumn: string; line: number } | null;
} | null {
  const colName = readIdentifier(state);
  if (!colName) return null;

  let colType = parseColumnType(state);
  let nullable = true;
  let isPK = false;
  let isForeignKey = false;
  let isUnique = false;
  let isAutoIncrement = false;
  let defaultValue: string | undefined;
  let comment: string | undefined;
  let inlineRef: { refTable: string; refColumn: string; line: number } | null = null;

  // PostgreSQL serial pseudo-types are sugar for an integer type plus an
  // auto-generated sequence; normalize to the base type and keep the flag so
  // dialect-aware export can re-emit them. Serial columns are implicitly NOT NULL.
  const serialBase = SERIAL_TYPE_BASE[colType.toUpperCase()];
  if (serialBase) {
    colType = serialBase;
    isAutoIncrement = true;
    nullable = false;
  }

  // column modifiers
  while (state.pos < state.tokens.length && !matchSymbol(state, ",") && !matchSymbol(state, ")") && !matchSymbol(state, ";")) {
    if (matchKeyword(state, "CREATE") || matchKeyword(state, "ALTER")) break;
    if (matchKeyword(state, "NOT")) {
      advance(state);
      if (expectKeyword(state, "NULL")) {
        nullable = false;
      }
      continue;
    }
    if (matchKeyword(state, "NULL")) {
      advance(state);
      nullable = true;
      continue;
    }
    if (matchKeyword(state, "PRIMARY")) {
      advance(state);
      expectKeyword(state, "KEY");
      isPK = true;
      nullable = false;
      continue;
    }
    if (matchKeyword(state, "DEFAULT")) {
      advance(state);
      defaultValue = readDefaultExpression(state);
      continue;
    }
    if (matchKeyword(state, "REFERENCES")) {
      const referenceToken = advance(state)!;
      isForeignKey = true;
      const refTable = readQualifiedIdentifier(state);
      if (expectSymbol(state, "(")) {
        const refCol = readIdentifier(state);
        expectSymbol(state, ")");
        if (refTable && refCol) {
          inlineRef = {
            refTable,
            refColumn: refCol,
            line: getLineNumber(state.input, referenceToken.position),
          };
        }
      }
      skipForeignKeyActions(state);
      continue;
    }
    if (matchKeyword(state, "COMMENT")) {
      advance(state);
      const parsedComment = readSqlStringLiteral(state);
      if (parsedComment !== null) {
        comment = parsedComment;
      }
      continue;
    }
    if (matchKeyword(state, "UNIQUE")) {
      advance(state);
      isUnique = true;
      continue;
    }
    if (matchKeyword(state, "AUTO_INCREMENT") || matchKeyword(state, "SERIAL")) {
      advance(state);
      isAutoIncrement = true;
      nullable = false; // auto-increment columns are implicitly NOT NULL
      continue;
    }
    // PostgreSQL identity: GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY [(...)].
    // Must be consumed as a unit — otherwise the DEFAULT branch above swallows
    // "AS IDENTITY" into defaultValue. GENERATED ALWAYS AS (expr) [STORED]
    // (a generated column) falls through to the balanced-paren skip unflagged.
    if (matchWord(state, "GENERATED")) {
      advance(state);
      if (matchWord(state, "ALWAYS")) {
        advance(state);
      } else if (matchWord(state, "BY")) {
        advance(state);
        if (matchKeyword(state, "DEFAULT")) advance(state);
      }
      if (matchWord(state, "AS")) advance(state);
      if (matchWord(state, "IDENTITY")) {
        advance(state);
        isAutoIncrement = true;
        nullable = false; // identity columns are implicitly NOT NULL
      }
      continue;
    }
    // Inline column constraint with a parenthesised expression, e.g.
    // `id INT CHECK (id > 0)` or `... CONSTRAINT c CHECK (...)`. The expression's
    // parentheses must be consumed as a balanced group; otherwise the inner ")"
    // is misread as the end of the column list and every following column is
    // silently dropped.
    if (matchKeyword(state, "CHECK")) {
      advance(state);
      skipBalancedParens(state);
      continue;
    }
    // A stray "(" here belongs to some constraint expression we don't model;
    // skip it as a balanced group rather than stepping one token in (which
    // would let its closing ")" terminate the column list prematurely).
    if (matchSymbol(state, "(")) {
      skipBalancedParens(state);
      continue;
    }
    // unknown modifier - skip
    advance(state);
  }

  return {
    column: createColumn({
      name: colName,
      type: colType,
      nullable,
      isPrimaryKey: isPK,
      isForeignKey,
      isUnique,
      isAutoIncrement,
      defaultValue,
      comment,
    }),
    inlineRef,
  };
}

function upsertColumn(entity: Entity, column: Column): void {
  const existingIndex = entity.columns.findIndex((c) => normName(c.name) === normName(column.name));
  if (existingIndex >= 0) {
    entity.columns[existingIndex] = { ...column, id: entity.columns[existingIndex].id };
    return;
  }
  entity.columns.push(column);
}

function removeColumn(entity: Entity, columnName: string): void {
  entity.columns = entity.columns.filter((column) => normName(column.name) !== normName(columnName));
}

function applyAlterToCreatedEntity(state: ParserState, alter: AlterDirective): boolean {
  const entity = findEntityByName(state, alter.tableName);
  if (!entity) return false;

  if (alter.kind === "addColumn" || alter.kind === "modifyColumn") {
    upsertColumn(entity, alter.column);
    return true;
  }
  if (alter.kind === "dropColumn") {
    removeColumn(entity, alter.columnName);
    return true;
  }
  const existing = findColumnByName(entity, alter.from);
  if (existing) {
    upsertColumn(entity, { ...alter.column, id: existing.id });
    if (normName(alter.from) !== normName(alter.column.name)) {
      removeColumn(entity, alter.from);
    }
  } else {
    upsertColumn(entity, alter.column);
  }
  return true;
}

function queueOrApplyAlter(state: ParserState, alter: AlterDirective): void {
  if (!applyAlterToCreatedEntity(state, alter)) {
    state.alters.push(alter);
  }
}

function warnAdditionalAlterActions(state: ParserState, tableName: string): void {
  if (matchSymbol(state, ",")) {
    addWarning(state, peek(state)?.position ?? 0, `ALTER TABLE ${tableName}: additional ALTER actions skipped`, tableName);
  }
}

function parseCreateTable(state: ParserState): void {
  // skip optional IF NOT EXISTS
  if (matchKeyword(state, "IF")) {
    advance(state);
    expectKeyword(state, "NOT");
    expectKeyword(state, "EXISTS");
  }

  const tableName = readQualifiedIdentifier(state);
  if (!tableName) {
    state.errors.push({
      line: getLineNumber(state.input, peek(state)?.position ?? 0),
      message: "Expected table name",
      snippet: "",
    });
    skipToNextStatement(state);
    return;
  }

  if (!expectSymbol(state, "(")) {
    skipToNextStatement(state);
    return;
  }

  const columns: Column[] = [];
  const tableLevelPKs: string[] = [];
  const tableLevelUniques: string[] = [];
  const tableLevelFKs: Array<{
    column: string;
    refTable: string;
    refColumn: string;
    name?: string;
    line: number;
  }> = [];

  while (state.pos < state.tokens.length && !matchSymbol(state, ")")) {
    if (matchKeyword(state, "CREATE") || matchKeyword(state, "ALTER")) {
      state.warnings.push({
        line: getLineNumber(state.input, peek(state)?.position ?? 0),
        message: `CREATE TABLE ${tableName}: statement ended before closing ')' - recovered at next statement`,
        snippet: tableName,
      });
      return;
    }
    // PRIMARY KEY (col, ...)
    if (matchKeyword(state, "PRIMARY")) {
      advance(state);
      expectKeyword(state, "KEY");
      if (expectSymbol(state, "(")) {
        while (!matchSymbol(state, ")") && state.pos < state.tokens.length) {
          const colName = readIdentifier(state);
          if (colName) tableLevelPKs.push(colName);
          expectSymbol(state, ",");
        }
        expectSymbol(state, ")");
      }
      expectSymbol(state, ",");
      continue;
    }

    // CONSTRAINT name FOREIGN KEY ...
    if (matchKeyword(state, "CONSTRAINT")) {
      const constraintToken = advance(state)!;
      const constraintName = readIdentifier(state);
      if (matchKeyword(state, "FOREIGN")) {
        advance(state);
        expectKeyword(state, "KEY");
        const fkCols = readIdentifierList(state);
        if (fkCols && expectKeyword(state, "REFERENCES")) {
          const refTable = readQualifiedIdentifier(state);
          const refCols = readIdentifierList(state);
          if (fkCols.length !== 1 || (refCols && refCols.length !== 1)) {
            state.warnings.push({
              line: getLineNumber(state.input, peek(state)?.position ?? 0),
              message: "Composite FOREIGN KEY ignored",
              snippet: constraintName ?? "FOREIGN KEY",
            });
          } else if (refTable && refCols) {
            tableLevelFKs.push({
              column: fkCols[0],
              refTable,
              refColumn: refCols[0],
              name: constraintName ?? undefined,
              line: getLineNumber(state.input, constraintToken.position),
            });
          }
        }
        skipForeignKeyActions(state);
      }
      expectSymbol(state, ",");
      continue;
    }

    // FOREIGN KEY (col) REFERENCES ...
    if (matchKeyword(state, "FOREIGN")) {
      const foreignToken = advance(state)!;
      expectKeyword(state, "KEY");
      const fkCols = readIdentifierList(state);
      if (fkCols && expectKeyword(state, "REFERENCES")) {
        const refTable = readQualifiedIdentifier(state);
        const refCols = readIdentifierList(state);
        if (fkCols.length !== 1 || (refCols && refCols.length !== 1)) {
          state.warnings.push({
            line: getLineNumber(state.input, peek(state)?.position ?? 0),
            message: "Composite FOREIGN KEY ignored",
            snippet: "FOREIGN KEY",
          });
        } else if (refTable && refCols) {
          tableLevelFKs.push({
            column: fkCols[0],
            refTable,
            refColumn: refCols[0],
            line: getLineNumber(state.input, foreignToken.position),
          });
        }
      }
      skipForeignKeyActions(state);
      expectSymbol(state, ",");
      continue;
    }

    // UNIQUE (...) at table level
    if (matchKeyword(state, "UNIQUE")) {
      const uniqueToken = advance(state)!;
      if (matchKeyword(state, "KEY") || matchKeyword(state, "INDEX")) {
        advance(state);
      }
      if (!matchSymbol(state, "(")) {
        readIdentifier(state);
      }

      const uniqueColumns = readIdentifierList(state);
      if (uniqueColumns) {
        if (uniqueColumns.length === 1) {
          tableLevelUniques.push(uniqueColumns[0]);
        } else {
          addWarning(state, uniqueToken.position, "Composite UNIQUE ignored", uniqueColumns.join(", "));
        }
      } else {
        skipToNextStatement(state);
        return;
      }
      expectSymbol(state, ",");
      continue;
    }

    // CHECK/INDEX/KEY - skip
    if (matchKeyword(state, "CHECK") || matchKeyword(state, "INDEX") || matchKeyword(state, "KEY")) {
      const kw = advance(state)!;
      state.warnings.push({
        line: getLineNumber(state.input, kw.position),
        message: `${kw.value.toUpperCase()} constraint ignored`,
        snippet: kw.value,
      });
      // skip until , or )
      let depth = 0;
      while (state.pos < state.tokens.length) {
        const t = peek(state)!;
        if (t.value === "(") depth++;
        if (t.value === ")") {
          if (depth === 0) break;
          depth--;
        }
        if (t.value === "," && depth === 0) break;
        advance(state);
      }
      expectSymbol(state, ",");
      continue;
    }

    const parsed = parseColumnDefinition(state);
    if (!parsed) {
      advance(state);
      continue;
    }
    const { column: col, inlineRef } = parsed;
    columns.push(col);

    if (inlineRef) {
      tableLevelFKs.push({
        column: col.name,
        refTable: inlineRef.refTable,
        refColumn: inlineRef.refColumn,
        line: inlineRef.line,
      });
    }

    expectSymbol(state, ",");
  }

  expectSymbol(state, ")");

  // table-level COMMENT = 'text' (MySQL)
  let tableComment: string | undefined;
  if (matchKeyword(state, "COMMENT")) {
    advance(state);
    expectSymbol(state, "=");
    const parsedComment = readSqlStringLiteral(state);
    if (parsedComment !== null) {
      tableComment = parsedComment;
    }
  }

  expectSymbol(state, ";");

  // apply table-level PKs
  for (const pkName of tableLevelPKs) {
    const col = columns.find((c) => normName(c.name) === normName(pkName));
    if (col) {
      col.isPrimaryKey = true;
      col.nullable = false;
    }
  }

  for (const uniqueName of tableLevelUniques) {
    const col = columns.find((c) => normName(c.name) === normName(uniqueName));
    if (col) {
      col.isUnique = true;
    }
  }

  const entity = createEntity({ name: tableName, comment: tableComment, columns });
  state.entities.push(entity);

  // resolve table-level FKs
  for (const fk of tableLevelFKs) {
    state.foreignKeys.push({
      sourceTable: tableName,
      sourceColumn: fk.column,
      targetTable: fk.refTable,
      targetColumn: fk.refColumn,
      cardinality: "N:1",
      name: fk.name,
      line: fk.line,
    });
    const srcCol = columns.find((c) => normName(c.name) === normName(fk.column));
    if (!srcCol) {
      state.warnings.push({
        line: fk.line,
        message: `FOREIGN KEY ignored: missing source column ${tableName}.${fk.column}`,
        snippet: fk.column,
      });
      continue;
    }
    srcCol.isForeignKey = true;

    // defer relation creation - will resolve after all tables parsed
    state.relations.push(
      createRelation({
        sourceEntityId: entity.id,
        sourceColumnId: srcCol.id,
        targetEntityId: `__unresolved__${fk.refTable}`,
        targetColumnId: `__unresolved__${fk.refColumn}`,
        cardinality: "N:1",
        source: "ddl",
        name: fk.name,
      })
    );
  }
}

function parseCreateIndex(state: ParserState): void {
  const indexPosition = peek(state)?.position ?? 0;
  let isUnique = false;
  if (matchKeyword(state, "UNIQUE")) {
    advance(state);
    isUnique = true;
  }

  if (!expectKeyword(state, "INDEX")) {
    skipToNextStatement(state);
    return;
  }

  if (matchKeyword(state, "IF")) {
    advance(state);
    expectKeyword(state, "NOT");
    expectKeyword(state, "EXISTS");
  }

  if (!matchKeyword(state, "ON")) {
    readIdentifier(state);
  }

  if (!expectKeyword(state, "ON")) {
    skipToNextStatement(state);
    return;
  }

  const tableName = readQualifiedIdentifier(state);
  const columnNames = tableName ? readIdentifierList(state) : null;
  const hasUnsupportedSuffix = peek(state) !== undefined && !matchSymbol(state, ";");
  skipToNextStatement(state);

  if (!isUnique) return;
  if (!tableName || !columnNames || hasUnsupportedSuffix) {
    addWarning(state, indexPosition, "Unsupported UNIQUE INDEX ignored", tableName ?? "UNIQUE INDEX");
    return;
  }
  if (columnNames.length !== 1) {
    addWarning(state, indexPosition, "Composite UNIQUE INDEX ignored", columnNames.join(", "));
    return;
  }

  const entity = findEntityByName(state, tableName);
  if (!entity) return;

  const column = findColumnByName(entity, columnNames[0]);
  if (column) {
    column.isUnique = true;
  }
}

function parseAlterTable(state: ParserState): void {
  const alterLine = getLineNumber(state.input, peek(state)?.position ?? 0);
  const tableName = readQualifiedIdentifier(state);
  if (!tableName) {
    skipToNextStatement(state);
    return;
  }

  if (expectKeyword(state, "ADD")) {
    let constraintName: string | undefined;
    if (matchKeyword(state, "CONSTRAINT")) {
      advance(state);
      constraintName = readIdentifier(state) ?? undefined;
    }

    if (matchKeyword(state, "FOREIGN")) {
      advance(state);
      expectKeyword(state, "KEY");

      if (!expectSymbol(state, "(")) {
        skipToNextStatement(state);
        return;
      }
      const fkCol = readIdentifier(state);
      expectSymbol(state, ")");

      if (!expectKeyword(state, "REFERENCES")) {
        skipToNextStatement(state);
        return;
      }
      const refTable = readQualifiedIdentifier(state);
      let refCol: string | null = null;
      if (expectSymbol(state, "(")) {
        refCol = readIdentifier(state);
        expectSymbol(state, ")");
      }

      warnAdditionalAlterActions(state, tableName);
      skipToNextStatement(state);

      if (fkCol && refTable && refCol) {
        state.foreignKeys.push({
          sourceTable: tableName,
          sourceColumn: fkCol,
          targetTable: refTable,
          targetColumn: refCol,
          cardinality: "N:1",
          name: constraintName,
          line: alterLine,
        });
        const srcEntity = findEntityByName(state, tableName);
        if (srcEntity) {
          const srcCol = findColumnByName(srcEntity, fkCol);
          if (!srcCol) {
            addWarning(state, 0, `FOREIGN KEY ignored: missing source column ${tableName}.${fkCol}`, fkCol);
            return;
          }
          srcCol.isForeignKey = true;

          state.relations.push(
            createRelation({
              sourceEntityId: srcEntity.id,
              sourceColumnId: srcCol.id,
              targetEntityId: `__unresolved__${refTable}`,
              targetColumnId: `__unresolved__${refCol}`,
              cardinality: "N:1",
              source: "ddl",
              name: constraintName,
            })
          );
        }
      }
      return;
    }

    if (constraintName) {
      state.warnings.push({
        line: getLineNumber(state.input, peek(state)?.position ?? 0),
        message: `ALTER TABLE ${tableName}: unsupported ADD CONSTRAINT skipped`,
        snippet: constraintName,
      });
      skipToNextStatement(state);
      return;
    }

    expectKeyword(state, "COLUMN");
    const parsed = parseColumnDefinition(state);
    warnAdditionalAlterActions(state, tableName);
    skipToNextStatement(state);
    if (parsed) {
      queueOrApplyAlter(state, { kind: "addColumn", tableName, column: parsed.column });
      if (parsed.inlineRef) {
        state.foreignKeys.push({
          sourceTable: tableName,
          sourceColumn: parsed.column.name,
          targetTable: parsed.inlineRef.refTable,
          targetColumn: parsed.inlineRef.refColumn,
          cardinality: "N:1",
          line: parsed.inlineRef.line,
        });
        const sourceEntity = findEntityByName(state, tableName);
        const sourceColumn = sourceEntity ? findColumnByName(sourceEntity, parsed.column.name) : undefined;
        if (sourceEntity && sourceColumn) {
          state.relations.push(createRelation({
            sourceEntityId: sourceEntity.id,
            sourceColumnId: sourceColumn.id,
            targetEntityId: `__unresolved__${parsed.inlineRef.refTable}`,
            targetColumnId: `__unresolved__${parsed.inlineRef.refColumn}`,
            cardinality: "N:1",
            source: "ddl",
          }));
        }
      }
    }
    return;
  }

  if (expectKeyword(state, "DROP")) {
    expectKeyword(state, "COLUMN");
    const columnName = readIdentifier(state);
    warnAdditionalAlterActions(state, tableName);
    skipToNextStatement(state);
    if (columnName) {
      queueOrApplyAlter(state, { kind: "dropColumn", tableName, columnName });
    }
    return;
  }

  if (expectKeyword(state, "MODIFY")) {
    expectKeyword(state, "COLUMN");
    const parsed = parseColumnDefinition(state);
    warnAdditionalAlterActions(state, tableName);
    skipToNextStatement(state);
    if (parsed) {
      queueOrApplyAlter(state, { kind: "modifyColumn", tableName, column: parsed.column });
    }
    return;
  }

  if (expectKeyword(state, "CHANGE")) {
    expectKeyword(state, "COLUMN");
    const from = readIdentifier(state);
    const parsed = parseColumnDefinition(state);
    warnAdditionalAlterActions(state, tableName);
    skipToNextStatement(state);
    if (from && parsed) {
      queueOrApplyAlter(state, { kind: "renameColumn", tableName, from, column: parsed.column });
    }
    return;
  }

  if (expectKeyword(state, "ALTER") || expectKeyword(state, "RENAME")) {
    state.warnings.push({
      line: getLineNumber(state.input, peek(state)?.position ?? 0),
      message: `ALTER TABLE ${tableName}: this ALTER form is not supported yet - skipped`,
      snippet: tableName,
    });
    skipToNextStatement(state);
    return;
  }

  state.warnings.push({
    line: getLineNumber(state.input, peek(state)?.position ?? 0),
    message: `ALTER TABLE ${tableName}: unsupported operation skipped`,
    snippet: tableName,
  });
  skipToNextStatement(state);
}

function resolveRelations(state: ParserState): void {
  const resolvedRelations: Relation[] = [];
  for (const rel of state.relations) {
    const sourceEntity = state.entities.find((entity) => entity.id === rel.sourceEntityId);
    const sourceColumn = sourceEntity?.columns.find((column) => column.id === rel.sourceColumnId);
    if (!sourceEntity || !sourceColumn) {
      addWarning(state, 0, "FOREIGN KEY ignored: missing source endpoint", rel.name ?? rel.sourceColumnId);
      continue;
    }
    if (rel.targetEntityId.startsWith("__unresolved__")) {
      const targetTableName = rel.targetEntityId.replace("__unresolved__", "");
      const targetEntity = findEntityByName(state, targetTableName);
      if (!targetEntity) {
        continue;
      }

      rel.targetEntityId = targetEntity.id;
      const targetColName = rel.targetColumnId.replace("__unresolved__", "");
      const targetCol = findColumnByName(targetEntity, targetColName);
      if (!targetCol) {
        continue;
      }
      rel.targetColumnId = targetCol.id;
    }
    resolvedRelations.push(rel);
  }
  state.relations = resolvedRelations;
}

export function parse(tokens: Token[], input: string): {
  entities: Entity[];
  relations: Relation[];
  alters: AlterDirective[];
  foreignKeys: ParsedForeignKey[];
  errors: ParseError[];
  warnings: ParseWarning[];
} {
  const state: ParserState = {
    tokens,
    pos: 0,
    entities: [],
    relations: [],
    alters: [],
    foreignKeys: [],
    errors: [],
    warnings: [],
    input,
  };

  for (const token of state.tokens) {
    if (token.unterminated) {
      state.errors.push({
        line: getLineNumber(input, token.position),
        message: token.type === "LITERAL" ? "Unterminated string literal" : "Unterminated quoted identifier",
        snippet: token.value,
      });
    }
  }

  while (state.pos < state.tokens.length) {
    if (matchKeyword(state, "CREATE")) {
      advance(state);
      if (matchKeyword(state, "TABLE")) {
        advance(state);
        parseCreateTable(state);
        continue;
      }
      if (matchKeyword(state, "INDEX") || matchKeyword(state, "UNIQUE")) {
        parseCreateIndex(state);
        continue;
      }
      skipToNextStatement(state);
      continue;
    }

    if (matchKeyword(state, "ALTER")) {
      advance(state);
      if (matchKeyword(state, "TABLE")) {
        advance(state);
        parseAlterTable(state);
        continue;
      }
      skipToNextStatement(state);
      continue;
    }

    // COMMENT ON TABLE/COLUMN ... IS 'text' (PostgreSQL/Oracle)
    if (matchKeyword(state, "COMMENT")) {
      advance(state);
      if (expectKeyword(state, "ON")) {
        if (matchKeyword(state, "TABLE")) {
          advance(state);
          const tblName = readQualifiedIdentifier(state);
          if (tblName && expectKeyword(state, "IS")) {
            const commentText = readSqlStringLiteral(state);
            if (commentText !== null) {
              const ent = findEntityByName(state, tblName);
              if (ent) ent.comment = commentText;
            }
          }
        } else if (matchKeyword(state, "COLUMN")) {
          advance(state);
          const parts: string[] = [];
          const first = readIdentifier(state);
          if (first) parts.push(first);
          while (matchSymbol(state, ".")) {
            advance(state);
            const part = readIdentifier(state);
            if (!part) break;
            parts.push(part);
          }
          const tblName = parts.length >= 2 ? parts[parts.length - 2] : null;
          const colName = parts.length >= 1 ? parts[parts.length - 1] : null;
          if (colName && expectKeyword(state, "IS")) {
            const commentText = readSqlStringLiteral(state);
            if (commentText !== null && tblName) {
              const ent = findEntityByName(state, tblName);
              if (ent) {
                const col = findColumnByName(ent, colName);
                if (col) col.comment = commentText;
              }
            }
          }
        }
      }
      skipToNextStatement(state);
      continue;
    }

    // unknown statement - warn and skip
    const t = advance(state)!;
    if (t.type === "KEYWORD" && !["SET", "NO", "ACTION", "CASCADE", "RESTRICT"].includes(t.value.toUpperCase())) {
      state.warnings.push({
        line: getLineNumber(input, t.position),
        message: `Unsupported statement starting with '${t.value}' - skipped`,
        snippet: t.value,
      });
    }
    if (t.type !== "SYMBOL" || t.value !== ";") {
      skipToNextStatement(state);
    }
  }

  resolveRelations(state);

  return {
    entities: state.entities,
    relations: state.relations,
    alters: state.alters,
    foreignKeys: state.foreignKeys,
    errors: state.errors,
    warnings: state.warnings,
  };
}
