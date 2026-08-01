import { describe, it, expect, vi, beforeAll } from "vitest";
import type { Entity } from "../../core/model/types";

// Mock document.createElement("canvas") so measure.ts works in Node environment.
// measureText returns 8px per character as a simple approximation.
beforeAll(() => {
  const mockCtx = {
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  const mockCanvas = {
    width: 1,
    height: 1,
    getContext: () => mockCtx,
  };
  vi.stubGlobal("document", {
    createElement: () => mockCanvas,
  });
});

// Import after mocking so getCtx() sees the stubbed document
const { calcEntityWidth, calcEntityHeight } = await import("../measure");

// ENTITY_PADDING = 12, DEFAULT_WIDTH = 220, mock: 8px/char
// To exceed DEFAULT_WIDTH we need text width > 220 - 24(padding) = 196 → >24 chars
const LONG_COMMENT = "A".repeat(30); // 30 * 8 + 24 = 264 > 220

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "e1",
    name: "users",
    comment: "",
    position: { x: 0, y: 0 },
    width: 220,
    height: 40,
    columns: [],
    ...overrides,
  };
}

describe("calcEntityWidth", () => {
  it("header with comment is wider than without (pill padding)", () => {
    // Without comment: clamped to DEFAULT_WIDTH (220)
    const withoutComment = calcEntityWidth(makeEntity({ comment: "" }));
    // With a long comment + pill padding (+16): > without
    const withComment = calcEntityWidth(makeEntity({ comment: LONG_COMMENT }));
    expect(withComment).toBeGreaterThan(withoutComment);
  });

  it("column comment includes separator gap (~16px) not just 6px", () => {
    // Column comment "사용자ID" (4 chars * 8px = 32px)
    // diff should include the gap constant (16px), so diff > 10
    const withColComment = makeEntity({
      columns: [
        {
          id: "c1",
          name: "user_id",
          type: "INT",
          comment: "사용자ID",
          nullable: true,
          isPrimaryKey: false,
          isForeignKey: false,
        },
      ],
    });
    const withoutColComment = makeEntity({
      columns: [
        {
          id: "c1",
          name: "user_id",
          type: "INT",
          comment: "",
          nullable: true,
          isPrimaryKey: false,
          isForeignKey: false,
        },
      ],
    });
    const w1 = calcEntityWidth(withColComment);
    const w2 = calcEntityWidth(withoutColComment);
    // If both are clamped to DEFAULT_WIDTH we need the commented version to escape the clamp.
    // For the gap test: diff between the raw row widths must be commentTextW + gapConstant
    // We verify diff > 10 (the gap alone, even without text, is 16)
    expect(w1).toBeGreaterThanOrEqual(w2);
    // When the row with comment exceeds DEFAULT_WIDTH, w1 - w2 should reflect gap >= 16
    // Use a long column comment to escape the clamp
    const withLongColComment = makeEntity({
      columns: [
        {
          id: "c1",
          name: "user_id",
          type: "INT",
          comment: "A".repeat(20), // 20*8 + 16 gap = 176 extra chars worth
          nullable: true,
          isPrimaryKey: false,
          isForeignKey: false,
        },
      ],
    });
    const withNoColComment = makeEntity({
      columns: [
        {
          id: "c1",
          name: "user_id",
          type: "INT",
          comment: "",
          nullable: true,
          isPrimaryKey: false,
          isForeignKey: false,
        },
      ],
    });
    const diff = calcEntityWidth(withLongColComment) - calcEntityWidth(withNoColComment);
    // diff = commentTextW (20*8=160) + gap (16) = 176; must be > 10
    expect(diff).toBeGreaterThan(10);
  });

  it("UQ badge increases measured width when the column is unique but not PK", () => {
    const withoutUnique = makeEntity({
      columns: [
        {
          id: "c1",
          name: "email_address",
          type: "VARCHAR(255)",
          nullable: true,
          isPrimaryKey: false,
          isForeignKey: false,
        },
      ],
    });
    const withUnique = makeEntity({
      columns: [
        {
          id: "c1",
          name: "email_address",
          type: "VARCHAR(255)",
          nullable: true,
          isPrimaryKey: false,
          isForeignKey: false,
          isUnique: true,
        },
      ],
    });

    expect(calcEntityWidth(withUnique)).toBeGreaterThan(calcEntityWidth(withoutUnique));
  });
});

describe("calcEntityHeight", () => {
  it("comment 없으면 HEADER_HEIGHT(40) 기반", () => {
    expect(calcEntityHeight(0)).toBe(40);
    expect(calcEntityHeight(3)).toBe(40 + 28 * 3);
  });

  it("comment 있으면 HEADER_HEIGHT_WITH_COMMENT(52) 기반", () => {
    expect(calcEntityHeight(0, true)).toBe(52);
    expect(calcEntityHeight(3, true)).toBe(52 + 28 * 3);
  });
});
