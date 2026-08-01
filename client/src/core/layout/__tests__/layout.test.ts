import { describe, it, expect } from "vitest";
import { layoutGrid, findEmptyPosition } from "../index";
import { createEntity } from "../../model/factory";

describe("layoutGrid", () => {
  it("빈 배열", () => {
    expect(layoutGrid([])).toEqual([]);
  });

  it("4개 엔티티 - 한 줄에 4개", () => {
    const entities = Array.from({ length: 4 }, (_, i) => createEntity({ name: `t${i}` }));
    const result = layoutGrid(entities);
    // 모두 같은 y (첫 번째 행)
    expect(new Set(result.map((e) => e.position.y)).size).toBe(1);
    // x는 증가
    for (let i = 1; i < result.length; i++) {
      expect(result[i].position.x).toBeGreaterThan(result[i - 1].position.x);
    }
  });

  it("5개 엔티티 - 2행", () => {
    const entities = Array.from({ length: 5 }, (_, i) => createEntity({ name: `t${i}` }));
    const result = layoutGrid(entities);
    const ys = [...new Set(result.map((e) => e.position.y))];
    expect(ys).toHaveLength(2);
  });

  it("높이가 큰 첫 행이 있어도 다음 행이 겹치지 않음", () => {
    const tall = createEntity({ name: "tall" });
    tall.height = 900;
    const entities = [
      tall,
      createEntity({ name: "t1" }),
      createEntity({ name: "t2" }),
      createEntity({ name: "t3" }),
      createEntity({ name: "next-row" }),
    ];

    const result = layoutGrid(entities);
    const firstRowMaxBottom = Math.max(...result.slice(0, 4).map((e) => e.position.y + e.height));
    expect(result[4].position.y).toBeGreaterThanOrEqual(firstRowMaxBottom + 80);
  });
});

describe("findEmptyPosition", () => {
  it("빈 배열 - 시작 위치 반환", () => {
    const pos = findEmptyPosition([]);
    expect(pos.x).toBe(80);
    expect(pos.y).toBe(80);
  });

  it("기존 엔티티와 겹치지 않음", () => {
    const e1 = createEntity({ name: "t1" });
    e1.position = { x: 80, y: 80 };
    const pos = findEmptyPosition([e1]);
    // 겹치지 않는 위치
    const overlaps = e1.position.x < pos.x + 220 && e1.position.x + e1.width > pos.x &&
                     e1.position.y < pos.y + e1.height && e1.position.y + e1.height > pos.y;
    expect(overlaps).toBe(false);
  });

  it("수동 이동된 엔티티가 next grid slot을 차지해도 겹치지 않는 위치를 찾음", () => {
    const moved = createEntity({ name: "moved" });
    moved.position = { x: 420, y: 80 };

    const pos = findEmptyPosition([moved]);
    const overlaps = moved.position.x < pos.x + 220 && moved.position.x + moved.width > pos.x &&
                     moved.position.y < pos.y + moved.height && moved.position.y + moved.height > pos.y;

    expect(overlaps).toBe(false);
  });

  it("큰 엔티티가 있는 행 아래로 새 위치를 배치함", () => {
    const entities = Array.from({ length: 4 }, (_, i) => createEntity({ name: `t${i}` }));
    entities[0].height = 900;
    const laidOut = layoutGrid(entities);
    const pos = findEmptyPosition(laidOut);
    const firstRowMaxBottom = Math.max(...laidOut.map((e) => e.position.y + e.height));

    expect(pos.x).toBe(80);
    expect(pos.y).toBeGreaterThanOrEqual(firstRowMaxBottom + 80);
  });
});
