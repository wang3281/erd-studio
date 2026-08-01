import type { ERDSchema, Entity, Relation } from "../core/model/types";
import { ROW_HEIGHT, getHeaderHeight } from "./constants";

export const STUB_LENGTH = 24;
export const ENDPOINT_OFFSET_STEP = 8;
export const EDGE_LANE_GAP = 8;
export const LANE_OCCUPANCY_PENALTY = 60;

const ROUTE_MARGIN = 24;
const COLLISION_PADDING = 12;
const SELF_LOOP_SIZE = 48;
const MAX_ENDPOINT_SPREAD = ROW_HEIGHT - 8;

export type Side = "left" | "right" | "top" | "bottom";

export interface Point {
  x: number;
  y: number;
}

export interface RouteResult {
  srcSide: Side;
  tgtSide: Side;
  points: Point[];
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type OccupiedLanes = Map<string, number>;

export function chooseSides(srcEntity: Entity, tgtEntity: Entity): { srcSide: Side; tgtSide: Side } {
  const srcCx = srcEntity.position.x + srcEntity.width / 2;
  const srcCy = srcEntity.position.y + srcEntity.height / 2;
  const tgtCx = tgtEntity.position.x + tgtEntity.width / 2;
  const tgtCy = tgtEntity.position.y + tgtEntity.height / 2;

  const dx = Math.abs(tgtCx - srcCx);
  const dy = Math.abs(tgtCy - srcCy);
  const xOverlap = srcEntity.position.x < tgtEntity.position.x + tgtEntity.width &&
    tgtEntity.position.x < srcEntity.position.x + srcEntity.width;

  if (xOverlap || dy > dx) {
    return srcCy < tgtCy
      ? { srcSide: "bottom", tgtSide: "top" }
      : { srcSide: "top", tgtSide: "bottom" };
  }

  return srcCx < tgtCx
    ? { srcSide: "right", tgtSide: "left" }
    : { srcSide: "left", tgtSide: "right" };
}

export function getConnectionPoint(entity: Entity, colIdx: number, side: Side): Point {
  const colY = entity.position.y + getHeaderHeight(!!entity.comment) + (colIdx >= 0 ? colIdx : 0) * ROW_HEIGHT + ROW_HEIGHT / 2;

  switch (side) {
    case "right":
      return { x: entity.position.x + entity.width, y: colY };
    case "left":
      return { x: entity.position.x, y: colY };
    case "bottom":
      return { x: entity.position.x + entity.width / 2, y: entity.position.y + entity.height };
    case "top":
      return { x: entity.position.x + entity.width / 2, y: entity.position.y };
  }
}

export function getAllRelationRoutes(schema: ERDSchema): Map<string, RouteResult> {
  const routes = new Map<string, RouteResult>();
  const occupiedLanes: OccupiedLanes = new Map();
  for (const rel of schema.relations) {
    const r = getRelationRoute(rel, schema, occupiedLanes);
    if (r) {
      routes.set(rel.id, r);
      recordRouteLanes(r.points, occupiedLanes);
    }
  }
  applyEndpointOffsets(routes, schema);
  nudgeOverlappingMidSegments(routes, schema);
  return routes;
}

interface EndpointRef {
  relId: string;
  which: "src" | "tgt";
  side: Side;
}

export function applyEndpointOffsets(
  routes: Map<string, RouteResult>,
  schema: ERDSchema,
): void {
  const groups = new Map<string, EndpointRef[]>();

  for (const rel of schema.relations) {
    const route = routes.get(rel.id);
    if (!route) continue;
    const srcEntity = schema.entities.find((e) => e.id === rel.sourceEntityId);
    const tgtEntity = schema.entities.find((e) => e.id === rel.targetEntityId);
    if (!srcEntity || !tgtEntity) continue;
    const srcColIdx = srcEntity.columns.findIndex((c) => c.id === rel.sourceColumnId);
    const tgtColIdx = tgtEntity.columns.findIndex((c) => c.id === rel.targetColumnId);

    pushGroup(groups, endpointKey(rel.sourceEntityId, route.srcSide, srcColIdx), {
      relId: rel.id,
      which: "src",
      side: route.srcSide,
    });
    pushGroup(groups, endpointKey(rel.targetEntityId, route.tgtSide, tgtColIdx), {
      relId: rel.id,
      which: "tgt",
      side: route.tgtSide,
    });
  }

  for (const refs of groups.values()) {
    if (refs.length < 2) continue;
    refs.sort((a, b) => a.relId.localeCompare(b.relId));
    const n = refs.length;
    for (let i = 0; i < n; i++) {
      const rawOffset = ENDPOINT_OFFSET_STEP * (2 * i - (n - 1));
      const rawSpread = ENDPOINT_OFFSET_STEP * 2 * (n - 1);
      const offset = rawSpread > MAX_ENDPOINT_SPREAD
        ? rawOffset * (MAX_ENDPOINT_SPREAD / rawSpread)
        : rawOffset;
      if (offset === 0) continue;
      const ref = refs[i];
      const route = routes.get(ref.relId);
      if (!route) continue;
      shiftEndpoint(route, ref.which, ref.side, offset);
    }
  }
}

export function nudgeOverlappingMidSegments(
  routes: Map<string, RouteResult>,
  schema: ERDSchema,
): void {
  const groups = new Map<string, Array<{ rel: Relation; route: RouteResult; segment: MiddleSegment }>>();

  for (const rel of schema.relations) {
    if (rel.sourceEntityId === rel.targetEntityId) continue;
    const route = routes.get(rel.id);
    if (!route) continue;
    const segment = getMiddleSegment(route.points);
    if (!segment) continue;
    const key = middleSegmentLaneKey(segment);
    const group = groups.get(key);
    const item = { rel, route, segment };
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.rel.id.localeCompare(b.rel.id));
    const midpoint = (group.length - 1) / 2;

    for (let i = 0; i < group.length; i++) {
      const { rel, route, segment } = group[i];
      const offset = (i - midpoint) * EDGE_LANE_GAP;
      if (offset === 0) continue;

      const candidate = route.points.map((point) => ({ ...point }));
      shiftMiddleSegment(candidate, segment, offset);
      const blockers = schema.entities.filter((entity) =>
        entity.id !== rel.sourceEntityId && entity.id !== rel.targetEntityId);
      if (polylineHitsEntities(candidate, blockers)) continue;
      route.points = candidate;
    }
  }
}

function endpointKey(entityId: string, side: Side, colIdx: number): string {
  return `${entityId}::${side}::${colIdx}`;
}

function pushGroup(map: Map<string, EndpointRef[]>, key: string, ref: EndpointRef): void {
  const list = map.get(key);
  if (list) list.push(ref);
  else map.set(key, [ref]);
}

function shiftEndpoint(route: RouteResult, which: "src" | "tgt", side: Side, offset: number): void {
  const pts = route.points;
  if (pts.length < 2) return;
  const idxEnd = which === "src" ? 0 : pts.length - 1;
  const idxStub = which === "src" ? 1 : pts.length - 2;
  const idxBend = which === "src" ? 2 : pts.length - 3;
  const isHorizontalSide = side === "left" || side === "right";
  if (isHorizontalSide) {
    const shouldShiftBend = pts[idxBend] && pts[idxBend].y === pts[idxStub].y;
    pts[idxEnd] = { x: pts[idxEnd].x, y: pts[idxEnd].y + offset };
    pts[idxStub] = { x: pts[idxStub].x, y: pts[idxStub].y + offset };
    if (shouldShiftBend) {
      pts[idxBend] = { x: pts[idxBend].x, y: pts[idxBend].y + offset };
    }
  } else {
    const shouldShiftBend = pts[idxBend] && pts[idxBend].x === pts[idxStub].x;
    pts[idxEnd] = { x: pts[idxEnd].x + offset, y: pts[idxEnd].y };
    pts[idxStub] = { x: pts[idxStub].x + offset, y: pts[idxStub].y };
    if (shouldShiftBend) {
      pts[idxBend] = { x: pts[idxBend].x + offset, y: pts[idxBend].y };
    }
  }
}

export function getRelationRoute(
  rel: Relation,
  schema: ERDSchema,
  occupiedLanes: OccupiedLanes = new Map(),
): RouteResult | null {
  const srcEntity = schema.entities.find((e) => e.id === rel.sourceEntityId);
  const tgtEntity = schema.entities.find((e) => e.id === rel.targetEntityId);
  if (!srcEntity || !tgtEntity) return null;

  const srcColIdx = srcEntity.columns.findIndex((c) => c.id === rel.sourceColumnId);
  const tgtColIdx = tgtEntity.columns.findIndex((c) => c.id === rel.targetColumnId);
  const blockers = schema.entities.filter((e) => e.id !== srcEntity.id && e.id !== tgtEntity.id);

  if (srcEntity.id === tgtEntity.id) {
    return buildSelfRelationRoute(srcEntity, srcColIdx, tgtColIdx);
  }

  const primarySides = chooseSides(srcEntity, tgtEntity);
  const primary = tryRouteWithSides(
    srcEntity,
    tgtEntity,
    srcColIdx,
    tgtColIdx,
    blockers,
    schema.entities,
    primarySides.srcSide,
    primarySides.tgtSide,
    occupiedLanes,
  );
  if (primary) {
    return { ...primarySides, points: primary };
  }

  const secondarySides = flipSides(srcEntity, tgtEntity, primarySides.srcSide);
  const secondary = tryRouteWithSides(
    srcEntity,
    tgtEntity,
    srcColIdx,
    tgtColIdx,
    blockers,
    schema.entities,
    secondarySides.srcSide,
    secondarySides.tgtSide,
    occupiedLanes,
  );
  if (secondary) {
    return { ...secondarySides, points: secondary };
  }

  const srcPt = getConnectionPoint(srcEntity, srcColIdx, primarySides.srcSide);
  const tgtPt = getConnectionPoint(tgtEntity, tgtColIdx, primarySides.tgtSide);
  return {
    ...primarySides,
    points: buildDirectRoute(srcPt, tgtPt, primarySides.srcSide, primarySides.tgtSide),
  };
}

function tryRouteWithSides(
  srcEntity: Entity,
  tgtEntity: Entity,
  srcColIdx: number,
  tgtColIdx: number,
  blockers: Entity[],
  entities: Entity[],
  srcSide: Side,
  tgtSide: Side,
  occupiedLanes: OccupiedLanes,
): Point[] | null {
  const srcPt = getConnectionPoint(srcEntity, srcColIdx, srcSide);
  const tgtPt = getConnectionPoint(tgtEntity, tgtColIdx, tgtSide);
  const direct = buildDirectRoute(srcPt, tgtPt, srcSide, tgtSide);

  if (!polylineHitsEntities(direct, blockers)) {
    return direct;
  }

  const isHorizontal = srcSide === "left" || srcSide === "right";
  const detours = findLaneCandidates(entities, isHorizontal ? "y" : "x").map((lane) =>
    isHorizontal
      ? buildHorizontalDetour(srcPt, tgtPt, srcSide, tgtSide, lane)
      : buildVerticalDetour(srcPt, tgtPt, srcSide, tgtSide, lane),
  );
  const validDetours = detours.filter((points) => !polylineHitsEntities(points, blockers));
  if (validDetours.length === 0) {
    return null;
  }

  validDetours.sort((a, b) => routeCost(a, occupiedLanes) - routeCost(b, occupiedLanes));
  return validDetours[0];
}

function routeCost(points: Point[], occupiedLanes: OccupiedLanes): number {
  return polylineLength(points) + LANE_OCCUPANCY_PENALTY * occupiedNeighborCount(points, occupiedLanes);
}

function occupiedNeighborCount(points: Point[], occupiedLanes: OccupiedLanes): number {
  const segment = getMiddleSegment(points);
  if (!segment) return 0;
  const lane = segment.orientation === "horizontal"
    ? Math.round(segment.start.y / EDGE_LANE_GAP)
    : Math.round(segment.start.x / EDGE_LANE_GAP);
  let count = 0;
  for (const neighbor of [lane - 1, lane, lane + 1]) {
    count += occupiedLanes.get(`${segment.orientation}:${neighbor}`) ?? 0;
  }
  return count;
}

function recordRouteLanes(points: Point[], occupiedLanes: OccupiedLanes): void {
  const segment = getMiddleSegment(points);
  if (!segment) return;
  const lane = segment.orientation === "horizontal"
    ? Math.round(segment.start.y / EDGE_LANE_GAP)
    : Math.round(segment.start.x / EDGE_LANE_GAP);
  const key = `${segment.orientation}:${lane}`;
  occupiedLanes.set(key, (occupiedLanes.get(key) ?? 0) + 1);
}

interface MiddleSegment {
  index: number;
  start: Point;
  end: Point;
  orientation: "horizontal" | "vertical";
}

function getMiddleSegment(points: Point[]): MiddleSegment | null {
  if (points.length < 6) return null;
  const index = 2;
  const start = points[index];
  const end = points[index + 1];
  if (!start || !end) return null;
  if (start.y === end.y) {
    return { index, start, end, orientation: "horizontal" };
  }
  if (start.x === end.x) {
    return { index, start, end, orientation: "vertical" };
  }
  return null;
}

function middleSegmentLaneKey(segment: MiddleSegment): string {
  const coord = segment.orientation === "horizontal" ? segment.start.y : segment.start.x;
  return `${segment.orientation}:${Math.round(coord)}`;
}

function shiftMiddleSegment(points: Point[], segment: MiddleSegment, offset: number): void {
  const start = points[segment.index];
  const end = points[segment.index + 1];
  if (segment.orientation === "horizontal") {
    points[segment.index] = { x: start.x, y: start.y + offset };
    points[segment.index + 1] = { x: end.x, y: end.y + offset };
  } else {
    points[segment.index] = { x: start.x + offset, y: start.y };
    points[segment.index + 1] = { x: end.x + offset, y: end.y };
  }
}

function findLaneCandidates(entities: Entity[], axis: "x" | "y"): number[] {
  if (entities.length === 0) {
    return [];
  }

  const edges = entities.flatMap((entity) => axis === "y"
    ? [entity.position.y - COLLISION_PADDING, entity.position.y + entity.height + COLLISION_PADDING]
    : [entity.position.x - COLLISION_PADDING, entity.position.x + entity.width + COLLISION_PADDING]);
  edges.sort((a, b) => a - b);

  const candidates = [edges[0] - ROUTE_MARGIN];
  for (let i = 0; i < edges.length - 1; i++) {
    if (edges[i + 1] - edges[i] > ROUTE_MARGIN * 2) {
      candidates.push((edges[i] + edges[i + 1]) / 2);
    }
  }
  candidates.push(edges[edges.length - 1] + ROUTE_MARGIN);

  return candidates.filter((candidate, index) =>
    index === 0 || candidate !== candidates[index - 1]);
}

function flipSides(srcEntity: Entity, tgtEntity: Entity, srcSide: Side): { srcSide: Side; tgtSide: Side } {
  return srcSide === "left" || srcSide === "right"
    ? chooseVerticalSides(srcEntity, tgtEntity)
    : chooseHorizontalSides(srcEntity, tgtEntity);
}

function chooseHorizontalSides(srcEntity: Entity, tgtEntity: Entity): { srcSide: Side; tgtSide: Side } {
  const srcCx = srcEntity.position.x + srcEntity.width / 2;
  const tgtCx = tgtEntity.position.x + tgtEntity.width / 2;

  return srcCx < tgtCx
    ? { srcSide: "right", tgtSide: "left" }
    : { srcSide: "left", tgtSide: "right" };
}

function chooseVerticalSides(srcEntity: Entity, tgtEntity: Entity): { srcSide: Side; tgtSide: Side } {
  const srcCy = srcEntity.position.y + srcEntity.height / 2;
  const tgtCy = tgtEntity.position.y + tgtEntity.height / 2;

  return srcCy < tgtCy
    ? { srcSide: "bottom", tgtSide: "top" }
    : { srcSide: "top", tgtSide: "bottom" };
}

function buildSelfRelationRoute(
  entity: Entity,
  srcColIdx: number,
  tgtColIdx: number,
): RouteResult {
  return buildSelfLoopOnSide(entity, srcColIdx, tgtColIdx, "right");
}

function buildDirectRoute(srcPt: Point, tgtPt: Point, srcSide: Side, tgtSide: Side): Point[] {
  const isHorizontal = srcSide === "left" || srcSide === "right";

  if (isHorizontal) {
    const srcDir = srcSide === "right" ? 1 : -1;
    const tgtDir = tgtSide === "left" ? -1 : 1;
    const sx = srcPt.x + srcDir * STUB_LENGTH;
    const tx = tgtPt.x + tgtDir * STUB_LENGTH;
    const midX = (sx + tx) / 2;

    return [
      srcPt,
      { x: sx, y: srcPt.y },
      { x: midX, y: srcPt.y },
      { x: midX, y: tgtPt.y },
      { x: tx, y: tgtPt.y },
      tgtPt,
    ];
  }

  const srcDir = srcSide === "bottom" ? 1 : -1;
  const tgtDir = tgtSide === "top" ? -1 : 1;
  const sy = srcPt.y + srcDir * STUB_LENGTH;
  const ty = tgtPt.y + tgtDir * STUB_LENGTH;
  const midY = (sy + ty) / 2;

  return [
    srcPt,
    { x: srcPt.x, y: sy },
    { x: srcPt.x, y: midY },
    { x: tgtPt.x, y: midY },
    { x: tgtPt.x, y: ty },
    tgtPt,
  ];
}

function buildSelfLoopOnSide(
  entity: Entity,
  srcColIdx: number,
  tgtColIdx: number,
  side: "left" | "right",
): RouteResult {
  const srcPt = getConnectionPoint(entity, srcColIdx, side);
  const tgtPt = getConnectionPoint(entity, tgtColIdx, side);
  const dir = side === "right" ? 1 : -1;
  const stubX = srcPt.x + dir * STUB_LENGTH;
  const loopX = srcPt.x + dir * (STUB_LENGTH + SELF_LOOP_SIZE);
  const upperY = entity.position.y - SELF_LOOP_SIZE;

  return {
    srcSide: side,
    tgtSide: side,
    points: [
      srcPt,
      { x: stubX, y: srcPt.y },
      { x: loopX, y: srcPt.y },
      { x: loopX, y: upperY },
      { x: stubX, y: upperY },
      { x: stubX, y: tgtPt.y },
      tgtPt,
    ],
  };
}

function buildHorizontalDetour(srcPt: Point, tgtPt: Point, srcSide: Side, tgtSide: Side, laneY: number): Point[] {
  const srcDir = srcSide === "right" ? 1 : -1;
  const tgtDir = tgtSide === "left" ? -1 : 1;
  const sx = srcPt.x + srcDir * STUB_LENGTH;
  const tx = tgtPt.x + tgtDir * STUB_LENGTH;

  return [
    srcPt,
    { x: sx, y: srcPt.y },
    { x: sx, y: laneY },
    { x: tx, y: laneY },
    { x: tx, y: tgtPt.y },
    tgtPt,
  ];
}

function buildVerticalDetour(srcPt: Point, tgtPt: Point, srcSide: Side, tgtSide: Side, laneX: number): Point[] {
  const srcDir = srcSide === "bottom" ? 1 : -1;
  const tgtDir = tgtSide === "top" ? -1 : 1;
  const sy = srcPt.y + srcDir * STUB_LENGTH;
  const ty = tgtPt.y + tgtDir * STUB_LENGTH;

  return [
    srcPt,
    { x: srcPt.x, y: sy },
    { x: laneX, y: sy },
    { x: laneX, y: ty },
    { x: tgtPt.x, y: ty },
    tgtPt,
  ];
}

function polylineHitsEntities(points: Point[], entities: Entity[]): boolean {
  const rects = entities.map(toExpandedRect);

  for (let i = 0; i < points.length - 1; i++) {
    for (const rect of rects) {
      if (segmentIntersectsRect(points[i], points[i + 1], rect)) {
        return true;
      }
    }
  }

  return false;
}

function toExpandedRect(entity: Entity): Rect {
  return {
    left: entity.position.x - COLLISION_PADDING,
    right: entity.position.x + entity.width + COLLISION_PADDING,
    top: entity.position.y - COLLISION_PADDING,
    bottom: entity.position.y + entity.height + COLLISION_PADDING,
  };
}

function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);

  if (a.y === b.y) {
    return a.y >= rect.top && a.y <= rect.bottom && maxX >= rect.left && minX <= rect.right;
  }

  if (a.x === b.x) {
    return a.x >= rect.left && a.x <= rect.right && maxY >= rect.top && minY <= rect.bottom;
  }

  return false;
}

function polylineLength(points: Point[]): number {
  let total = 0;

  for (let i = 0; i < points.length - 1; i++) {
    total += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }

  return total;
}
