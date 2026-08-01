import { describe, expect, it, vi } from "vitest";
import { render } from "../renderer";
import type { RouteResult } from "../routing";
import { createColumn, createEntity, createRelation, createSchema } from "../../core/model/factory";
import { COLORS } from "../constants";

function createMockContext() {
  const fillTextCalls: Array<{ text: string; fillStyle: string; font: string; args: unknown[] }> = [];
  const fillRectCalls: Array<{ fillStyle: string; args: unknown[] }> = [];
  const roundRect = vi.fn();
  const arc = vi.fn();
  let fillStyle = "";
  let strokeStyle = "";
  let font = "";

  const fillText = vi.fn((...args: unknown[]) => {
    fillTextCalls.push({ text: String(args[0]), fillStyle, font, args });
  });
  const fillRect = vi.fn((...args: unknown[]) => {
    fillRectCalls.push({ fillStyle, args });
  });

  const ctx: Record<string, unknown> = {
    clearRect: vi.fn(),
    fillRect,
    beginPath: vi.fn(),
    roundRect,
    fill: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc,
    setLineDash: vi.fn(),
    fillText,
    measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    lineJoin: "miter" as CanvasLineJoin,
    lineCap: "butt" as CanvasLineCap,
    textBaseline: "alphabetic" as CanvasTextBaseline,
  };

  Object.defineProperty(ctx, "fillStyle", {
    get: () => fillStyle,
    set: (value: string) => { fillStyle = value; },
  });
  Object.defineProperty(ctx, "strokeStyle", {
    get: () => strokeStyle,
    set: (value: string) => { strokeStyle = value; },
  });
  Object.defineProperty(ctx, "font", {
    get: () => font,
    set: (value: string) => { font = value; },
  });

  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillText, fillTextCalls, fillRectCalls, roundRect, arc };
}

function buildTwoEntitySchema(opts: { cardinality?: "1:N" | "N:1" | "N:M" | "1:1" } = {}) {
  const source = createEntity({
    name: "orders",
    position: { x: 80, y: 80 },
    columns: [
      createColumn({ name: "id", type: "uuid", isPrimaryKey: true, nullable: false }),
      createColumn({ name: "customer_id", type: "uuid", isForeignKey: true, nullable: false }),
    ],
  });
  const target = createEntity({
    name: "customers",
    position: { x: 420, y: 80 },
    columns: [
      createColumn({ name: "id", type: "uuid", isPrimaryKey: true, nullable: false }),
    ],
  });
  const relation = createRelation({
    sourceEntityId: source.id,
    sourceColumnId: source.columns[1].id,
    targetEntityId: target.id,
    targetColumnId: target.columns[0].id,
    cardinality: opts.cardinality ?? "N:1",
    source: "manual",
  });

  const schema = createSchema({ name: "test" });
  schema.entities = [source, target];
  schema.relations = [relation];
  return { schema, relation, source, target };
}

function buildParallelRelationSchema() {
  const target = createEntity({
    name: "customers",
    position: { x: 80, y: 80 },
    columns: [
      createColumn({ name: "id", type: "uuid", isPrimaryKey: true, nullable: false }),
    ],
  });
  const source = createEntity({
    name: "orders",
    position: { x: 760, y: 80 },
    columns: [
      createColumn({ name: "id", type: "uuid", isPrimaryKey: true, nullable: false }),
      createColumn({ name: "customer_id", type: "uuid", isForeignKey: true, nullable: false }),
      createColumn({ name: "billing_customer_id", type: "uuid", isForeignKey: true, nullable: false }),
      createColumn({ name: "shipping_customer_id", type: "uuid", isForeignKey: true, nullable: false }),
    ],
  });
  const relations = source.columns.slice(1).map((column) => createRelation({
    sourceEntityId: source.id,
    sourceColumnId: column.id,
    targetEntityId: target.id,
    targetColumnId: target.columns[0].id,
    cardinality: "N:1",
    source: "manual",
  }));

  const schema = createSchema({ name: "parallel" });
  schema.entities = [target, source];
  schema.relations = relations;
  return { schema, relations };
}

function buildSingleEntitySchema() {
  const entity = createEntity({
    name: "orders",
    position: { x: 80, y: 80 },
    columns: [createColumn({ name: "id", type: "uuid", isPrimaryKey: true, nullable: false })],
  });

  const schema = createSchema({ name: "single" });
  schema.entities = [entity];
  return { schema, entity };
}

describe("render", () => {
  it("grid 점들을 점당 fill 대신 단일 패스로 배칭해 그린다", () => {
    const schema = createSchema({ name: "empty" });
    const { ctx, arc } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 400, 300);

    // grid 점은 여러 개 그려지지만(arc 다수), fill은 배칭되어 1회여야 한다
    expect(arc.mock.calls.length).toBeGreaterThan(1);
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("주입된 라우트 맵으로 관계선을 그린다 (hitTest와 공유 캐시)", () => {
    const { schema, relation } = buildTwoEntitySchema();
    const { ctx } = createMockContext();

    const injected = new Map<string, RouteResult>();
    injected.set(relation.id, {
      srcSide: "right",
      tgtSide: "left",
      points: [
        { x: 1111, y: 777 },
        { x: 2222, y: 777 },
      ],
    });

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800, COLORS, true, undefined, injected);

    // zoom 1 / offset 0 → world == screen 좌표이므로 주입한 라우트의 시작점이 그대로 그려져야 한다
    expect(ctx.moveTo).toHaveBeenCalledWith(1111, 777);
  });

  it("관계가 있으면 cardinality 라벨을 canvas에 그린다", () => {
    const { schema } = buildTwoEntitySchema();

    const { ctx, fillText } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    expect(fillText).toHaveBeenCalledWith("N:1", expect.any(Number), expect.any(Number));
  });

  it("관계선 양 끝에 엔드포인트 도트를 그린다", () => {
    const { schema } = buildTwoEntitySchema();
    const { ctx, arc } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    // drawRelationEndpoint() draws 2 arcs per endpoint (ring + fill) × 2 endpoints = 4 arcs
    expect(arc.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("겹치는 cardinality 라벨은 하나만 그린다", () => {
    const { schema } = buildParallelRelationSchema();
    const { ctx, fillTextCalls } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1400, 800);

    expect(fillTextCalls.filter((call) => call.text === "N:1")).toHaveLength(1);
  });

  it("호버된 관계선에 pin 라벨 'entity.column' 을 양 끝에 그린다", () => {
    const { schema, relation } = buildTwoEntitySchema();
    const { ctx, fillText } = createMockContext();

    render(
      ctx,
      schema,
      { offsetX: 0, offsetY: 0, zoom: 1 },
      { type: "none" },
      1200,
      800,
      undefined,
      true,
      relation.id,
    );

    expect(fillText).toHaveBeenCalledWith("orders.customer_id", expect.any(Number), expect.any(Number));
    expect(fillText).toHaveBeenCalledWith("customers.id", expect.any(Number), expect.any(Number));
  });

  it("호버가 아니면 pin 라벨을 그리지 않는다", () => {
    const { schema } = buildTwoEntitySchema();
    const { ctx, fillText } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    const pinCalls = fillText.mock.calls.filter((call) => {
      const text = call[0];
      return typeof text === "string" && text.includes(".");
    });
    expect(pinCalls).toHaveLength(0);
  });

  it("호버 상태라도 zoom이 너무 낮으면 pin 라벨을 생략한다", () => {
    const { schema, relation } = buildTwoEntitySchema();
    const { ctx, fillTextCalls } = createMockContext();

    render(
      ctx,
      schema,
      { offsetX: 0, offsetY: 0, zoom: 0.5 },
      { type: "none" },
      1200,
      800,
      undefined,
      true,
      relation.id,
    );

    expect(fillTextCalls.some((call) => call.text.includes("."))).toBe(false);
  });

  it("renders entity.headerColor when set", () => {
    const { schema, entity } = buildSingleEntitySchema();
    entity.headerColor = "#ff00aa";
    const { ctx, fillRectCalls } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    expect(fillRectCalls.some((call) => call.fillStyle === "#ff00aa")).toBe(true);
  });

  it("falls back to colors.entityHeader when headerColor is undefined", () => {
    const { schema } = buildSingleEntitySchema();
    const { ctx, fillRectCalls } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    expect(fillRectCalls.some((call) => call.fillStyle === COLORS.entityHeader)).toBe(true);
  });

  it("picks dark text color for light headerColor", () => {
    const { schema, entity } = buildSingleEntitySchema();
    entity.headerColor = "#FFEE00";
    const { ctx, fillTextCalls } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    const titleCall = fillTextCalls.find((call) => call.text === entity.name);
    expect(titleCall?.fillStyle).toBe("#0F172A");
  });

  it("renders status badge label when entity.status is set", () => {
    const base = buildSingleEntitySchema();
    const withStatus = buildSingleEntitySchema();
    withStatus.entity.status = "new";

    const baseCtx = createMockContext();
    const statusCtx = createMockContext();

    render(baseCtx.ctx, base.schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);
    render(statusCtx.ctx, withStatus.schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    expect(statusCtx.fillTextCalls.some((call) => call.text === "신규")).toBe(true);
    expect(statusCtx.roundRect.mock.calls.length).toBeGreaterThan(baseCtx.roundRect.mock.calls.length);
  });

  it("title maxWidth accounts for status pill width", () => {
    const base = buildSingleEntitySchema();
    const withStatus = buildSingleEntitySchema();
    base.entity.name = "very_long_entity_name";
    withStatus.entity.name = "very_long_entity_name";
    withStatus.entity.status = "deprecated";

    const baseCtx = createMockContext();
    const statusCtx = createMockContext();

    render(baseCtx.ctx, base.schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);
    render(statusCtx.ctx, withStatus.schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    const baseTitleCall = baseCtx.fillTextCalls.find((call) => call.text === base.entity.name);
    const statusTitleCall = statusCtx.fillTextCalls.find((call) => call.text === withStatus.entity.name);
    expect(typeof baseTitleCall?.args[3]).toBe("number");
    expect(typeof statusTitleCall?.args[3]).toBe("number");
    expect(Number(statusTitleCall?.args[3])).toBeLessThan(Number(baseTitleCall?.args[3]));
  });

  it("renders a UQ badge with the unique badge color", () => {
    const { schema, entity } = buildSingleEntitySchema();
    entity.columns = [createColumn({ name: "email", type: "varchar", nullable: false, isUnique: true })];
    const { ctx, fillTextCalls } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    const uqCall = fillTextCalls.find((call) => call.text === "UQ");
    const nnCall = fillTextCalls.find((call) => call.text === "NN");

    expect(uqCall?.fillStyle).toBe(COLORS.uqBadge);
    expect(typeof uqCall?.args[1]).toBe("number");
    expect(typeof nnCall?.args[1]).toBe("number");
    expect(Number(uqCall?.args[1])).toBeLessThan(Number(nnCall?.args[1]));
  });

  it("skips the UQ badge when the column is also a PK", () => {
    const { schema, entity } = buildSingleEntitySchema();
    entity.columns = [createColumn({ name: "id", type: "uuid", nullable: false, isPrimaryKey: true, isUnique: true })];
    const { ctx, fillTextCalls } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 1 }, { type: "none" }, 1200, 800);

    expect(fillTextCalls.some((call) => call.text === "UQ")).toBe(false);
  });

  it("55% 미만에서는 컬럼 텍스트 대신 테이블명과 컬럼 수를 10px 이상으로 표시한다", () => {
    const { schema, entity } = buildSingleEntitySchema();
    entity.columns.push(createColumn({ name: "customer_id", type: "uuid" }));
    const { ctx, fillTextCalls } = createMockContext();

    render(ctx, schema, { offsetX: 0, offsetY: 0, zoom: 0.25 }, { type: "none" }, 1200, 800);

    expect(fillTextCalls.some((call) => call.text === entity.name && call.font.includes("10px"))).toBe(true);
    expect(fillTextCalls.some((call) => call.text === "2 columns" && call.font.includes("10px"))).toBe(true);
    expect(fillTextCalls.some((call) => call.text === "customer_id")).toBe(false);
    expect(fillTextCalls.some((call) => call.text === "uuid")).toBe(false);
  });
});
