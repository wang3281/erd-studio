export interface Viewport {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(vp: Viewport, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: (screenX - vp.offsetX) / vp.zoom,
    y: (screenY - vp.offsetY) / vp.zoom,
  };
}

export function worldToScreen(vp: Viewport, worldX: number, worldY: number): { x: number; y: number } {
  return {
    x: worldX * vp.zoom + vp.offsetX,
    y: worldY * vp.zoom + vp.offsetY,
  };
}

export function getBounds(
  items: Array<{ position: { x: number; y: number }; width: number; height: number }>,
): Bounds | null {
  if (items.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const item of items) {
    minX = Math.min(minX, item.position.x);
    minY = Math.min(minY, item.position.y);
    maxX = Math.max(maxX, item.position.x + item.width);
    maxY = Math.max(maxY, item.position.y + item.height);
  }

  return { minX, minY, maxX, maxY };
}

export function createViewportToFit(
  items: Array<{ position: { x: number; y: number }; width: number; height: number }>,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 40,
): Viewport {
  const bounds = getBounds(items);
  if (!bounds || canvasWidth <= 0 || canvasHeight <= 0) {
    return createDefaultViewport();
  }

  const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const availableWidth = Math.max(canvasWidth - padding * 2, 1);
  const availableHeight = Math.max(canvasHeight - padding * 2, 1);
  const zoom = clampZoom(Math.min(availableWidth / contentWidth, availableHeight / contentHeight));

  return {
    offsetX: (canvasWidth - contentWidth * zoom) / 2 - bounds.minX * zoom,
    offsetY: (canvasHeight - contentHeight * zoom) / 2 - bounds.minY * zoom,
    zoom,
  };
}

export function createViewportCenteredOn(
  item: { position: { x: number; y: number }; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
  currentZoom: number,
  minimumZoom: number = 0.75,
): Viewport {
  const zoom = clampZoom(Math.max(currentZoom, minimumZoom));
  const centerX = item.position.x + item.width / 2;
  const centerY = item.position.y + item.height / 2;

  return {
    offsetX: canvasWidth / 2 - centerX * zoom,
    offsetY: canvasHeight / 2 - centerY * zoom,
    zoom,
  };
}

export function createDefaultViewport(): Viewport {
  return { offsetX: 0, offsetY: 0, zoom: 1 };
}
