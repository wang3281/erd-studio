import { describe, expect, it } from "vitest";
import { createColumn, createEntity, createRelation, createSchema } from "../../core/model/factory";
import { ROW_HEIGHT } from "../constants";
import { EDGE_LANE_GAP, ENDPOINT_OFFSET_STEP, applyEndpointOffsets, getAllRelationRoutes, getRelationRoute } from "../routing";
import type { Entity } from "../../core/model/types";

function makeEntity(name: string, x: number, y: number): Entity {
  const entity = createEntity({
    name,
    position: { x, y },
    columns: [createColumn({ name: "id", type: "INT", isPrimaryKey: true }), createColumn({ name: `${name}_ref`, type: "INT" })],
  });
  entity.position = { x, y };
  return entity;
}

function segmentHitsEntity(a: { x: number; y: number }, b: { x: number; y: number }, entity: Entity): boolean {
  const left = entity.position.x;
  const right = entity.position.x + entity.width;
  const top = entity.position.y;
  const bottom = entity.position.y + entity.height;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);

  if (a.y === b.y) {
    return a.y >= top && a.y <= bottom && maxX >= left && minX <= right;
  }

  if (a.x === b.x) {
    return a.x >= left && a.x <= right && maxY >= top && minY <= bottom;
  }

  return false;
}

function routeHitsEntity(points: Array<{ x: number; y: number }>, entity: Entity): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentHitsEntity(points[i], points[i + 1], entity)) {
      return true;
    }
  }
  return false;
}

function routeIsOrthogonal(points: Array<{ x: number; y: number }>): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].x !== points[i + 1].x && points[i].y !== points[i + 1].y) {
      return false;
    }
  }
  return true;
}

describe("getRelationRoute", () => {
  it("가로 경로가 중간 엔티티를 관통하면 위나 아래로 우회한다", () => {
    const source = makeEntity("source", 80, 80);
    const blocker = makeEntity("blocker", 430, 80);
    const target = makeEntity("target", 780, 80);

    const relation = createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[1].id,
      targetEntityId: target.id,
      targetColumnId: target.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    });

    const schema = createSchema({ name: "test" });
    schema.entities = [source, blocker, target];
    schema.relations = [relation];

    const route = getRelationRoute(relation, schema);
    expect(route).not.toBeNull();
    expect(route?.points.some((point) => point.y !== route.points[0].y && point.y !== route.points[route.points.length - 1].y)).toBe(true);
    expect(routeHitsEntity(route!.points, blocker)).toBe(false);
  });

  it("세로 경로가 중간 엔티티를 관통하면 좌나 우로 우회한다", () => {
    const source = makeEntity("source", 320, 80);
    const blocker = makeEntity("blocker", 320, 260);
    const target = makeEntity("target", 320, 520);

    const relation = createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[1].id,
      targetEntityId: target.id,
      targetColumnId: target.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    });

    const schema = createSchema({ name: "test" });
    schema.entities = [source, blocker, target];
    schema.relations = [relation];

    const route = getRelationRoute(relation, schema);
    expect(route).not.toBeNull();
    expect(route?.points.some((point) => point.x !== route.points[0].x && point.x !== route.points[route.points.length - 1].x)).toBe(true);
    expect(routeHitsEntity(route!.points, blocker)).toBe(false);
  });

  it("여러 blocker 사이 빈 lane이 있으면 가장 짧은 우회 경로를 고른다", () => {
    const source = makeEntity("source", 80, 80);
    const blockerTop = makeEntity("blockerTop", 430, 60);
    const blockerBottom = makeEntity("blockerBottom", 430, 320);
    const target = makeEntity("target", 780, 80);

    const relation = createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[1].id,
      targetEntityId: target.id,
      targetColumnId: target.columns[1].id,
      cardinality: "N:1",
      source: "manual",
    });

    const schema = createSchema({ name: "test" });
    schema.entities = [source, blockerTop, blockerBottom, target];
    schema.relations = [relation];

    const route = getRelationRoute(relation, schema);
    expect(route).not.toBeNull();
    expect(routeHitsEntity(route!.points, blockerTop)).toBe(false);
    expect(routeHitsEntity(route!.points, blockerBottom)).toBe(false);

    const laneY = route!.points[2]?.y;
    expect(laneY).toBeGreaterThan(blockerTop.position.y + blockerTop.height);
    expect(laneY).toBeLessThan(blockerBottom.position.y);
  });

  it("가로 우회가 모두 막히면 상하 연결로 전환한다", () => {
    const source = makeEntity("source", 80, 260);
    const target = makeEntity("target", 700, 260);
    const blockers = [
      makeEntity("left", 300, 0),
      makeEntity("right", 660, 240),
      makeEntity("center", 430, 0),
    ];

    const relation = createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[1].id,
      targetEntityId: target.id,
      targetColumnId: target.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    });

    const schema = createSchema({ name: "test" });
    schema.entities = [source, ...blockers, target];
    schema.relations = [relation];

    const route = getRelationRoute(relation, schema);
    expect(route).not.toBeNull();
    expect(route?.srcSide).toMatch(/top|bottom/);
    expect(route?.tgtSide).toMatch(/top|bottom/);
    for (const blocker of blockers) {
      expect(routeHitsEntity(route!.points, blocker)).toBe(false);
    }
  });

  it("blocker가 없으면 기본 직선 경로를 유지한다", () => {
    const source = makeEntity("source", 80, 80);
    const target = makeEntity("target", 520, 80);

    const relation = createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[1].id,
      targetEntityId: target.id,
      targetColumnId: target.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    });

    const schema = createSchema({ name: "test" });
    schema.entities = [source, target];
    schema.relations = [relation];

    const route = getRelationRoute(relation, schema);
    expect(route).not.toBeNull();
    expect(route?.srcSide).toBe("right");
    expect(route?.tgtSide).toBe("left");
    expect(route?.points).toHaveLength(6);
    expect(route?.points.every((point) =>
      point.y === route.points[0].y || point.y === route.points[route.points.length - 1].y)).toBe(true);
  });

  it("같은 side·같은 colIdx 에 끝점이 2개 이상이면 ±offset 으로 분리한다", () => {
    const source = makeEntity("source", 80, 80);
    const targetA = makeEntity("targetA", 520, 80);
    const targetB = makeEntity("targetB", 520, 260);

    const relA = createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[1].id,
      targetEntityId: targetA.id,
      targetColumnId: targetA.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    });
    const relB = createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[1].id,
      targetEntityId: targetB.id,
      targetColumnId: targetB.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    });

    const schema = createSchema({ name: "test" });
    schema.entities = [source, targetA, targetB];
    schema.relations = [relA, relB];

    const routes = getAllRelationRoutes(schema);
    const routeA = routes.get(relA.id)!;
    const routeB = routes.get(relB.id)!;

    expect(routeA.srcSide).toBe("right");
    expect(routeB.srcSide).toBe("right");

    // Both share source entity + right side + same colIdx → endpoints should spread on Y axis
    const srcYA = routeA.points[0].y;
    const srcYB = routeB.points[0].y;
    expect(Math.abs(srcYA - srcYB)).toBe(ENDPOINT_OFFSET_STEP * 2);

    // Stub point (next after endpoint) shifts with the endpoint so stub stays perpendicular
    expect(routeA.points[1].y).toBe(srcYA);
    expect(routeB.points[1].y).toBe(srcYB);
  });

  it("같은 endpoint에 여러 관계가 몰려도 row 높이 안에서 8px 단위로 분산한다", () => {
    expect(ENDPOINT_OFFSET_STEP).toBe(8);

    const source = makeEntity("source", 80, 80);
    const targets = [
      makeEntity("targetA", 520, 40),
      makeEntity("targetB", 520, 160),
      makeEntity("targetC", 520, 280),
      makeEntity("targetD", 520, 400),
    ];
    const relations = targets.map((target) => createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[1].id,
      targetEntityId: target.id,
      targetColumnId: target.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    }));

    const schema = createSchema({ name: "test" });
    schema.entities = [source, ...targets];
    schema.relations = relations;

    const sourceYs = relations.map((rel) => getAllRelationRoutes(schema).get(rel.id)!.points[0].y);
    const spread = Math.max(...sourceYs) - Math.min(...sourceYs);

    expect(spread).toBeLessThanOrEqual(ROW_HEIGHT - 8);
    expect(new Set(sourceYs).size).toBe(relations.length);
  });

  it("겹치는 중간 관계선 lane을 entity 충돌 없이 분리한다", () => {
    const sourceA = makeEntity("sourceA", 80, 80);
    const targetA = makeEntity("targetA", 540, 80);
    const sourceB = makeEntity("sourceB", 80, 220);
    const targetB = makeEntity("targetB", 540, 220);

    const relA = createRelation({
      sourceEntityId: sourceA.id,
      sourceColumnId: sourceA.columns[1].id,
      targetEntityId: targetA.id,
      targetColumnId: targetA.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    });
    const relB = createRelation({
      sourceEntityId: sourceB.id,
      sourceColumnId: sourceB.columns[1].id,
      targetEntityId: targetB.id,
      targetColumnId: targetB.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    });

    const schema = createSchema({ name: "test" });
    schema.entities = [sourceA, targetA, sourceB, targetB];
    schema.relations = [relA, relB];

    const routes = getAllRelationRoutes(schema);
    const laneA = routes.get(relA.id)!.points[2].x;
    const laneB = routes.get(relB.id)!.points[2].x;

    expect(Math.abs(laneA - laneB)).toBeGreaterThanOrEqual(EDGE_LANE_GAP);
    expect(routeHitsEntity(routes.get(relA.id)!.points, sourceB)).toBe(false);
    expect(routeHitsEntity(routes.get(relA.id)!.points, targetB)).toBe(false);
    expect(routeHitsEntity(routes.get(relB.id)!.points, sourceA)).toBe(false);
    expect(routeHitsEntity(routes.get(relB.id)!.points, targetA)).toBe(false);
  });

  it("endpoint offset 이후에도 관계선은 직교 세그먼트만 유지한다", () => {
    const target = makeEntity("target", 80, 80);
    const source = makeEntity("source", 520, 80);
    source.columns.push(createColumn({ name: "source_ref_b", type: "INT", isForeignKey: true }));
    source.columns.push(createColumn({ name: "source_ref_c", type: "INT", isForeignKey: true }));
    source.height += ROW_HEIGHT * 2;

    const relations = source.columns.slice(1).map((column) => createRelation({
      sourceEntityId: source.id,
      sourceColumnId: column.id,
      targetEntityId: target.id,
      targetColumnId: target.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    }));

    const schema = createSchema({ name: "test" });
    schema.entities = [target, source];
    schema.relations = relations;

    const routes = getAllRelationRoutes(schema);
    for (const rel of relations) {
      expect(routeIsOrthogonal(routes.get(rel.id)!.points)).toBe(true);
    }
  });

  it("충돌이 없는 관계선은 applyEndpointOffsets 이후에도 좌표가 변하지 않는다", () => {
    const source = makeEntity("source", 80, 80);
    const target = makeEntity("target", 520, 80);

    const relation = createRelation({
      sourceEntityId: source.id,
      sourceColumnId: source.columns[1].id,
      targetEntityId: target.id,
      targetColumnId: target.columns[0].id,
      cardinality: "N:1",
      source: "manual",
    });

    const schema = createSchema({ name: "test" });
    schema.entities = [source, target];
    schema.relations = [relation];

    const routes = new Map([[relation.id, getRelationRoute(relation, schema)!]]);
    const before = routes.get(relation.id)!.points.map((p) => ({ ...p }));
    applyEndpointOffsets(routes, schema);
    const after = routes.get(relation.id)!.points;

    expect(after).toEqual(before);
  });

  it("자기 참조 관계는 엔티티 바깥으로 루프를 만든다", () => {
    const entity = makeEntity("users", 200, 200);
    const relation = createRelation({
      sourceEntityId: entity.id,
      sourceColumnId: entity.columns[0].id,
      targetEntityId: entity.id,
      targetColumnId: entity.columns[1].id,
      cardinality: "1:N",
      source: "manual",
    });

    const schema = createSchema({ name: "test" });
    schema.entities = [entity];
    schema.relations = [relation];

    const route = getRelationRoute(relation, schema);
    expect(route).not.toBeNull();
    expect(route?.srcSide).toBe("right");
    expect(route?.tgtSide).toBe("right");
    expect(route?.points.length).toBeGreaterThan(6);

    const outerX = route!.points.some((point) => point.x > entity.position.x + entity.width || point.x < entity.position.x);
    const upperY = route!.points.some((point) => point.y < entity.position.y);
    expect(outerX).toBe(true);
    expect(upperY).toBe(true);
  });
});
