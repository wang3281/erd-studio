import type { ERDSchema, Entity, Relation } from "../core/model/types";
import type { Viewport } from "./viewport";
import { worldToScreen } from "./viewport";
import type { ColorScheme } from "./constants";
import {
  ROW_HEIGHT,
  ENTITY_PADDING,
  GRID_SIZE,
  COLORS,
  FONTS,
  getHeaderHeight,
  RELATION_ENDPOINT_RADIUS,
  RELATION_ENDPOINT_RADIUS_HOVER,
  RELATION_ENDPOINT_RING_WIDTH,
  CROW_FOOT_SIZE,
  CROW_FOOT_STROKE,
  RELATION_PIN_PADDING_X,
  RELATION_PIN_PADDING_Y,
  RELATION_PIN_OFFSET,
  RELATION_PIN_RADIUS,
} from "./constants";
import { getAllRelationRoutes, type RouteResult, type Side } from "./routing";

type Selection =
  | { type: "none" }
  | { type: "entity"; entityId: string }
  | { type: "column"; entityId: string; columnId: string }
  | { type: "relation"; relationId: string }
  | { type: "entities"; entityIds: string[] };

const RELATION_PIN_MIN_ZOOM = 0.55;
export const SEMANTIC_OVERVIEW_ZOOM = 0.55;
const RELATION_LABEL_COLLISION_PADDING = 12;

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function render(
  ctx: CanvasRenderingContext2D,
  schema: ERDSchema,
  viewport: Viewport,
  selection: Selection,
  canvasWidth: number,
  canvasHeight: number,
  colors: ColorScheme = COLORS,
  showInferredRelations: boolean = true,
  hoveredRelationId?: string,
  precomputedRoutes?: Map<string, RouteResult>,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Layer 1: background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  drawGrid(ctx, viewport, canvasWidth, canvasHeight, colors);

  // Layer 2: entity backgrounds (boxes, shadows, borders, header fills)
  for (const entity of schema.entities) {
    const isSelected =
      (selection.type === "entity" && selection.entityId === entity.id) ||
      (selection.type === "column" && selection.entityId === entity.id) ||
      (selection.type === "entities" && selection.entityIds.includes(entity.id));
    drawEntityBackground(ctx, entity, viewport, isSelected, colors);
  }

  // Pre-compute all relation routes once so endpoint collisions can be resolved together.
  // 호출부(CanvasView)가 hitTest와 공유하는 캐시를 주입하면 재계산을 생략한다.
  const routes = precomputedRoutes ?? getAllRelationRoutes(schema);

  // Layer 3: relations (on top of entity boxes, under text)
  const relationItems: Array<{
    rel: Relation;
    route: RouteResult;
    isSelected: boolean;
    isHovered: boolean;
  }> = [];
  for (const rel of schema.relations) {
    if (!showInferredRelations && (rel.source === "inferred" || rel.source === "ai")) continue;
    const route = routes.get(rel.id);
    if (!route) continue;
    const isSelected = selection.type === "relation" && selection.relationId === rel.id;
    const isHovered = hoveredRelationId === rel.id;
    relationItems.push({ rel, route, isSelected, isHovered });
  }
  const relationPinBounds = viewport.zoom >= RELATION_PIN_MIN_ZOOM
    ? relationItems.flatMap(({ rel, route, isSelected, isHovered }) => {
        if (!isSelected && !isHovered) return [];
        const screenPoints = route.points.map((point) => worldToScreen(viewport, point.x, point.y));
        return getRelationPinPairBounds(
          ctx,
          rel,
          route,
          screenPoints[0],
          screenPoints[screenPoints.length - 1],
          schema,
          viewport,
        );
      })
    : [];
  const occupiedLabelBounds = [...relationPinBounds];
  for (const { rel, route, isSelected, isHovered } of relationItems) {
    drawRelation(ctx, rel, route, schema, viewport, isSelected, isHovered, colors, occupiedLabelBounds);
  }

  // Compute connected columns for FK highlight
  const connectedColumns = new Set<string>();
  for (const rel of schema.relations) {
    if (!showInferredRelations && (rel.source === "inferred" || rel.source === "ai")) continue;
    connectedColumns.add(rel.sourceEntityId + ":" + rel.sourceColumnId);
    connectedColumns.add(rel.targetEntityId + ":" + rel.targetColumnId);
  }

  // Layer 4: entity foregrounds (text, icons, badges — always readable)
  for (const entity of schema.entities) {
    drawEntityForeground(ctx, entity, viewport, colors, connectedColumns);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, w: number, h: number, colors: ColorScheme): void {
  ctx.fillStyle = colors.gridDot;
  const step = GRID_SIZE * vp.zoom;
  if (step < 5) return; // too zoomed out

  const startX = vp.offsetX % step;
  const startY = vp.offsetY % step;

  // 점당 beginPath/fill 대신 한 패스에 누적 후 1회 fill (줌아웃 시 draw call 폭증 방지)
  ctx.beginPath();
  for (let x = startX; x < w; x += step) {
    for (let y = startY; y < h; y += step) {
      ctx.moveTo(x + 1, y); // 이전 arc와 선으로 이어지지 않도록 시작점 이동
      ctx.arc(x, y, 1, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function drawEntityBackground(ctx: CanvasRenderingContext2D, entity: Entity, vp: Viewport, selected: boolean, colors: ColorScheme): void {
  const { x: sx, y: sy } = worldToScreen(vp, entity.position.x, entity.position.y);
  const w = entity.width * vp.zoom;
  const h = entity.height * vp.zoom;
  const headerH = getHeaderHeight(!!entity.comment) * vp.zoom;
  const r = 6 * vp.zoom;

  // shadow
  ctx.save();
  ctx.shadowColor = colors.entityShadow;
  ctx.shadowBlur = 8 * vp.zoom;
  ctx.shadowOffsetY = 2 * vp.zoom;

  // body
  ctx.fillStyle = colors.entityBg;
  ctx.beginPath();
  ctx.roundRect(sx, sy, w, h, r);
  ctx.fill();
  ctx.restore();

  // border
  ctx.strokeStyle = selected ? colors.entityBorderSelected : colors.entityBorder;
  ctx.lineWidth = selected ? 2 : 1;
  ctx.beginPath();
  ctx.roundRect(sx, sy, w, h, r);
  ctx.stroke();

  // header bg
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(sx, sy, w, headerH, [r, r, 0, 0]);
  ctx.clip();
  ctx.fillStyle = entity.headerColor ?? colors.entityHeader;
  ctx.fillRect(sx, sy, w, headerH);
  ctx.restore();
}

function drawEntityForeground(ctx: CanvasRenderingContext2D, entity: Entity, vp: Viewport, colors: ColorScheme, connectedColumns: Set<string>): void {
  const { x: sx, y: sy } = worldToScreen(vp, entity.position.x, entity.position.y);
  const w = entity.width * vp.zoom;
  const headerH = getHeaderHeight(!!entity.comment) * vp.zoom;
  const rowH = ROW_HEIGHT * vp.zoom;
  const pad = ENTITY_PADDING * vp.zoom;
  const headerTextColor = entity.headerColor ? getReadableTextColor(entity.headerColor) : colors.entityHeaderText;

  if (vp.zoom < SEMANTIC_OVERVIEW_ZOOM) {
    const overviewPadding = Math.max(pad, 3);
    ctx.textBaseline = "middle";
    ctx.fillStyle = headerTextColor;
    ctx.font = scaledFontAtLeast(FONTS.header, vp.zoom, 10);
    ctx.fillText(
      entity.name,
      sx + overviewPadding,
      sy + headerH / 2,
      Math.max(0, w - overviewPadding * 2),
    );

    ctx.strokeStyle = colors.entityBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy + headerH);
    ctx.lineTo(sx + w, sy + headerH);
    ctx.stroke();

    ctx.fillStyle = colors.columnType;
    ctx.font = scaledFontAtLeast(FONTS.columnType, vp.zoom, 10);
    ctx.fillText(
      `${entity.columns.length} columns`,
      sx + overviewPadding,
      Math.min(sy + entity.height * vp.zoom - 6, sy + headerH + 10),
      Math.max(0, w - overviewPadding * 2),
    );
    return;
  }

  const statusBadge = entity.status ? getStatusBadgeMetrics(ctx, entity.status, colors, vp) : null;
  const titleGap = statusBadge ? 8 * vp.zoom : 0;
  const titleMaxWidth = Math.max(0, w - pad * 2 - (statusBadge?.width ?? 0) - titleGap);
  const titleY = entity.comment ? sy + headerH * 0.31 : sy + headerH / 2;

  // header text
  ctx.textBaseline = "middle";
  if (entity.comment) {
    ctx.fillStyle = headerTextColor;
    ctx.font = scaledFont(FONTS.header, vp.zoom);
    ctx.fillText(entity.name, sx + pad, titleY, titleMaxWidth);

    ctx.font = scaledFont(FONTS.headerComment, vp.zoom);
    const commentTextW = ctx.measureText(entity.comment).width;
    const pillPadX = 8 * vp.zoom;
    const pillPadY = 2 * vp.zoom;
    const pillX = sx + pad - pillPadX;
    const pillY = sy + headerH * 0.71 - 6 * vp.zoom - pillPadY;
    const pillW = commentTextW + pillPadX * 2;
    const pillH = 12 * vp.zoom + pillPadY * 2;
    const pillR = 4 * vp.zoom;

    ctx.fillStyle = colors.headerCommentBadgeBg;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, pillR);
    ctx.fill();

    ctx.fillStyle = colors.entityHeaderComment;
    ctx.fillText(entity.comment, sx + pad, sy + headerH * 0.71, w - pad * 2);
  } else {
    ctx.fillStyle = headerTextColor;
    ctx.font = scaledFont(FONTS.header, vp.zoom);
    ctx.fillText(entity.name, sx + pad, titleY, titleMaxWidth);
  }

  if (statusBadge && entity.status) {
    drawEntityStatusBadge(ctx, sx + w - pad - statusBadge.width, titleY, entity.status, colors, vp);
  }

  // separator
  ctx.strokeStyle = colors.entityBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, sy + headerH);
  ctx.lineTo(sx + w, sy + headerH);
  ctx.stroke();

  // columns
  for (let i = 0; i < entity.columns.length; i++) {
    const col = entity.columns[i];
    const cy = sy + headerH + i * rowH + rowH / 2;

    // FK highlight
    if (connectedColumns.has(entity.id + ":" + col.id)) {
      ctx.fillStyle = colors.fkHighlight;
      ctx.fillRect(sx + 1, sy + headerH + i * rowH, w - 2, rowH);
    }

    let iconOffset = pad;
    if (col.isPrimaryKey) {
      ctx.fillStyle = colors.pkIcon;
      ctx.font = scaledFont(FONTS.icon, vp.zoom);
      ctx.fillText("\u{1F511}", sx + pad, cy);
      iconOffset = pad + 18 * vp.zoom;
    } else if (col.isForeignKey) {
      ctx.fillStyle = colors.fkIcon;
      ctx.font = scaledFont(FONTS.icon, vp.zoom);
      ctx.fillText("\u{1F517}", sx + pad, cy);
      iconOffset = pad + 18 * vp.zoom;
    }

    ctx.fillStyle = colors.columnText;
    ctx.font = scaledFont(FONTS.column, vp.zoom);
    ctx.fillText(col.name, sx + iconOffset, cy);

    if (col.comment) {
      const nameWidth = ctx.measureText(col.name).width;
      const sepX = sx + iconOffset + nameWidth + 4 * vp.zoom;

      ctx.fillStyle = colors.columnSeparator;
      ctx.font = scaledFont(FONTS.columnComment, vp.zoom);
      ctx.fillText("\u00B7", sepX, cy);
      const sepW = ctx.measureText("\u00B7").width;

      ctx.fillStyle = colors.columnComment;
      ctx.fillText(col.comment, sepX + sepW + 4 * vp.zoom, cy);
    }

    ctx.font = scaledFont(FONTS.columnType, vp.zoom);
    const typeWidth = ctx.measureText(col.type).width;
    let rightX = sx + w - pad;

    ctx.fillStyle = colors.columnType;
    ctx.fillText(col.type, rightX - typeWidth, cy);
    rightX -= typeWidth + 4 * vp.zoom;

    ctx.font = scaledFont(FONTS.nnBadge, vp.zoom);
    if (!col.nullable) {
      const nnText = "NN";
      const nnW = ctx.measureText(nnText).width;
      ctx.fillStyle = colors.nnBadge;
      ctx.fillText(nnText, rightX - nnW, cy);
      rightX -= nnW + 4 * vp.zoom;
    }

    if (col.isUnique && !col.isPrimaryKey) {
      const uqText = "UQ";
      const uqW = ctx.measureText(uqText).width;
      ctx.fillStyle = colors.uqBadge;
      ctx.fillText(uqText, rightX - uqW, cy);
    }
  }
}

function drawEntityStatusBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  centerY: number,
  status: Entity["status"],
  colors: ColorScheme,
  vp: Viewport,
): void {
  if (!status) return;

  const badge = getStatusBadgeMetrics(ctx, status, colors, vp);
  const boxY = centerY - badge.height / 2;
  const radius = badge.height / 2;

  ctx.save();
  ctx.font = scaledFont(FONTS.headerComment, vp.zoom);
  ctx.textBaseline = "middle";
  ctx.fillStyle = badge.bg;
  ctx.beginPath();
  ctx.roundRect(x, boxY, badge.width, badge.height, radius);
  ctx.fill();

  ctx.fillStyle = badge.fg;
  ctx.fillText(badge.label, x + badge.padX, centerY);
  ctx.restore();
}

function getStatusBadgeMetrics(
  ctx: CanvasRenderingContext2D,
  status: NonNullable<Entity["status"]>,
  colors: ColorScheme,
  vp: Viewport,
): { label: string; bg: string; fg: string; width: number; height: number; padX: number } {
  ctx.save();
  ctx.font = scaledFont(FONTS.headerComment, vp.zoom);
  const label = colors.entityStatus[status].label;
  const labelWidth = ctx.measureText(label).width;
  ctx.restore();

  const padX = 6 * vp.zoom;
  const height = 18 * vp.zoom;
  return {
    label,
    bg: colors.entityStatus[status].bg,
    fg: colors.entityStatus[status].fg,
    width: labelWidth + padX * 2,
    height,
    padX,
  };
}

function getReadableTextColor(hex: string): "#0F172A" | "#FFFFFF" {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return "#FFFFFF";

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq > 149 ? "#0F172A" : "#FFFFFF";
}

function drawRelation(
  ctx: CanvasRenderingContext2D,
  rel: Relation,
  route: RouteResult,
  schema: ERDSchema,
  vp: Viewport,
  selected: boolean,
  hovered: boolean,
  colors: ColorScheme,
  avoidLabelBounds: Bounds[],
): void {
  const { srcSide, tgtSide } = route;
  const screenPoints = route.points.map((point) => worldToScreen(vp, point.x, point.y));
  const s = screenPoints[0];
  const t = screenPoints[screenPoints.length - 1];

  const emphasize = selected || hovered;
  const shouldDrawPins = emphasize && vp.zoom >= RELATION_PIN_MIN_ZOOM;

  // style
  const isInferred = rel.source === "inferred";
  const isAI = rel.source === "ai";
  const lineColor = isAI
    ? emphasize ? colors.relationLineAISelected : colors.relationLineAI
    : isInferred
      ? emphasize ? colors.relationLineInferredSelected : colors.relationLineInferred
      : emphasize ? colors.relationLineSelected : colors.relationLine;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = (emphasize ? 2 : 1.5) * vp.zoom;

  if (isAI) {
    ctx.setLineDash([8 * vp.zoom, 4 * vp.zoom, 2 * vp.zoom, 4 * vp.zoom]);
  } else if (isInferred) {
    ctx.setLineDash([6 * vp.zoom, 4 * vp.zoom]);
  } else {
    ctx.setLineDash([]);
  }

  // Orthogonal routing
  ctx.beginPath();
  ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
  for (let i = 1; i < screenPoints.length; i++) {
    ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Endpoint anchor dots (below crow's foot)
  drawRelationEndpoint(ctx, s.x, s.y, emphasize, lineColor, colors, vp);
  drawRelationEndpoint(ctx, t.x, t.y, emphasize, lineColor, colors, vp);

  // Crow's foot ends
  const footSize = CROW_FOOT_SIZE * vp.zoom;
  ctx.lineWidth = CROW_FOOT_STROKE * vp.zoom;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = lineColor;
  drawCrowsFoot(ctx, s.x, s.y, srcSide, rel.cardinality, "source", footSize);
  drawCrowsFoot(ctx, t.x, t.y, tgtSide, rel.cardinality, "target", footSize);
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";

  const cardinalityBounds = drawRelationCardinalityLabel(ctx, screenPoints, rel.cardinality, vp, colors, lineColor, avoidLabelBounds);
  if (cardinalityBounds) {
    avoidLabelBounds.push(cardinalityBounds);
  }

  if (shouldDrawPins) {
    drawRelationPinPair(ctx, rel, route, s, t, schema, vp, colors);
  }
}

function drawRelationEndpoint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  emphasize: boolean,
  lineColor: string,
  colors: ColorScheme,
  vp: Viewport,
): void {
  const radius = (emphasize ? RELATION_ENDPOINT_RADIUS_HOVER : RELATION_ENDPOINT_RADIUS) * vp.zoom;
  const ringWidth = RELATION_ENDPOINT_RING_WIDTH * vp.zoom;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius + ringWidth / 2, 0, Math.PI * 2);
  ctx.fillStyle = colors.relationEndpointRing;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = emphasize ? colors.relationEndpointSelected : lineColor;
  ctx.fill();
  ctx.restore();
}

function drawRelationPinPair(
  ctx: CanvasRenderingContext2D,
  rel: Relation,
  route: RouteResult,
  srcScreen: { x: number; y: number },
  tgtScreen: { x: number; y: number },
  schema: ERDSchema,
  vp: Viewport,
  colors: ColorScheme,
): void {
  const srcLabel = formatEndpointLabel(schema, rel.sourceEntityId, rel.sourceColumnId);
  const tgtLabel = formatEndpointLabel(schema, rel.targetEntityId, rel.targetColumnId);
  if (srcLabel) drawRelationPin(ctx, srcScreen.x, srcScreen.y, route.srcSide, srcLabel, vp, colors);
  if (tgtLabel) drawRelationPin(ctx, tgtScreen.x, tgtScreen.y, route.tgtSide, tgtLabel, vp, colors);
}

function getRelationPinPairBounds(
  ctx: CanvasRenderingContext2D,
  rel: Relation,
  route: RouteResult,
  srcScreen: { x: number; y: number },
  tgtScreen: { x: number; y: number },
  schema: ERDSchema,
  vp: Viewport,
): Bounds[] {
  const bounds: Bounds[] = [];
  const srcLabel = formatEndpointLabel(schema, rel.sourceEntityId, rel.sourceColumnId);
  const tgtLabel = formatEndpointLabel(schema, rel.targetEntityId, rel.targetColumnId);
  if (srcLabel) bounds.push(getRelationPinBounds(ctx, srcScreen.x, srcScreen.y, route.srcSide, srcLabel, vp));
  if (tgtLabel) bounds.push(getRelationPinBounds(ctx, tgtScreen.x, tgtScreen.y, route.tgtSide, tgtLabel, vp));
  return bounds;
}

function formatEndpointLabel(schema: ERDSchema, entityId: string, columnId: string): string | null {
  const entity = schema.entities.find((e) => e.id === entityId);
  if (!entity) return null;
  const column = entity.columns.find((c) => c.id === columnId);
  if (!column) return null;
  return `${entity.name}.${column.name}`;
}

function drawRelationPin(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  side: Side,
  label: string,
  vp: Viewport,
  colors: ColorScheme,
): void {
  ctx.save();
  const bounds = getRelationPinBounds(ctx, anchorX, anchorY, side, label, vp);
  ctx.font = scaledFont(FONTS.columnType, vp.zoom);
  ctx.textBaseline = "middle";
  const padX = RELATION_PIN_PADDING_X * vp.zoom;
  const radius = RELATION_PIN_RADIUS * vp.zoom;

  ctx.fillStyle = colors.relationPinBg;
  ctx.strokeStyle = colors.relationPinBorder;
  ctx.lineWidth = Math.max(1, vp.zoom);
  ctx.beginPath();
  ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.relationPinText;
  ctx.fillText(label, bounds.x + padX, bounds.y + bounds.height / 2);
  ctx.restore();
}

function getRelationPinBounds(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  side: Side,
  label: string,
  vp: Viewport,
): Bounds {
  ctx.save();
  ctx.font = scaledFont(FONTS.columnType, vp.zoom);
  const padX = RELATION_PIN_PADDING_X * vp.zoom;
  const padY = RELATION_PIN_PADDING_Y * vp.zoom;
  const width = ctx.measureText(label).width + padX * 2;
  ctx.restore();

  const height = 14 * vp.zoom + padY * 2;
  const offset = RELATION_PIN_OFFSET * vp.zoom;

  switch (side) {
    case "right":
      return { x: anchorX + offset, y: anchorY - height / 2, width, height };
    case "left":
      return { x: anchorX - offset - width, y: anchorY - height / 2, width, height };
    case "bottom":
      return { x: anchorX - width / 2, y: anchorY + offset, width, height };
    case "top":
      return { x: anchorX - width / 2, y: anchorY - offset - height, width, height };
  }
}

function drawRelationCardinalityLabel(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  cardinality: string,
  vp: Viewport,
  colors: ColorScheme,
  lineColor: string,
  avoidBounds: Bounds[],
): Bounds | null {
  const anchor = getPolylineMidpoint(points);
  if (!anchor) return null;

  ctx.save();
  ctx.font = scaledFont(FONTS.columnType, vp.zoom);
  const textW = ctx.measureText(cardinality).width;
  const padX = 6 * vp.zoom;
  const boxW = textW + padX * 2;
  const boxH = 18 * vp.zoom;
  const radius = 6 * vp.zoom;
  const offset = 10 * vp.zoom;
  const boxX = anchor.orientation === "vertical"
    ? anchor.x + offset - boxW / 2
    : anchor.x - boxW / 2;
  const boxY = anchor.orientation === "vertical"
    ? anchor.y - boxH / 2
    : anchor.y - offset - boxH / 2;
  const bounds = { x: boxX, y: boxY, width: boxW, height: boxH };
  const reservedBounds = expandBounds(bounds, RELATION_LABEL_COLLISION_PADDING * vp.zoom);
  if (avoidBounds.some((avoid) => rectsOverlap(reservedBounds, avoid))) {
    return null;
  }

  ctx.fillStyle = colors.entityBg;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, radius);
  ctx.fill();

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = Math.max(1, vp.zoom);
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, radius);
  ctx.stroke();

  ctx.fillStyle = colors.columnText;
  ctx.textBaseline = "middle";
  ctx.fillText(cardinality, boxX + padX, boxY + boxH / 2);
  ctx.restore();
  return reservedBounds;
}

function expandBounds(bounds: Bounds, padding: number): Bounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function rectsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

function getPolylineMidpoint(points: Array<{ x: number; y: number }>): { x: number; y: number; orientation: "horizontal" | "vertical" } | null {
  if (points.length < 2) return null;

  let total = 0;
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= 0) continue;
    total += length;
    segments.push({ start, end, length });
  }
  if (segments.length === 0) return null;

  let traversed = 0;
  const target = total / 2;
  for (const segment of segments) {
    if (traversed + segment.length >= target) {
      const ratio = (target - traversed) / segment.length;
      const x = segment.start.x + (segment.end.x - segment.start.x) * ratio;
      const y = segment.start.y + (segment.end.y - segment.start.y) * ratio;
      return {
        x,
        y,
        orientation: Math.abs(segment.end.x - segment.start.x) >= Math.abs(segment.end.y - segment.start.y)
          ? "horizontal"
          : "vertical",
      };
    }
    traversed += segment.length;
  }

  const last = segments[segments.length - 1];
  return {
    x: last.end.x,
    y: last.end.y,
    orientation: Math.abs(last.end.x - last.start.x) >= Math.abs(last.end.y - last.start.y)
      ? "horizontal"
      : "vertical",
  };
}

function drawCrowsFoot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  side: Side,
  cardinality: string,
  end: "source" | "target",
  size: number,
): void {
  const isMany = (end === "source" && (cardinality === "N:1" || cardinality === "N:M")) ||
                 (end === "target" && (cardinality === "1:N" || cardinality === "N:M"));

  // direction vector pointing away from entity
  const dx = side === "right" ? 1 : side === "left" ? -1 : 0;
  const dy = side === "bottom" ? 1 : side === "top" ? -1 : 0;
  // perpendicular
  const px = dy;
  const py = -dx;

  if (isMany) {
    ctx.beginPath();
    ctx.moveTo(x + dx * size + px * size * 0.6, y + dy * size + py * size * 0.6);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * size - px * size * 0.6, y + dy * size - py * size * 0.6);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x + dx * size * 0.4 + px * size * 0.5, y + dy * size * 0.4 + py * size * 0.5);
    ctx.lineTo(x + dx * size * 0.4 - px * size * 0.5, y + dy * size * 0.4 - py * size * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + dx * size * 0.7 + px * size * 0.5, y + dy * size * 0.7 + py * size * 0.5);
    ctx.lineTo(x + dx * size * 0.7 - px * size * 0.5, y + dy * size * 0.7 - py * size * 0.5);
    ctx.stroke();
  }
}

function scaledFont(font: string, zoom: number): string {
  return font.replace(/(\d+)px/, (_, size) => `${Math.round(Number(size) * zoom)}px`);
}

function scaledFontAtLeast(font: string, zoom: number, minimumPixels: number): string {
  return font.replace(
    /(\d+)px/,
    (_, size) => `${Math.max(minimumPixels, Math.round(Number(size) * zoom))}px`,
  );
}
