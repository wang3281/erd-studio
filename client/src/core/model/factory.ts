import type { Column, Entity, Relation, ERDSchema, Cardinality, EntityStatus } from "./types";
import { getHeaderHeight } from "../../canvas/constants";

let counter = 0;
function generateId(): string {
  return `${Date.now()}-${++counter}`;
}

const DEFAULT_WIDTH = 220;
const ROW_HEIGHT = 28;

/** @deprecated Use calcEntityHeight from canvas/measure.ts. Kept for test compat. */
export function calcEntityHeight(columnCount: number): number {
  return getHeaderHeight(false) + ROW_HEIGHT * columnCount;
}

export function createColumn(params: {
  name: string;
  type: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  isUnique?: boolean;
  isAutoIncrement?: boolean;
  defaultValue?: string;
  comment?: string;
}): Column {
  return {
    id: generateId(),
    name: params.name,
    type: params.type,
    nullable: params.nullable ?? true,
    isPrimaryKey: params.isPrimaryKey ?? false,
    isForeignKey: params.isForeignKey ?? false,
    isUnique: params.isUnique ?? false,
    isAutoIncrement: params.isAutoIncrement ?? false,
    defaultValue: params.defaultValue,
    comment: params.comment,
  };
}

export function createEntity(params: {
  name: string;
  comment?: string;
  headerColor?: string;
  status?: EntityStatus;
  columns?: Column[];
  position?: { x: number; y: number };
}): Entity {
  const columns = params.columns ?? [];
  return {
    id: generateId(),
    name: params.name,
    comment: params.comment,
    headerColor: params.headerColor,
    status: params.status,
    columns,
    position: params.position ?? { x: 0, y: 0 },
    width: DEFAULT_WIDTH,
    height: getHeaderHeight(!!params.comment) + ROW_HEIGHT * columns.length,
  };
}

export function createRelation(params: {
  sourceEntityId: string;
  sourceColumnId: string;
  targetEntityId: string;
  targetColumnId: string;
  cardinality: Cardinality;
  source?: "ddl" | "manual" | "inferred" | "ai";
  name?: string;
}): Relation {
  return {
    id: generateId(),
    name: params.name,
    sourceEntityId: params.sourceEntityId,
    sourceColumnId: params.sourceColumnId,
    targetEntityId: params.targetEntityId,
    targetColumnId: params.targetColumnId,
    cardinality: params.cardinality,
    source: params.source ?? "manual",
  };
}

export function createSchema(params: { name: string }): ERDSchema {
  return {
    version: 1,
    name: params.name,
    entities: [],
    relations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
