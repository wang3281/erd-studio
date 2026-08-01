import type { AppState, Action } from "./types";
import type { ERDSchema } from "../core/model/types";
import { createSchema } from "../core/model/factory";
import { recalcEntityDimensions } from "../canvas/measure";
import { autoLayout } from "../core/layout/index";

/** Recalc width+height for all entities in a schema. */
function recalcAllEntities(schema: ERDSchema): ERDSchema {
  return {
    ...schema,
    entities: schema.entities.map(recalcEntityDimensions),
  };
}

function detectSystemTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function aiAccessGrantAllowsAI(status: string | null): boolean {
  return status === "enabled";
}

export function createInitialState(): AppState {
  return {
    schema: createSchema({ name: "Untitled" }),
    viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    selection: { type: "none" },
    mode: "select",
    theme: detectSystemTheme(),
    isEditor: false,
    isAdmin: false,
    canUseAI: false,
    authUserEmail: null,
    aiAccessStatus: null,
    persistence: {
      serverReachable: null,
      dirty: false,
      hasPersistedProject: false,
      saveState: "idle",
    },
    ui: { showDDLModal: false, showProjectList: false, showInferredRelations: false, showAIModal: false, showAISettingsModal: false },
    aiInference: { status: "idle" },
    addRelationState: null,
    history: [],
    future: [],
  };
}

function reduceCore(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_ENTITY":
      return {
        ...state,
        schema: {
          ...state.schema,
          entities: [...state.schema.entities, recalcEntityDimensions(action.entity)],
        },
      };

    case "UPDATE_ENTITY":
      return {
        ...state,
        schema: {
          ...state.schema,
          entities: state.schema.entities.map((e) =>
            e.id === action.entityId ? recalcEntityDimensions({ ...e, ...action.changes }) : e
          ),
        },
      };

    case "DELETE_ENTITY": {
      const removedRelationIds = new Set(
        state.schema.relations
          .filter((r) => r.sourceEntityId === action.entityId || r.targetEntityId === action.entityId)
          .map((r) => r.id),
      );
      const selection =
        (state.selection.type === "entity" && state.selection.entityId === action.entityId) ||
        (state.selection.type === "column" && state.selection.entityId === action.entityId) ||
        (state.selection.type === "relation" && removedRelationIds.has(state.selection.relationId))
          ? { type: "none" as const }
          : state.selection;
      const cancelsPendingRelation = state.addRelationState?.sourceEntityId === action.entityId;
      return {
        ...state,
        schema: {
          ...state.schema,
          entities: state.schema.entities.filter((e) => e.id !== action.entityId),
          relations: state.schema.relations.filter(
            (r) => r.sourceEntityId !== action.entityId && r.targetEntityId !== action.entityId
          ),
        },
        selection,
        mode: cancelsPendingRelation ? "select" : state.mode,
        addRelationState: cancelsPendingRelation ? null : state.addRelationState,
      };
    }

    case "MOVE_ENTITY":
      return {
        ...state,
        schema: {
          ...state.schema,
          entities: state.schema.entities.map((e) =>
            e.id === action.entityId ? { ...e, position: action.position } : e
          ),
        },
      };

    case "ADD_COLUMN":
      return {
        ...state,
        schema: {
          ...state.schema,
          entities: state.schema.entities.map((e) => {
            if (e.id !== action.entityId) return e;
            const updated = { ...e, columns: [...e.columns, action.column] };
            return recalcEntityDimensions(updated);
          }),
        },
      };

    case "UPDATE_COLUMN":
      return {
        ...state,
        schema: {
          ...state.schema,
          entities: state.schema.entities.map((e) => {
            if (e.id !== action.entityId) return e;
            const updated = {
              ...e,
              columns: e.columns.map((c) =>
                c.id === action.columnId ? { ...c, ...action.changes } : c
              ),
            };
            return recalcEntityDimensions(updated);
          }),
        },
      };

    case "DELETE_COLUMN": {
      const removedRelationIds = new Set(
        state.schema.relations
          .filter((r) =>
            (r.sourceEntityId === action.entityId && r.sourceColumnId === action.columnId) ||
            (r.targetEntityId === action.entityId && r.targetColumnId === action.columnId)
          )
          .map((r) => r.id),
      );
      const selection =
        (state.selection.type === "column" && state.selection.entityId === action.entityId && state.selection.columnId === action.columnId) ||
        (state.selection.type === "relation" && removedRelationIds.has(state.selection.relationId))
          ? { type: "none" as const }
          : state.selection;
      const cancelsPendingRelation =
        state.addRelationState?.sourceEntityId === action.entityId &&
        state.addRelationState.sourceColumnId === action.columnId;
      return {
        ...state,
        schema: {
          ...state.schema,
          entities: state.schema.entities.map((e) => {
            if (e.id !== action.entityId) return e;
            const updated = { ...e, columns: e.columns.filter((c) => c.id !== action.columnId) };
            return recalcEntityDimensions(updated);
          }),
          relations: state.schema.relations.filter(
            (r) =>
              !(r.sourceEntityId === action.entityId && r.sourceColumnId === action.columnId) &&
              !(r.targetEntityId === action.entityId && r.targetColumnId === action.columnId)
          ),
        },
        selection,
        mode: cancelsPendingRelation ? "select" : state.mode,
        addRelationState: cancelsPendingRelation ? null : state.addRelationState,
      };
    }

    case "ADD_RELATION":
      return {
        ...state,
        schema: {
          ...state.schema,
          relations: [...state.schema.relations, action.relation],
        },
      };

    case "UPDATE_RELATION":
      return {
        ...state,
        schema: {
          ...state.schema,
          relations: state.schema.relations.map((r) =>
            r.id === action.relationId ? { ...r, ...action.changes } : r
          ),
        },
      };

    case "DELETE_RELATION":
      return {
        ...state,
        schema: {
          ...state.schema,
          relations: state.schema.relations.filter((r) => r.id !== action.relationId),
        },
        selection: state.selection.type === "relation" && state.selection.relationId === action.relationId
          ? { type: "none" }
          : state.selection,
      };

    case "IMPORT_SCHEMA":
      return {
        ...state,
        schema: recalcAllEntities(action.schema),
        selection: { type: "none" },
        mode: "select",
        addRelationState: null,
      };

    case "APPLY_SCHEMA_DIFF":
      // Smart Merge: merged schema is computed by the UI via core/merge.
      // Reducer just swaps entities/relations while keeping name + viewport.
      return {
        ...state,
        schema: recalcAllEntities({
          ...state.schema,
          entities: action.schema.entities,
          relations: action.schema.relations,
        }),
        selection: { type: "none" },
        mode: "select",
        addRelationState: null,
      };

    case "SET_VIEWPORT":
      return {
        ...state,
        viewport: action.viewport,
        schema: {
          ...state.schema,
          viewport: { x: action.viewport.offsetX, y: action.viewport.offsetY, zoom: action.viewport.zoom },
        },
      };

    case "SET_SELECTION":
      return { ...state, selection: action.selection };

    case "SET_MODE":
      return { ...state, mode: action.mode, addRelationState: null };

    case "SET_ADD_RELATION_STATE":
      return { ...state, addRelationState: action.state };

    case "TOGGLE_DDL_MODAL":
      return { ...state, ui: { ...state.ui, showDDLModal: !state.ui.showDDLModal } };

    case "TOGGLE_PROJECT_LIST":
      return { ...state, ui: { ...state.ui, showProjectList: !state.ui.showProjectList } };

    case "TOGGLE_INFERRED_RELATIONS":
      return { ...state, ui: { ...state.ui, showInferredRelations: !state.ui.showInferredRelations } };

    case "TOGGLE_AI_MODAL":
      return { ...state, ui: { ...state.ui, showAIModal: !state.ui.showAIModal } };

    case "TOGGLE_AI_SETTINGS_MODAL":
      return { ...state, ui: { ...state.ui, showAISettingsModal: !state.ui.showAISettingsModal } };

    case "SET_AI_INFERENCE_STATE":
      return { ...state, aiInference: action.state };

    case "APPLY_AI_RELATIONS":
      return {
        ...state,
        schema: {
          ...state.schema,
          relations: [...state.schema.relations, ...action.relations],
        },
      };

    case "SET_SCHEMA_NAME":
      return { ...state, schema: { ...state.schema, name: action.name } };

    case "LOAD_SCHEMA":
      return {
        ...state,
        schema: recalcAllEntities(action.schema),
        viewport: action.schema.viewport
          ? { offsetX: action.schema.viewport.x, offsetY: action.schema.viewport.y, zoom: action.schema.viewport.zoom }
          : state.viewport,
        selection: { type: "none" },
        mode: "select",
        addRelationState: null,
        persistence: {
          ...state.persistence,
          dirty: false,
          hasPersistedProject: true,
          saveState: "saved",
        },
      };

    case "AUTO_LAYOUT":
      return {
        ...state,
        schema: {
          ...state.schema,
          entities: autoLayout(state.schema.entities, state.schema.relations),
        },
        selection: { type: "none" },
      };

    case "SET_THEME":
      return { ...state, theme: action.theme };

    case "SET_AUTH":
      return {
        ...state,
        isEditor: action.isEditor,
        isAdmin: action.isAdmin,
        canUseAI: action.isAdmin || aiAccessGrantAllowsAI(state.aiAccessStatus),
      };

    case "SET_AI_ACCESS":
      return {
        ...state,
        canUseAI: action.canUseAI || state.isAdmin,
        authUserEmail: action.authUserEmail,
        aiAccessStatus: action.aiAccessStatus,
      };

    case "SET_SERVER_REACHABLE":
      return {
        ...state,
        persistence: {
          ...state.persistence,
          serverReachable: action.reachable,
        },
      };

    case "SET_SAVE_STATE":
      return {
        ...state,
        persistence: {
          ...state.persistence,
          saveState: action.saveState,
        },
      };

    case "MARK_SAVED":
      return {
        ...state,
        persistence: {
          ...state.persistence,
          dirty: false,
          hasPersistedProject: true,
          saveState: "saved",
        },
      };

    default:
      return state;
  }
}

const SCHEMA_MUTATION_ACTIONS = new Set<Action["type"]>([
  "ADD_ENTITY",
  "UPDATE_ENTITY",
  "DELETE_ENTITY",
  "MOVE_ENTITY",
  "ADD_COLUMN",
  "UPDATE_COLUMN",
  "DELETE_COLUMN",
  "ADD_RELATION",
  "UPDATE_RELATION",
  "DELETE_RELATION",
  "IMPORT_SCHEMA",
  "APPLY_SCHEMA_DIFF",
  "SET_SCHEMA_NAME",
  "AUTO_LAYOUT",
  "APPLY_AI_RELATIONS",
  "UNDO",
  "REDO",
]);

export function reducer(state: AppState, action: Action): AppState {
  const next = reduceCore(state, action);
  if (next === state || !SCHEMA_MUTATION_ACTIONS.has(action.type)) return next;
  return {
    ...next,
    persistence: {
      ...next.persistence,
      dirty: true,
      saveState: "idle",
    },
  };
}
