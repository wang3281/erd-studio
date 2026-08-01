export interface Token {
  type: "KEYWORD" | "IDENTIFIER" | "SYMBOL" | "LITERAL" | "WHITESPACE";
  value: string;
  position: number;
  unterminated?: boolean;
}

const SQL_KEYWORDS = new Set([
  "CREATE", "TABLE", "ALTER", "ADD", "CONSTRAINT", "FOREIGN", "KEY",
  "REFERENCES", "PRIMARY", "NOT", "NULL", "DEFAULT", "INT", "INTEGER",
  "BIGINT", "SMALLINT", "TINYINT", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC",
  "CHAR", "VARCHAR", "TEXT", "CLOB", "BLOB", "DATE", "TIME", "TIMESTAMP",
  "DATETIME", "BOOLEAN", "SERIAL", "BIGSERIAL", "UUID", "JSON", "JSONB",
  "UNIQUE", "INDEX", "CHECK", "ON", "DELETE", "UPDATE", "CASCADE",
  "SET", "RESTRICT", "NO", "ACTION", "IF", "EXISTS", "DROP",
  "INSERT", "INTO", "VALUES", "GRANT", "REVOKE", "AUTO_INCREMENT",
  "COMMENT", "COLUMN", "IS", "MODIFY", "CHANGE", "RENAME", "TO", "TYPE",
]);

const SYMBOLS = new Set([
  "(", ")", ",", ";", ".", "=", "+", "-", "*", "/", "%", ":",
  "[", "]", "<", ">", "!", "|", "&",
]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    // line comment --
    if (input[i] === "-" && input[i + 1] === "-") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }

    // block comment /* */
    if (input[i] === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length - 1 && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    // string literal
    if (input[i] === "'") {
      const start = i;
      i++;
      let terminated = false;
      while (i < input.length) {
        if (input[i] === "'") {
          if (input[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          terminated = true;
          break;
        }
        if (input[i] === "\n" || input[i] === "\r") break;
        i++;
      }
      tokens.push({
        type: "LITERAL",
        value: input.slice(start, i),
        position: start,
        ...(terminated ? {} : { unterminated: true }),
      });
      continue;
    }

    // SQL Server-style quoted identifier [name]
    if (input[i] === "[") {
      const start = i;
      i++;
      let inner = "";
      let terminated = false;
      while (i < input.length) {
        if (input[i] === "]") {
          if (input[i + 1] === "]") {
            inner += "]";
            i += 2;
            continue;
          }
          i++;
          terminated = true;
          break;
        }
        inner += input[i];
        i++;
      }
      if (terminated) {
        tokens.push({ type: "IDENTIFIER", value: inner, position: start });
        continue;
      }
      tokens.push({ type: "IDENTIFIER", value: inner, position: start, unterminated: true });
      continue;
    }

    // symbol
    if (SYMBOLS.has(input[i])) {
      tokens.push({ type: "SYMBOL", value: input[i], position: i });
      i++;
      continue;
    }

    // number literal
    if (/\d/.test(input[i])) {
      const start = i;
      while (i < input.length && /[\d.]/.test(input[i])) i++;
      tokens.push({ type: "LITERAL", value: input.slice(start, i), position: start });
      continue;
    }

    // word (keyword or identifier)
    const firstWordChar = String.fromCodePoint(input.codePointAt(i)!);
    if (/[\p{L}_]/u.test(firstWordChar)) {
      const start = i;
      i += firstWordChar.length;
      while (i < input.length) {
        const nextChar = String.fromCodePoint(input.codePointAt(i)!);
        if (!/[\p{L}\p{M}\p{N}_$]/u.test(nextChar)) break;
        i += nextChar.length;
      }
      const word = input.slice(start, i);
      const isKeyword = SQL_KEYWORDS.has(word.toUpperCase());
      tokens.push({
        type: isKeyword ? "KEYWORD" : "IDENTIFIER",
        value: word,
        position: start,
      });
      continue;
    }

    // quoted identifier "name" or `name`
    if (input[i] === '"' || input[i] === '`') {
      const quote = input[i];
      const start = i;
      i++;
      let inner = "";
      let terminated = false;
      while (i < input.length) {
        if (input[i] === quote) {
          if (input[i + 1] === quote) {
            inner += quote;
            i += 2;
            continue;
          }
          i++;
          terminated = true;
          break;
        }
        inner += input[i];
        i++;
      }
      tokens.push({
        type: "IDENTIFIER",
        value: inner,
        position: start,
        ...(terminated ? {} : { unterminated: true }),
      });
      continue;
    }

    // unknown char - skip
    i++;
  }

  return tokens;
}
