import { describe, it, expect } from "vitest";
import { tokenize } from "../tokenizer";

describe("tokenize", () => {
  it("CREATE TABLE 키워드 인식", () => {
    const tokens = tokenize("CREATE TABLE users");
    const keywords = tokens.filter((t) => t.type === "KEYWORD");
    expect(keywords.map((k) => k.value.toUpperCase())).toEqual(["CREATE", "TABLE"]);
  });

  it("식별자 인식", () => {
    const tokens = tokenize("CREATE TABLE users");
    const ids = tokens.filter((t) => t.type === "IDENTIFIER");
    expect(ids[0].value).toBe("users");
  });

  it("심볼 인식 (괄호, 쉼표, 세미콜론)", () => {
    const tokens = tokenize("(id INT, name VARCHAR(255));");
    const syms = tokens.filter((t) => t.type === "SYMBOL");
    expect(syms.map((s) => s.value)).toEqual(["(", ",", "(", ")", ")", ";"]);
  });

  it("문자열 리터럴 인식", () => {
    const tokens = tokenize("DEFAULT 'hello world'");
    const lits = tokens.filter((t) => t.type === "LITERAL");
    expect(lits[0].value).toBe("'hello world'");
  });

  it("SQL 표준 이스케이프 따옴표를 같은 문자열 리터럴에 포함한다", () => {
    const tokens = tokenize("DEFAULT 'It''s ok'");
    const lits = tokens.filter((t) => t.type === "LITERAL");
    expect(lits[0].value).toBe("'It''s ok'");
    expect(lits[0].unterminated).toBeUndefined();
  });

  it("미종료 문자열은 줄바꿈에서 복구하고 표시한다", () => {
    const tokens = tokenize("DEFAULT 'broken\nCREATE TABLE next (id INT);");
    const lits = tokens.filter((t) => t.type === "LITERAL");
    expect(lits[0]).toMatchObject({ value: "'broken", unterminated: true });
    expect(tokens.some((t) => t.type === "KEYWORD" && t.value.toUpperCase() === "CREATE")).toBe(true);
  });

  it("미종료 SQL Server bracket identifier를 표시한다", () => {
    expect(tokenize("CREATE TABLE [broken (id INT);").find((token) => token.unterminated)).toMatchObject({
      type: "IDENTIFIER",
      value: "broken (id INT);",
      unterminated: true,
    });
  });

  it("숫자 리터럴 인식", () => {
    const tokens = tokenize("DECIMAL(10,2)");
    const lits = tokens.filter((t) => t.type === "LITERAL");
    expect(lits.map((l) => l.value)).toEqual(["10", "2"]);
  });

  it("DEFAULT 표현식에 필요한 부호와 캐스트 심볼을 보존한다", () => {
    const tokens = tokenize("DEFAULT -1, note TEXT DEFAULT 'a'::text");
    const syms = tokens.filter((t) => t.type === "SYMBOL").map((t) => t.value);
    expect(syms).toEqual(["-", ",", ":", ":"]);
  });

  it("대소문자 무관 키워드", () => {
    const tokens = tokenize("create table");
    const keywords = tokens.filter((t) => t.type === "KEYWORD");
    expect(keywords).toHaveLength(2);
  });

  it("빈 입력", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("position 추적", () => {
    const tokens = tokenize("CREATE TABLE");
    const kws = tokens.filter((t) => t.type === "KEYWORD");
    expect(kws[0].position).toBe(0);
    expect(kws[1].position).toBe(7);
  });
});
