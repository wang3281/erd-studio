import type { ERDSchema, Entity, Relation } from "../core/model/types";
import type { Viewport } from "./viewport";
import { screenToWorld } from "./viewport";
import { ROW_HEIGHT, getHeaderHeight } from "./constants";
import { getAllRelationRoutes, type RouteResult } from "./routing";

export type HitTarget =
  | { type: "entity"; entityId: string }
  | { type: "column"; entityId: string; columnId: string }
  | { type: "relation"; relationId: string }
  | { type: "canvas" };

export interface HitTestOptions {
  showInferredRelations?: boolean;
}

export function hitTest(
  schema: ERDSchema,
  vp: Viewport,
  screenX: number,
  screenY: number,
  routes?: Map<string, RouteResult>,
  options: HitTestOptions = {},
): HitTarget {
  const { x: wx, y: wy } = screenToWorld(vp, screenX, screenY);

  // check entities (reverse order = topmost first)
  for (let i = schema.entities.length - 1; i >= 0; i--) {
    const entity = schema.entities[i];
    const hit = hitTestEntity(entity, wx, wy);
    if (hit) return hit;
  }

  // check relations — 렌더러와 동일한(오프셋/넛지 적용된) 라우트와 visibility로 판정
  const resolvedRoutes = routes ?? getAllRelationRoutes(schema);
  const showInferredRelations = options.showInferredRelations ?? true;
  for (let index = schema.relations.length - 1; index >= 0; index--) {
    const rel = schema.relations[index];
    if (!showInferredRelations && (rel.source === "inferred" || rel.source === "ai")) continue;
    if (hitTestRelation(rel, resolvedRoutes, wx, wy, vp.zoom)) {
      return { type: "relation", relationId: rel.id };
    }
  }

  return { type: "canvas" };
}

function hitTestEntity(entity: Entity, wx: number, wy: number): HitTarget | null {
  const { x, y } = entity.position;
  if (wx < x || wx > x + entity.width || wy < y || wy > y + entity.height) {
    return null;
  }

  // header area → entity
  const headerH = getHeaderHeight(!!entity.comment);
  if (wy < y + headerH) {
    return { type: "entity", entityId: entity.id };
  }

  // column area
  const colIndex = Math.floor((wy - y - headerH) / ROW_HEIGHT);
  if (colIndex >= 0 && colIndex < entity.columns.length) {
    return { type: "column", entityId: entity.id, columnId: entity.columns[colIndex].id };
  }

  return { type: "entity", entityId: entity.id };
}

function hitTestRelation(rel: Relation, routes: Map<string, RouteResult>, wx: number, wy: number, zoom: number): boolean {
  const route = routes.get(rel.id);
  if (!route) return false;

  // Keep relation hit target stable in screen pixels after screenToWorld conversion.
  const threshold = 5 / Math.max(zoom, 0.001);
  for (let i = 0; i < route.points.length - 1; i++) {
    if (distToSegment(wx, wy, route.points[i].x, route.points[i].y, route.points[i + 1].x, route.points[i + 1].y) < threshold) {
      return true;
    }
  }
  return false;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (ax + t * abx)) ** 2 + (py - (ay + t * aby)) ** 2);
}
