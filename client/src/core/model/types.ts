export type ColumnType = string;

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique?: boolean;
  isAutoIncrement?: boolean;
  defaultValue?: string;
  comment?: string;
}

export interface Entity {
  id: string;
  name: string;
  comment?: string;
  headerColor?: string;
  status?: EntityStatus;
  columns: Column[];
  position: { x: number; y: number };
  width: number;
  height: number;
}

export type EntityStatus = "new" | "existing" | "modified" | "deprecated";

export type Cardinality = "1:1" | "1:N" | "N:1" | "N:M";

export interface Relation {
  id: string;
  name?: string;
  sourceEntityId: string;
  sourceColumnId: string;
  targetEntityId: string;
  targetColumnId: string;
  cardinality: Cardinality;
  source: "ddl" | "manual" | "inferred" | "ai";
}

export interface ERDSchema {
  version: number;
  name: string;
  entities: Entity[];
  relations: Relation[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
}

export interface ParseError {
  line: number;
  message: string;
  snippet: string;
}

export interface ParseWarning {
  line: number;
  message: string;
  snippet: string;
}

export type AlterDirective =
  | { kind: "addColumn"; tableName: string; column: Column }
  | { kind: "dropColumn"; tableName: string; columnName: string }
  | { kind: "modifyColumn"; tableName: string; column: Column }
  | { kind: "renameColumn"; tableName: string; from: string; column: Column };

export interface ParsedForeignKey {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  cardinality: "N:1";
  name?: string;
  line: number;
}

export interface ParseResult {
  schema: ERDSchema;
  alters: AlterDirective[];
  foreignKeys: ParsedForeignKey[];
  errors: ParseError[];
  warnings: ParseWarning[];
}
