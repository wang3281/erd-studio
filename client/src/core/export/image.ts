import type { ERDSchema } from "../model/types";
import { render } from "../../canvas/renderer";
import type { Theme } from "../../canvas/constants";
import { getColors } from "../../canvas/constants";

const PADDING = 40;
const SCALE = 2; // 2x for crisp export

/**
 * Render the full ERD schema to a PNG blob using an offscreen canvas.
 * Returns null if the schema has no entities.
 */
export async function exportToImage(schema: ERDSchema, theme: Theme = "light"): Promise<Blob | null> {
  if (schema.entities.length === 0) return null;

  // Calculate bounding box of all entities
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const e of schema.entities) {
    minX = Math.min(minX, e.position.x);
    minY = Math.min(minY, e.position.y);
    maxX = Math.max(maxX, e.position.x + e.width);
    maxY = Math.max(maxY, e.position.y + e.height);
  }

  const contentW = maxX - minX + PADDING * 2;
  const contentH = maxY - minY + PADDING * 2;

  const canvasW = contentW * SCALE;
  const canvasH = contentH * SCALE;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Build a viewport that frames all entities with padding
  const viewport = {
    offsetX: (-minX + PADDING) * SCALE,
    offsetY: (-minY + PADDING) * SCALE,
    zoom: SCALE,
  };

  const noSelection = { type: "none" as const };

  render(ctx, schema, viewport, noSelection, canvasW, canvasH, getColors(theme));

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}
