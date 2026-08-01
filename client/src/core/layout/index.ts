import type { Entity, Relation } from "../model/types";

export interface LayoutOptions {
  startX: number;
  startY: number;
  gapX: number;
  gapY: number;
  maxColumnsPerRow: number;
}

const DEFAULT_OPTIONS: LayoutOptions = {
  startX: 80,
  startY: 80,
  gapX: 120,
  gapY: 80,
  maxColumnsPerRow: 4,
};

export function layoutGrid(entities: Entity[], options?: Partial<LayoutOptions>): Entity[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const colWidths = computeColumnWidths(entities, opts.maxColumnsPerRow);
  const rowHeights = computeRowHeights(entities, opts.maxColumnsPerRow);
  const colOffsets = computeOffsets(colWidths, opts.startX, opts.gapX);
  const rowOffsets = computeOffsets(rowHeights, opts.startY, opts.gapY);

  return entities.map((entity, index) => {
    const col = index % opts.maxColumnsPerRow;
    const row = Math.floor(index / opts.maxColumnsPerRow);
    const x = colOffsets[col] ?? opts.startX;
    const y = rowOffsets[row] ?? opts.startY;

    return { ...entity, position: { x, y } };
  });
}

export function findEmptyPosition(entities: Entity[], candidate?: Pick<Entity, "width" | "height">): { x: number; y: number } {
  const opts = DEFAULT_OPTIONS;
  if (entities.length === 0) return { x: opts.startX, y: opts.startY };

  const index = entities.length;
  const col = index % opts.maxColumnsPerRow;
  const row = Math.floor(index / opts.maxColumnsPerRow);
  const colWidths = computeColumnWidths(entities, opts.maxColumnsPerRow);
  const rowHeights = computeRowHeights(entities, opts.maxColumnsPerRow);
  const colOffsets = computeOffsets(colWidths, opts.startX, opts.gapX);
  const rowOffsets = computeOffsets(rowHeights, opts.startY, opts.gapY);

  const preferred = {
    x: col === 0
      ? opts.startX
      : (colOffsets[col] ?? computeNextOffset(colWidths, col, opts.startX, opts.gapX)),
    y: row === 0
      ? opts.startY
      : (rowOffsets[row] ?? computeNextOffset(rowHeights, row, opts.startY, opts.gapY)),
  };
  const width = candidate?.width ?? 220;
  const height = candidate?.height ?? 40;
  const isFree = (position: { x: number; y: number }) => !entities.some((entity) =>
    entity.position.x < position.x + width && entity.position.x + entity.width > position.x &&
    entity.position.y < position.y + height && entity.position.y + entity.height > position.y
  );
  if (isFree(preferred)) return preferred;

  const maxBottom = Math.max(...entities.map((entity) => entity.position.y + entity.height));
  const rowStep = height + opts.gapY;
  const rowLimit = Math.ceil((maxBottom - opts.startY) / rowStep) + 2;
  for (let scanRow = 0; scanRow <= rowLimit; scanRow++) {
    for (let scanCol = 0; scanCol < opts.maxColumnsPerRow; scanCol++) {
      const position = {
        x: opts.startX + scanCol * (width + opts.gapX),
        y: opts.startY + scanRow * rowStep,
      };
      if (isFree(position)) return position;
    }
  }
  return { x: opts.startX, y: maxBottom + opts.gapY };
}

function computeColumnWidths(entities: Entity[], maxColumnsPerRow: number): number[] {
  const columnCount = Math.min(maxColumnsPerRow, entities.length);
  const widths = Array.from({ length: columnCount }, () => 0);

  for (let index = 0; index < entities.length; index++) {
    const col = index % maxColumnsPerRow;
    widths[col] = Math.max(widths[col] ?? 0, entities[index].width);
  }

  return widths;
}

function computeRowHeights(entities: Entity[], maxColumnsPerRow: number): number[] {
  const rowCount = Math.ceil(entities.length / maxColumnsPerRow);
  const heights = Array.from({ length: rowCount }, () => 0);

  for (let index = 0; index < entities.length; index++) {
    const row = Math.floor(index / maxColumnsPerRow);
    heights[row] = Math.max(heights[row] ?? 0, entities[index].height);
  }

  return heights;
}

function computeOffsets(sizes: number[], start: number, gap: number): number[] {
  const offsets: number[] = [];
  let cursor = start;

  for (let i = 0; i < sizes.length; i++) {
    offsets.push(cursor);
    cursor += sizes[i] + gap;
  }

  return offsets;
}

function computeNextOffset(sizes: number[], index: number, start: number, gap: number): number {
  let cursor = start;

  for (let i = 0; i < index; i++) {
    cursor += (sizes[i] ?? 0) + gap;
  }

  return cursor;
}

// ---------------------------------------------------------------------------
// Auto-layout: Hierarchical (Sugiyama-style) layer assignment
// ---------------------------------------------------------------------------

interface AutoLayoutOptions {
  direction: "LR" | "TB"; // left-to-right or top-to-bottom
  layerGap: number;       // gap between layers
  nodeGap: number;        // gap between nodes within a layer
  padding: number;        // canvas padding
}

const AUTO_LAYOUT_DEFAULTS: AutoLayoutOptions = {
  direction: "TB",
  layerGap: 160,
  nodeGap: 80,
  padding: 80,
};

/**
 * Auto-layout entities based on their FK relationships.
 * Uses BFS layer assignment with parent entities on the left, children on the right.
 */
export function autoLayout(
  entities: Entity[],
  relations: Relation[],
  options?: Partial<AutoLayoutOptions>,
): Entity[] {
  if (entities.length === 0) return entities;
  if (entities.length === 1) {
    return [{ ...entities[0], position: { x: AUTO_LAYOUT_DEFAULTS.padding, y: AUTO_LAYOUT_DEFAULTS.padding } }];
  }

  const opts = { ...AUTO_LAYOUT_DEFAULTS, ...options };
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  // 1) Build directed graph: target (master/PK) → source (child/FK)
  //    In Relation model: sourceEntity = FK side (child), targetEntity = PK side (master)
  const children = new Map<string, Set<string>>();   // masterId → childIds
  const parents = new Map<string, Set<string>>();     // childId → masterIds
  for (const e of entities) {
    children.set(e.id, new Set());
    parents.set(e.id, new Set());
  }
  for (const rel of relations) {
    if (!entityMap.has(rel.sourceEntityId) || !entityMap.has(rel.targetEntityId)) continue;
    if (rel.sourceEntityId === rel.targetEntityId) continue; // self-ref
    // targetEntity = master (PK), sourceEntity = child (FK)
    children.get(rel.targetEntityId)!.add(rel.sourceEntityId);
    parents.get(rel.sourceEntityId)!.add(rel.targetEntityId);
  }

  // 2) Break cycles using DFS (remove back-edges)
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const backEdges = new Set<string>(); // "src->tgt"
  function dfs(nodeId: string) {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const child of children.get(nodeId)!) {
      if (inStack.has(child)) {
        backEdges.add(`${nodeId}->${child}`);
      } else if (!visited.has(child)) {
        dfs(child);
      }
    }
    inStack.delete(nodeId);
  }
  for (const e of entities) {
    if (!visited.has(e.id)) dfs(e.id);
  }
  // Remove back-edges from the graph
  for (const edge of backEdges) {
    const [src, tgt] = edge.split("->");
    children.get(src)?.delete(tgt);
    parents.get(tgt)?.delete(src);
  }

  // 3) Assign layers via BFS from roots (nodes with no parents)
  const layers = new Map<string, number>();
  const roots = entities.filter((e) => parents.get(e.id)!.size === 0);

  // If no roots (all in cycles after removal), pick by least in-degree
  if (roots.length === 0) {
    const minDegree = Math.min(...entities.map((e) => parents.get(e.id)!.size));
    roots.push(...entities.filter((e) => parents.get(e.id)!.size === minDegree));
  }

  const queue: string[] = [];
  for (const r of roots) {
    layers.set(r.id, 0);
    queue.push(r.id);
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const layer = layers.get(nodeId)!;
    for (const childId of children.get(nodeId)!) {
      const existing = layers.get(childId);
      if (existing === undefined || existing < layer + 1) {
        layers.set(childId, layer + 1);
        queue.push(childId);
      }
    }
  }

  // Handle disconnected nodes (no relations at all)
  for (const e of entities) {
    if (!layers.has(e.id)) {
      layers.set(e.id, 0);
    }
  }

  // 4) Group entities by layer
  const maxLayer = Math.max(...layers.values());
  const layerGroups: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const e of entities) {
    layerGroups[layers.get(e.id)!].push(e.id);
  }

  // 5) Order within layers: sort by median position of connected nodes in prev layer
  for (let l = 1; l <= maxLayer; l++) {
    const group = layerGroups[l];
    const prevGroup = layerGroups[l - 1];
    const prevOrder = new Map(prevGroup.map((id, idx) => [id, idx]));

    group.sort((a, b) => {
      const aParents = [...(parents.get(a) ?? [])].filter((p) => prevOrder.has(p));
      const bParents = [...(parents.get(b) ?? [])].filter((p) => prevOrder.has(p));
      const aMedian = aParents.length > 0 ? median(aParents.map((p) => prevOrder.get(p)!)) : 0;
      const bMedian = bParents.length > 0 ? median(bParents.map((p) => prevOrder.get(p)!)) : 0;
      return aMedian - bMedian;
    });
  }

  // 6) Calculate positions
  const positions = new Map<string, { x: number; y: number }>();

  if (opts.direction === "LR") {
    // Layer = X axis, node order = Y axis
    let layerX = opts.padding;
    for (let l = 0; l <= maxLayer; l++) {
      const group = layerGroups[l];
      let maxWidth = 0;
      let nodeY = opts.padding;
      for (const id of group) {
        const entity = entityMap.get(id)!;
        positions.set(id, { x: layerX, y: nodeY });
        nodeY += entity.height + opts.nodeGap;
        maxWidth = Math.max(maxWidth, entity.width);
      }
      layerX += maxWidth + opts.layerGap;
    }
  } else {
    // TB: Layer = Y axis, node order = X axis
    let layerY = opts.padding;
    for (let l = 0; l <= maxLayer; l++) {
      const group = layerGroups[l];
      let maxHeight = 0;
      let nodeX = opts.padding;
      for (const id of group) {
        const entity = entityMap.get(id)!;
        positions.set(id, { x: nodeX, y: layerY });
        nodeX += entity.width + opts.nodeGap;
        maxHeight = Math.max(maxHeight, entity.height);
      }
      layerY += maxHeight + opts.layerGap;
    }
  }

  // 7) Center layers vertically (LR) or horizontally (TB) for balanced look
  if (opts.direction === "LR") {
    const maxGroupHeight = Math.max(...layerGroups.map((group) => {
      return group.reduce((sum, id) => sum + entityMap.get(id)!.height + opts.nodeGap, 0) - opts.nodeGap;
    }));
    for (let l = 0; l <= maxLayer; l++) {
      const group = layerGroups[l];
      const groupHeight = group.reduce((sum, id) => sum + entityMap.get(id)!.height + opts.nodeGap, 0) - opts.nodeGap;
      const offset = (maxGroupHeight - groupHeight) / 2;
      for (const id of group) {
        const pos = positions.get(id)!;
        positions.set(id, { x: pos.x, y: pos.y + offset });
      }
    }
  } else {
    const maxGroupWidth = Math.max(...layerGroups.map((group) => {
      return group.reduce((sum, id) => sum + entityMap.get(id)!.width + opts.nodeGap, 0) - opts.nodeGap;
    }));
    for (let l = 0; l <= maxLayer; l++) {
      const group = layerGroups[l];
      const groupWidth = group.reduce((sum, id) => sum + entityMap.get(id)!.width + opts.nodeGap, 0) - opts.nodeGap;
      const offset = (maxGroupWidth - groupWidth) / 2;
      for (const id of group) {
        const pos = positions.get(id)!;
        positions.set(id, { x: pos.x + offset, y: pos.y });
      }
    }
  }

  // 8) Apply positions
  return entities.map((e) => {
    const pos = positions.get(e.id);
    return pos ? { ...e, position: pos } : e;
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
