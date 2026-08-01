import type { Token } from "./tokenizer";

export interface TokenRead<T> {
  value: T;
  nextPosition: number;
}

const DEFAULT_TERMINATOR_KEYWORDS = new Set([
  "NOT", "NULL", "PRIMARY", "UNIQUE", "REFERENCES", "COMMENT", "AUTO_INCREMENT",
  "CREATE", "ALTER",
  // MySQL: `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` — the ON UPDATE
  // clause is a separate column attribute, not part of the default expression.
  "ON",
]);

function isWord(token: Token | undefined): token is Token {
  return token?.type === "IDENTIFIER" || token?.type === "KEYWORD";
}

function consumeWords(tokens: Token[], position: number, words: string[]): TokenRead<string[]> | null {
  const consumed: string[] = [];
  let nextPosition = position;
  for (const word of words) {
    const token = tokens[nextPosition];
    if (!isWord(token) || token.value.toUpperCase() !== word) return null;
    consumed.push(token.value);
    nextPosition++;
  }
  return { value: consumed, nextPosition };
}

export function readColumnType(tokens: Token[], position: number): TokenRead<string> | null {
  const first = tokens[position];
  if (!isWord(first)) return null;

  let result = first.value;
  let nextPosition = position + 1;
  const normalizedType = first.value.toUpperCase();
  const immediateSuffix = normalizedType === "DOUBLE"
    ? consumeWords(tokens, nextPosition, ["PRECISION"])
    : normalizedType === "CHARACTER"
      ? consumeWords(tokens, nextPosition, ["VARYING"])
      : null;
  if (immediateSuffix) {
    result += ` ${immediateSuffix.value.join(" ")}`;
    nextPosition = immediateSuffix.nextPosition;
  }

  if (tokens[nextPosition]?.type === "SYMBOL" && tokens[nextPosition].value === "(") {
    nextPosition++;
    let depth = 1;
    const parts: string[] = ["("];
    while (nextPosition < tokens.length && depth > 0) {
      const token = tokens[nextPosition++];
      if (token.value === "(") depth++;
      if (token.value === ")") depth--;
      if (depth > 0) parts.push(token.value);
    }
    parts.push(")");
    result += parts.join("");
  }

  if (normalizedType === "TIMESTAMP" || normalizedType === "TIME") {
    const suffix = consumeWords(tokens, nextPosition, ["WITH", "TIME", "ZONE"])
      ?? consumeWords(tokens, nextPosition, ["WITHOUT", "TIME", "ZONE"]);
    if (suffix) {
      result += ` ${suffix.value.join(" ")}`;
      nextPosition = suffix.nextPosition;
    }
  }
  if (["INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT"].includes(normalizedType)) {
    const suffix = consumeWords(tokens, nextPosition, ["UNSIGNED"]);
    if (suffix) {
      result += ` ${suffix.value[0]}`;
      nextPosition = suffix.nextPosition;
    }
  }
  return { value: result, nextPosition };
}

export function readDefaultExpressionTokens(tokens: Token[], position: number): TokenRead<string | undefined> {
  const parts: Token[] = [];
  let depth = 0;
  let nextPosition = position;

  while (nextPosition < tokens.length) {
    const token = tokens[nextPosition];
    if (depth === 0) {
      if (token.type === "SYMBOL" && (token.value === "," || token.value === ")" || token.value === ";")) break;
      if (token.type === "KEYWORD" && parts.length > 0 && DEFAULT_TERMINATOR_KEYWORDS.has(token.value.toUpperCase())) break;
    }
    nextPosition++;
    parts.push(token);
    if (token.type === "SYMBOL" && token.value === "(") depth++;
    if (token.type === "SYMBOL" && token.value === ")") {
      depth--;
      if (depth < 0) {
        parts.pop();
        nextPosition--;
        break;
      }
    }
  }

  let value = "";
  for (const token of parts) {
    if (value && (token.type === "IDENTIFIER" || token.type === "KEYWORD" || token.type === "LITERAL") && /[a-zA-Z0-9_']/.test(value.at(-1)!)) {
      value += " ";
    }
    value += token.value;
  }
  return { value: value || undefined, nextPosition };
}
