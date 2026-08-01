import type { Entity } from "../core/model/types";
import { ENTITY_PADDING, FONTS, DEFAULT_WIDTH, ROW_HEIGHT, getHeaderHeight } from "./constants";

let measureCtx: CanvasRenderingContext2D | null = null;

function getCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    measureCtx = canvas.getContext("2d")!;
  }
  return measureCtx;
}

function textW(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Measure the minimum width needed for an entity based on its content. */
export function calcEntityWidth(entity: Entity): number {
  const ctx = getCtx();
  const pad = ENTITY_PADDING;
  const gap = 24; // min gap between left (name+comment) and right (NN+type)

  // Header: name and comment
  let maxW = textW(ctx, FONTS.header, entity.name) + pad * 2;
  if (entity.comment) {
    maxW = Math.max(maxW, textW(ctx, FONTS.headerComment, entity.comment) + pad * 2 + 16);
  }

  // Each column row
  for (const col of entity.columns) {
    const iconW = (col.isPrimaryKey || col.isForeignKey) ? 18 : 0;
    const nameW = textW(ctx, FONTS.column, col.name);
    const commentW = col.comment ? textW(ctx, FONTS.columnComment, col.comment) + 16 : 0;
    const nnW = !col.nullable ? textW(ctx, FONTS.nnBadge, "NN") + 6 : 0;
    const uqW = col.isUnique && !col.isPrimaryKey ? textW(ctx, FONTS.nnBadge, "UQ") + 6 : 0;
    const typeW = textW(ctx, FONTS.columnType, col.type);
    const rowW = pad + iconW + nameW + commentW + gap + uqW + nnW + typeW + pad;
    maxW = Math.max(maxW, rowW);
  }

  return Math.max(DEFAULT_WIDTH, Math.ceil(maxW));
}

export function calcEntityHeight(columnCount: number, hasComment = false): number {
  return getHeaderHeight(hasComment) + ROW_HEIGHT * columnCount;
}

/** Return a new entity with recalculated width and height. */
export function recalcEntityDimensions(entity: Entity): Entity {
  const width = calcEntityWidth(entity);
  const height = calcEntityHeight(entity.columns.length, !!entity.comment);
  if (width === entity.width && height === entity.height) return entity;
  return { ...entity, width, height };
}
