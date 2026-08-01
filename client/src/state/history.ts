import type { AppState, Action } from "./types";

const MAX_HISTORY = 50;

function sameItems<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function schemaChanged(previous: AppState["schema"], next: AppState["schema"]): boolean {
  return previous.name !== next.name ||
    previous.version !== next.version ||
    previous.viewport?.x !== next.viewport?.x ||
    previous.viewport?.y !== next.viewport?.y ||
    previous.viewport?.zoom !== next.viewport?.zoom ||
    !sameItems(previous.entities, next.entities) ||
    !sameItems(previous.relations, next.relations);
}

const SCHEMA_ACTIONS = new Set([
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
  "AUTO_LAYOUT",
  "APPLY_AI_RELATIONS",
]);

export function withHistory(
  baseReducer: (state: AppState, action: Action) => AppState,
): (state: AppState, action: Action) => AppState {
  return (state: AppState, action: Action): AppState => {
    if (action.type === "UNDO") {
      if (state.history.length === 0) return state;
      const previous = state.history[state.history.length - 1];
      return {
        ...state,
        schema: { ...previous, viewport: state.schema.viewport },
        history: state.history.slice(0, -1),
        future: [state.schema, ...state.future],
        mode: "select",
        addRelationState: null,
        selection: { type: "none" },
      };
    }

    if (action.type === "REDO") {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        schema: { ...next, viewport: state.schema.viewport },
        history: [...state.history, state.schema],
        future: state.future.slice(1),
        mode: "select",
        addRelationState: null,
        selection: { type: "none" },
      };
    }

    const newState = baseReducer(state, action);

    if (action.type === "SET_SCHEMA_NAME") {
      const rebaseName = (schema: AppState["schema"]) => ({ ...schema, name: action.name });
      return {
        ...newState,
        history: state.history.map(rebaseName),
        future: state.future.map(rebaseName),
      };
    }

    if (SCHEMA_ACTIONS.has(action.type) && !schemaChanged(state.schema, newState.schema)) {
      return newState;
    }

    if (action.type === "MOVE_ENTITY" && action.recordHistory === false) {
      return { ...newState, future: [] };
    }

    if (action.type === "LOAD_SCHEMA") {
      return {
        ...newState,
        history: [],
        future: [],
      };
    }

    if (SCHEMA_ACTIONS.has(action.type)) {
      const newHistory = [...state.history, state.schema];
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }
      return {
        ...newState,
        history: newHistory,
        future: [],
      };
    }

    return newState;
  };
}
