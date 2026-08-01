import { describe, it, expect } from "vitest";
import { hitTest } from "../hitTest";
import { getAllRelationRoutes, getRelationRoute } from "../routing";
import { createEntity, createColumn, createRelation, createSchema } from "../../core/model/factory";

describe("hitTest", () => {
  const col = createColumn({ name: "id", type: "INT" });
  const entity = createEntity({ name: "users", columns: [col] });
  entity.position = { x: 100, y: 100 };
  const schema = createSchema({ name: "test" });
  schema.entities = [entity];
  const vp = { offsetX: 0, offsetY: 0, zoom: 1 };

  it("엔티티 헤더 클릭", () => {
    const result = hitTest(schema, vp, 150, 120);
    expect(result.type).toBe("entity");
    if (result.type === "entity") {
      expect(result.entityId).toBe(entity.id);
    }
  });

  it("컬럼 영역 클릭", () => {
    const result = hitTest(schema, vp, 150, 155); // header(40) + row mid(14)
    expect(result.type).toBe("column");
  });

  it("빈 영역 클릭", () => {
    const result = hitTest(schema, vp, 500, 500);
    expect(result.type).toBe("canvas");
  });
});

describe("hitTest - 렌더 라우트와 클릭 판정 일치 (M1)", () => {
  const vp = { offsetX: 0, offsetY: 0, zoom: 1 };

  // 같은 컬럼 쌍을 잇는 관계 2개 → applyEndpointOffsets 가 엔드포인트를 ±ENDPOINT_OFFSET_STEP(8) 분산.
  // 렌더러는 분산된 라우트를 그리므로, hitTest 도 같은 라우트를 봐야 한다.
  function buildSharedEndpointFixture() {
    const colA = createColumn({ name: "user_id", type: "INT" });
    const a = createEntity({ name: "orders", columns: [colA] });
    a.position = { x: 100, y: 100 };
    const colB = createColumn({ name: "id", type: "INT" });
    const b = createEntity({ name: "users", columns: [colB] });
    b.position = { x: 500, y: 100 };
    const schema = createSchema({ name: "t" });
    schema.entities = [a, b];
    const rel1 = createRelation({
      sourceEntityId: a.id, sourceColumnId: colA.id,
      targetEntityId: b.id, targetColumnId: colB.id, cardinality: "N:1",
    });
    const rel2 = createRelation({
      sourceEntityId: a.id, sourceColumnId: colA.id,
      targetEntityId: b.id, targetColumnId: colB.id, cardinality: "N:1",
    });
    schema.relations = [rel1, rel2];

    const rendered = getAllRelationRoutes(schema);
    const raw2 = getRelationRoute(rel2, schema)!;
    const r2 = rendered.get(rel2.id)!;
    // fixture 무결성: 렌더 라우트의 첫 스텁이 원본 대비 threshold(5) 이상 벌어져 있어야 의미 있는 테스트
    expect(Math.abs(r2.points[0].y - raw2.points[0].y)).toBeGreaterThan(5);
    return { schema, rel1, rel2, rendered, raw2 };
  }

  it("오프셋 적용된 렌더 라우트 위 클릭이 해당 관계에 히트한다", () => {
    const { schema, rel2, rendered } = buildSharedEndpointFixture();
    const r2 = rendered.get(rel2.id)!;
    const px = (r2.points[0].x + r2.points[1].x) / 2;
    const py = (r2.points[0].y + r2.points[1].y) / 2;

    const result = hitTest(schema, vp, px, py);
    expect(result).toEqual({ type: "relation", relationId: rel2.id });
  });

  it("렌더되지 않는 원본(미오프셋) 라우트 위치는 히트하지 않는다", () => {
    const { schema, raw2 } = buildSharedEndpointFixture();
    const px = (raw2.points[0].x + raw2.points[1].x) / 2;
    const py = (raw2.points[0].y + raw2.points[1].y) / 2;

    const result = hitTest(schema, vp, px, py);
    expect(result.type).toBe("canvas");
  });

  it("숨겨진 inferred/AI 관계는 히트하지 않는다", () => {
    const { schema, rel1, rendered } = buildSharedEndpointFixture();
    rel1.source = "inferred";
    const r1 = rendered.get(rel1.id)!;
    const px = (r1.points[0].x + r1.points[1].x) / 2;
    const py = (r1.points[0].y + r1.points[1].y) / 2;

    const result = hitTest(schema, vp, px, py, rendered, { showInferredRelations: false });
    expect(result.type).toBe("canvas");
  });

  it("관계 히트 허용 오차는 화면 픽셀 기준으로 일정하다", () => {
    const { schema, rel1, rendered } = buildSharedEndpointFixture();
    const r1 = rendered.get(rel1.id)!;
    const midWorldX = (r1.points[0].x + r1.points[1].x) / 2;
    const midWorldY = (r1.points[0].y + r1.points[1].y) / 2;
    const zoomedOut = { offsetX: 0, offsetY: 0, zoom: 0.25 };
    const zoomedIn = { offsetX: 0, offsetY: 0, zoom: 3 };

    const zoomedOutNear = hitTest(schema, zoomedOut, midWorldX * zoomedOut.zoom, midWorldY * zoomedOut.zoom + 2, rendered);
    const zoomedInFar = hitTest(schema, zoomedIn, midWorldX * zoomedIn.zoom, midWorldY * zoomedIn.zoom + 14, rendered);

    expect(zoomedOutNear.type).toBe("relation");
    expect(zoomedInFar.type).toBe("canvas");
  });

  it("겹친 관계에서는 마지막에 렌더된 관계를 선택한다", () => {
    const { schema, rel1, rel2, rendered } = buildSharedEndpointFixture();
    const sharedRoute = rendered.get(rel1.id)!;
    const overlappingRoutes = new Map([
      [rel1.id, sharedRoute],
      [rel2.id, sharedRoute],
    ]);
    const px = (sharedRoute.points[0].x + sharedRoute.points[1].x) / 2;
    const py = (sharedRoute.points[0].y + sharedRoute.points[1].y) / 2;

    expect(hitTest(schema, vp, px, py, overlappingRoutes)).toEqual({ type: "relation", relationId: rel2.id });
  });
});
