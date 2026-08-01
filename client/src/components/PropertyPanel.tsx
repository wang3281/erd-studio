import { useAppState } from "../state/hooks";
import { EntityEditor } from "./EntityEditor";
import { RelationEditor } from "./RelationEditor";

export function PropertyPanel() {
  const state = useAppState();
  const { selection } = state;

  return (
    <div className="property-panel" aria-label="Property panel">
      {selection.type === "none" && (
        <div className="panel-empty">
          <span className="panel-empty-icon" aria-hidden="true">◎</span>
          <strong>Choose an entity or relation.</strong>
          <p>Details, names, and cardinality settings appear here after you select something.</p>
        </div>
      )}
      {(selection.type === "entity" || selection.type === "column") && (
        <EntityEditor entityId={selection.entityId} />
      )}
      {selection.type === "relation" && (
        <RelationEditor relationId={selection.relationId} />
      )}
    </div>
  );
}
