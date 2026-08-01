import { beforeAll, describe, it, expect, vi } from "vitest";
import { reducer, createInitialState } from "../reducer";
import { withHistory } from "../history";
import { createEntity, createColumn, createRelation } from "../../core/model/factory";

beforeAll(() => {
  const mockCtx = {
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  const mockCanvas = {
    width: 1,
    height: 1,
    getContext: () => mockCtx,
  };

  vi.stubGlobal("document", {
    createElement: () => mockCanvas,
  });
});

describe("reducer", () => {
  it("ADD_ENTITY", () => {
    const state = createInitialState();
    const entity = createEntity({ name: "users" });
    const next = reducer(state, { type: "ADD_ENTITY", entity });
    expect(next.schema.entities).toHaveLength(1);
    expect(next.schema.entities[0].name).toBe("users");
  });

  it("DELETE_ENTITY + 관련 관계도 삭제", () => {
    const state = createInitialState();
    const e1 = createEntity({ name: "a" });
    const e2 = createEntity({ name: "b" });
    const rel = createRelation({
      sourceEntityId: e1.id, sourceColumnId: "c1",
      targetEntityId: e2.id, targetColumnId: "c2",
      cardinality: "1:N",
    });
    const s1 = reducer(state, { type: "ADD_ENTITY", entity: e1 });
    const s2 = reducer(s1, { type: "ADD_ENTITY", entity: e2 });
    const s3 = reducer(s2, { type: "ADD_RELATION", relation: rel });
    const s4 = reducer(s3, { type: "DELETE_ENTITY", entityId: e1.id });
    expect(s4.schema.entities).toHaveLength(1);
    expect(s4.schema.relations).toHaveLength(0);
  });

  it("DELETE_ENTITY clears selections that point to removed entity or cascaded relations", () => {
    const state = createInitialState();
    const col1 = createColumn({ name: "id", type: "INT" });
    const col2 = createColumn({ name: "id", type: "INT" });
    const e1 = createEntity({ name: "a", columns: [col1] });
    const e2 = createEntity({ name: "b", columns: [col2] });
    const rel = createRelation({
      sourceEntityId: e1.id, sourceColumnId: col1.id,
      targetEntityId: e2.id, targetColumnId: col2.id,
      cardinality: "1:N",
    });
    const base = { ...state, schema: { ...state.schema, entities: [e1, e2], relations: [rel] } };

    const columnSelected = reducer(
      { ...base, selection: { type: "column", entityId: e1.id, columnId: col1.id } },
      { type: "DELETE_ENTITY", entityId: e1.id },
    );
    expect(columnSelected.selection.type).toBe("none");

    const relationSelected = reducer(
      { ...base, selection: { type: "relation", relationId: rel.id } },
      { type: "DELETE_ENTITY", entityId: e1.id },
    );
    expect(relationSelected.selection.type).toBe("none");
  });

  it("DELETE_COLUMN clears selections that point to removed column or cascaded relations", () => {
    const state = createInitialState();
    const col1 = createColumn({ name: "id", type: "INT" });
    const col2 = createColumn({ name: "user_id", type: "INT" });
    const e1 = createEntity({ name: "users", columns: [col1] });
    const e2 = createEntity({ name: "orders", columns: [col2] });
    const rel = createRelation({
      sourceEntityId: e2.id, sourceColumnId: col2.id,
      targetEntityId: e1.id, targetColumnId: col1.id,
      cardinality: "N:1",
    });
    const base = { ...state, schema: { ...state.schema, entities: [e1, e2], relations: [rel] } };

    const columnSelected = reducer(
      { ...base, selection: { type: "column", entityId: e2.id, columnId: col2.id } },
      { type: "DELETE_COLUMN", entityId: e2.id, columnId: col2.id },
    );
    expect(columnSelected.selection.type).toBe("none");

    const relationSelected = reducer(
      { ...base, selection: { type: "relation", relationId: rel.id } },
      { type: "DELETE_COLUMN", entityId: e2.id, columnId: col2.id },
    );
    expect(relationSelected.selection.type).toBe("none");
  });

  it("deleting the pending relation source cancels relation creation", () => {
    const column = createColumn({ name: "source_id", type: "INT" });
    const entity = createEntity({ name: "source", columns: [column] });
    const initialState = createInitialState();
    const initial = {
      ...initialState,
      schema: { ...initialState.schema, entities: [entity] },
      mode: "addRelation" as const,
      addRelationState: {
        cardinality: "N:1" as const,
        sourceEntityId: entity.id,
        sourceColumnId: column.id,
      },
    };

    for (const action of [
      { type: "DELETE_COLUMN", entityId: entity.id, columnId: column.id } as const,
      { type: "DELETE_ENTITY", entityId: entity.id } as const,
    ]) {
      const next = reducer(initial, action);
      expect(next.mode).toBe("select");
      expect(next.addRelationState).toBeNull();
    }
  });

  it("MOVE_ENTITY", () => {
    const state = createInitialState();
    const entity = createEntity({ name: "t" });
    const s1 = reducer(state, { type: "ADD_ENTITY", entity });
    const s2 = reducer(s1, { type: "MOVE_ENTITY", entityId: entity.id, position: { x: 200, y: 300 } });
    expect(s2.schema.entities[0].position).toEqual({ x: 200, y: 300 });
  });

  it("한 번의 entity drag는 하나의 undo 단계만 기록한다", () => {
    const historyReducer = withHistory(reducer);
    const entity = createEntity({ name: "dragged", position: { x: 10, y: 20 } });
    const initialState = createInitialState();
    const initial = {
      ...initialState,
      schema: { ...initialState.schema, entities: [entity] },
    };

    const firstFrame = historyReducer(initial, {
      type: "MOVE_ENTITY",
      entityId: entity.id,
      position: { x: 100, y: 120 },
      recordHistory: true,
    });
    const finalFrame = historyReducer(firstFrame, {
      type: "MOVE_ENTITY",
      entityId: entity.id,
      position: { x: 200, y: 220 },
      recordHistory: false,
    });
    const undone = historyReducer(finalFrame, { type: "UNDO" });

    expect(finalFrame.history).toHaveLength(1);
    expect(undone.schema.entities[0].position).toEqual({ x: 10, y: 20 });
  });

  it("ADD_COLUMN → 엔티티 높이 재계산", () => {
    const state = createInitialState();
    const entity = createEntity({ name: "t" });
    const s1 = reducer(state, { type: "ADD_ENTITY", entity });
    const col = createColumn({ name: "id", type: "INT" });
    const s2 = reducer(s1, { type: "ADD_COLUMN", entityId: entity.id, column: col });
    expect(s2.schema.entities[0].columns).toHaveLength(1);
    expect(s2.schema.entities[0].height).toBe(40 + 28); // header + 1 row
  });

  it("UPDATE_RELATION", () => {
    const state = createInitialState();
    const rel = createRelation({
      sourceEntityId: "e1", sourceColumnId: "c1",
      targetEntityId: "e2", targetColumnId: "c2",
      cardinality: "1:N",
    });
    const s1 = reducer(state, { type: "ADD_RELATION", relation: rel });
    const s2 = reducer(s1, { type: "UPDATE_RELATION", relationId: rel.id, changes: { cardinality: "N:M" } });
    expect(s2.schema.relations[0].cardinality).toBe("N:M");
  });

  it("TOGGLE_DDL_MODAL", () => {
    const state = createInitialState();
    const s1 = reducer(state, { type: "TOGGLE_DDL_MODAL" });
    expect(s1.ui.showDDLModal).toBe(true);
    const s2 = reducer(s1, { type: "TOGGLE_DDL_MODAL" });
    expect(s2.ui.showDDLModal).toBe(false);
  });

  it("APPLY_SCHEMA_DIFF replaces entities/relations and clears selection", () => {
    const state = createInitialState();
    const a = createEntity({ name: "a" });
    const s1 = reducer(state, { type: "ADD_ENTITY", entity: a });
    const sSel = reducer(s1, { type: "SET_SELECTION", selection: { type: "entity", entityId: a.id } });
    const newEntity = createEntity({ name: "b" });
    const merged = {
      ...sSel.schema,
      entities: [newEntity],
      relations: [],
    };
    const after = reducer(sSel, { type: "APPLY_SCHEMA_DIFF", schema: merged });
    expect(after.schema.entities).toHaveLength(1);
    expect(after.schema.entities[0].name).toBe("b");
    expect(after.selection.type).toBe("none");
    // viewport / name preserved.
    expect(after.schema.name).toBe(state.schema.name);
  });

  it("LOAD_SCHEMA starts a new history context so undo cannot restore the previous project", () => {
    const historyReducer = withHistory(reducer);
    const initial = createInitialState();
    const oldEntity = createEntity({ name: "old-table" });
    const edited = historyReducer(initial, { type: "ADD_ENTITY", entity: oldEntity });
    const relationMode = historyReducer(edited, { type: "SET_MODE", mode: "addRelation" });
    const relationSourceSelected = historyReducer(relationMode, {
      type: "SET_ADD_RELATION_STATE",
      state: { cardinality: "1:N", sourceEntityId: oldEntity.id, sourceColumnId: "old-column" },
    });
    const loadedSchema = {
      ...initial.schema,
      name: "loaded-project",
      entities: [createEntity({ name: "loaded-table" })],
    };

    const loaded = historyReducer(relationSourceSelected, { type: "LOAD_SCHEMA", schema: loadedSchema });
    const afterUndo = historyReducer(loaded, { type: "UNDO" });

    expect(loaded.history).toEqual([]);
    expect(loaded.future).toEqual([]);
    expect(loaded.mode).toBe("select");
    expect(loaded.addRelationState).toBeNull();
    expect(afterUndo.schema.name).toBe("loaded-project");
    expect(afterUndo.schema.entities[0].name).toBe("loaded-table");
  });

  it("schema replacement and history navigation clear transient relation creation state", () => {
    const historyReducer = withHistory(reducer);
    const initial = createInitialState();
    const entity = createEntity({ name: "source" });
    const edited = historyReducer(initial, { type: "ADD_ENTITY", entity });
    const relationMode = historyReducer(edited, { type: "SET_MODE", mode: "addRelation" });
    const sourceSelected = historyReducer(relationMode, {
      type: "SET_ADD_RELATION_STATE",
      state: { cardinality: "N:1", sourceEntityId: entity.id, sourceColumnId: "source-column" },
    });
    const replacement = { ...initial.schema, name: "replacement", entities: [createEntity({ name: "new-table" })] };

    for (const action of [
      { type: "IMPORT_SCHEMA", schema: replacement } as const,
      { type: "APPLY_SCHEMA_DIFF", schema: replacement } as const,
      { type: "UNDO" } as const,
    ]) {
      const next = historyReducer(sourceSelected, action);
      expect(next.mode).toBe("select");
      expect(next.addRelationState).toBeNull();
    }
  });

  it("SET_AUTH clears stale admin AI access but preserves OAuth AI access grant", () => {
    const state = createInitialState();

    const adminUnlocked = reducer(state, { type: "SET_AUTH", isEditor: true, isAdmin: true });
    expect(adminUnlocked.canUseAI).toBe(true);

    const locked = reducer(adminUnlocked, { type: "SET_AUTH", isEditor: false, isAdmin: false });
    expect(locked.canUseAI).toBe(false);

    const granted = reducer(state, {
      type: "SET_AI_ACCESS",
      canUseAI: true,
      authUserEmail: "sub@example.com",
      aiAccessStatus: "enabled",
    });
    const editorLocked = reducer(granted, { type: "SET_AUTH", isEditor: false, isAdmin: false });
    expect(editorLocked.canUseAI).toBe(true);
  });

  it("tracks local changes and clears dirty state only after a confirmed save", () => {
    const initial = createInitialState();
    expect(initial.persistence).toEqual({
      serverReachable: null,
      dirty: false,
      hasPersistedProject: false,
      saveState: "idle",
    });

    const edited = reducer(initial, {
      type: "ADD_ENTITY",
      entity: createEntity({ name: "users" }),
    });
    expect(edited.persistence.dirty).toBe(true);
    expect(edited.persistence.hasPersistedProject).toBe(false);

    const saving = reducer(edited, { type: "SET_SAVE_STATE", saveState: "saving" });
    expect(saving.persistence.saveState).toBe("saving");

    const saved = reducer(saving, { type: "MARK_SAVED" });
    expect(saved.persistence.dirty).toBe(false);
    expect(saved.persistence.hasPersistedProject).toBe(true);
    expect(saved.persistence.saveState).toBe("saved");
  });

  it("treats a loaded server schema as persisted and clean", () => {
    const dirty = reducer(createInitialState(), {
      type: "ADD_ENTITY",
      entity: createEntity({ name: "local" }),
    });
    const loadedSchema = {
      ...dirty.schema,
      name: "server-project",
      entities: [createEntity({ name: "remote" })],
    };

    const loaded = reducer(dirty, { type: "LOAD_SCHEMA", schema: loadedSchema });

    expect(loaded.persistence.dirty).toBe(false);
    expect(loaded.persistence.hasPersistedProject).toBe(true);
    expect(loaded.persistence.saveState).toBe("saved");
  });

  it("SET_VIEWPORT updates the viewport persisted inside the schema", () => {
    const state = createInitialState();
    const next = reducer(state, { type: "SET_VIEWPORT", viewport: { offsetX: 125, offsetY: -40, zoom: 1.5 } });

    expect(next.viewport).toEqual({ offsetX: 125, offsetY: -40, zoom: 1.5 });
    expect(next.schema.viewport).toEqual({ x: 125, y: -40, zoom: 1.5 });
    expect(next.persistence.dirty).toBe(false);
    expect(next.persistence.saveState).toBe("idle");
  });

  it("invalid schema actions do not add history or clear redo", () => {
    const historyReducer = withHistory(reducer);
    const initial = createInitialState();
    const futureSchema = { ...initial.schema, name: "redo-target" };
    const state = { ...initial, future: [futureSchema] };

    const next = historyReducer(state, { type: "DELETE_RELATION", relationId: "missing" });

    expect(next.history).toEqual([]);
    expect(next.future).toEqual([futureSchema]);
  });

  it("undo preserves the current non-history viewport in state and schema", () => {
    const historyReducer = withHistory(reducer);
    const initial = reducer(createInitialState(), {
      type: "SET_VIEWPORT",
      viewport: { offsetX: 10, offsetY: 20, zoom: 1.2 },
    });
    const edited = historyReducer(initial, { type: "ADD_ENTITY", entity: createEntity({ name: "users" }) });
    const panned = reducer(edited, {
      type: "SET_VIEWPORT",
      viewport: { offsetX: 300, offsetY: -50, zoom: 0.8 },
    });

    const undone = historyReducer(panned, { type: "UNDO" });

    expect(undone.viewport).toEqual({ offsetX: 300, offsetY: -50, zoom: 0.8 });
    expect(undone.schema.viewport).toEqual({ x: 300, y: -50, zoom: 0.8 });
  });

  it("rebases undo and redo snapshots to the Save As schema name", () => {
    const historyReducer = withHistory(reducer);
    const edited = historyReducer(createInitialState(), { type: "ADD_ENTITY", entity: createEntity({ name: "users" }) });
    const savedAs = historyReducer(edited, { type: "SET_SCHEMA_NAME", name: "Copy" });

    const undone = historyReducer(savedAs, { type: "UNDO" });
    const redone = historyReducer(undone, { type: "REDO" });

    expect(undone.schema.name).toBe("Copy");
    expect(redone.schema.name).toBe("Copy");
  });

  it("clears a selection that may become dangling across undo", () => {
    const historyReducer = withHistory(reducer);
    const entity = createEntity({ name: "users" });
    const added = historyReducer(createInitialState(), { type: "ADD_ENTITY", entity });
    const selected = historyReducer(added, {
      type: "SET_SELECTION",
      selection: { type: "entity", entityId: entity.id },
    });

    expect(historyReducer(selected, { type: "UNDO" }).selection).toEqual({ type: "none" });
  });
});
