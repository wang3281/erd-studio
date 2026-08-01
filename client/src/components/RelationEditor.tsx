import { useState } from "react";
import { useAppState, useAppDispatch } from "../state/hooks";
import type { Cardinality } from "../core/model/types";
import { ConfirmDialog } from "./ConfirmDialog";

export function RelationEditor({ relationId }: { relationId: string }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rel = state.schema.relations.find((r) => r.id === relationId);
  if (!rel) return null;

  const srcEntity = state.schema.entities.find((e) => e.id === rel.sourceEntityId);
  const tgtEntity = state.schema.entities.find((e) => e.id === rel.targetEntityId);
  const srcCol = srcEntity?.columns.find((c) => c.id === rel.sourceColumnId);
  const tgtCol = tgtEntity?.columns.find((c) => c.id === rel.targetColumnId);

  const canEdit = state.isEditor;

  return (
    <>
      <div className="editor">
        <h3>Relation</h3>
        <fieldset
          disabled={!canEdit}
          style={{ display: "contents", border: "none", padding: 0, margin: 0 }}
        >
        <div className="relation-info">
          <span>{srcEntity?.name}.{srcCol?.name}</span>
          <span> → </span>
          <span>{tgtEntity?.name}.{tgtCol?.name}</span>
        </div>
        <div className="relation-source">
          {rel.source === "ddl"
            ? "DDL FK"
            : rel.source === "inferred"
              ? "Inferred"
              : rel.source === "ai"
                ? "AI"
                : "Manual"}
        </div>
        <label>
          Cardinality
          <select
            value={rel.cardinality}
            onChange={(e) => dispatch({ type: "UPDATE_RELATION", relationId, changes: { cardinality: e.target.value as Cardinality } })}
          >
            <option value="1:1">1:1</option>
            <option value="1:N">1:N</option>
            <option value="N:1">N:1</option>
            <option value="N:M">N:M</option>
          </select>
        </label>
        <div className="editor-actions">
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete Relation
          </button>
        </div>
        </fieldset>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete relation?"
        message="Remove this relationship from the diagram? This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
        variant="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!canEdit) {
            setConfirmDelete(false);
            return;
          }
          dispatch({ type: "DELETE_RELATION", relationId });
          setConfirmDelete(false);
        }}
      />
    </>
  );
}
