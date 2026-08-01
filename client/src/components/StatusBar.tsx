import { useAppState } from "../state/hooks";

export function StatusBar() {
  const state = useAppState();
  const persistenceLabel = state.persistence.serverReachable === null
    ? "Checking server…"
    : state.persistence.serverReachable === false
      ? "Local draft — Export JSON to keep"
      : state.persistence.saveState === "saving"
        ? "Saving…"
        : state.persistence.saveState === "error"
          ? "Save failed"
          : state.persistence.dirty
            ? state.persistence.hasPersistedProject ? "Unsaved changes" : "New draft — Save As required"
            : state.persistence.hasPersistedProject ? "Saved" : "New draft — Save As required";

  return (
    <div className="statusbar" role="status" aria-live="polite">
      <span>Entities: {state.schema.entities.length}</span>
      <span>Relations: {state.schema.relations.length}</span>
      <span>Zoom: {Math.round(state.viewport.zoom * 100)}%</span>
      <span
        className={`statusbar-persistence statusbar-persistence-${state.persistence.serverReachable === false ? "local" : state.persistence.saveState}`}
      >
        {persistenceLabel}
      </span>
      {state.mode === "addRelation" && (
        <span className="statusbar-mode">Mode: Add Relation (click source column, then target column)</span>
      )}
    </div>
  );
}
