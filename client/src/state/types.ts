import type { ERDSchema, Entity, Column, Relation } from "../core/model/types";
import type { Viewport } from "../canvas/viewport";
import type { Theme } from "../canvas/constants";
import type { AIRequestState } from "../core/ai/types";

export type Selection =
  | { type: "none" }
  | { type: "entity"; entityId: string }
  | { type: "column"; entityId: string; columnId: string }
  | { type: "relation"; relationId: string }
  | { type: "entities"; entityIds: string[] };

export type EditorMode = "select" | "addRelation";
export type SaveState = "idle" | "saving" | "saved" | "error";

export interface AppState {
  schema: ERDSchema;
  viewport: Viewport;
  selection: Selection;
  mode: EditorMode;
  theme: Theme;
  isEditor: boolean;
  isAdmin: boolean;
  canUseAI: boolean;
  authUserEmail: string | null;
  aiAccessStatus: string | null;
  persistence: {
    serverReachable: boolean | null;
    dirty: boolean;
    hasPersistedProject: boolean;
    saveState: SaveState;
  };
  ui: {
    showDDLModal: boolean;
    showProjectList: boolean;
    showInferredRelations: boolean;
    showAIModal: boolean;
    showAISettingsModal: boolean;
  };
  aiInference: AIRequestState;
  addRelationState: {
    cardinality: import("../core/model/types").Cardinality;
    sourceEntityId?: string;
    sourceColumnId?: string;
  } | null;
  history: ERDSchema[];
  future: ERDSchema[];
}

export type Action =
  | { type: "ADD_ENTITY"; entity: Entity }
  | { type: "UPDATE_ENTITY"; entityId: string; changes: Partial<Pick<Entity, "name" | "comment" | "headerColor" | "status">> }
  | { type: "DELETE_ENTITY"; entityId: string }
  | { type: "MOVE_ENTITY"; entityId: string; position: { x: number; y: number }; recordHistory?: boolean }
  | { type: "ADD_COLUMN"; entityId: string; column: Column }
  | { type: "UPDATE_COLUMN"; entityId: string; columnId: string; changes: Partial<Pick<Column, "name" | "type" | "nullable" | "isPrimaryKey" | "isForeignKey" | "isUnique" | "isAutoIncrement" | "defaultValue" | "comment">> }
  | { type: "DELETE_COLUMN"; entityId: string; columnId: string }
  | { type: "ADD_RELATION"; relation: Relation }
  | { type: "UPDATE_RELATION"; relationId: string; changes: Partial<Pick<Relation, "cardinality" | "name">> }
  | { type: "DELETE_RELATION"; relationId: string }
  | { type: "IMPORT_SCHEMA"; schema: ERDSchema }
  | { type: "APPLY_SCHEMA_DIFF"; schema: ERDSchema }
  | { type: "SET_VIEWPORT"; viewport: Viewport }
  | { type: "SET_SELECTION"; selection: Selection }
  | { type: "SET_MODE"; mode: EditorMode }
  | { type: "SET_ADD_RELATION_STATE"; state: AppState["addRelationState"] }
  | { type: "TOGGLE_DDL_MODAL" }
  | { type: "TOGGLE_PROJECT_LIST" }
  | { type: "TOGGLE_INFERRED_RELATIONS" }
  | { type: "SET_SCHEMA_NAME"; name: string }
  | { type: "LOAD_SCHEMA"; schema: ERDSchema }
  | { type: "AUTO_LAYOUT" }
  | { type: "SET_THEME"; theme: Theme }
  | { type: "TOGGLE_AI_MODAL" }
  | { type: "TOGGLE_AI_SETTINGS_MODAL" }
  | { type: "SET_AI_INFERENCE_STATE"; state: AIRequestState }
  | { type: "APPLY_AI_RELATIONS"; relations: Relation[] }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_AUTH"; isEditor: boolean; isAdmin: boolean }
  | { type: "SET_AI_ACCESS"; canUseAI: boolean; authUserEmail: string | null; aiAccessStatus: string | null }
  | { type: "SET_SERVER_REACHABLE"; reachable: boolean }
  | { type: "SET_SAVE_STATE"; saveState: SaveState }
  | { type: "MARK_SAVED" };
