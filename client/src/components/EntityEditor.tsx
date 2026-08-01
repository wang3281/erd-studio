import { useState } from "react";
import { useAppState, useAppDispatch } from "../state/hooks";
import { createColumn } from "../core/model/factory";
import { ConfirmDialog } from "./ConfirmDialog";
import { COLORS } from "../canvas/constants";

export function EntityEditor({ entityId }: { entityId: string }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [columnSearch, setColumnSearch] = useState({ entityId, value: "" });
  const entity = state.schema.entities.find((e) => e.id === entityId);

  if (!entity) return null;
  const canEdit = state.isEditor;
  const columnQuery = columnSearch.entityId === entityId ? columnSearch.value : "";
  const normalizedQuery = columnQuery.trim().toLocaleLowerCase();
  const filteredColumns = normalizedQuery
    ? entity.columns.filter((column) =>
        [column.name, column.type, column.comment ?? ""]
          .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
      )
    : entity.columns;

  return (
    <>
      <div className="editor">
        <h3>Entity</h3>
        <div className="column-search">
          <label>
            Search columns
            <input
              type="search"
              value={columnQuery}
              placeholder="Name, type, or comment…"
              onChange={(event) => setColumnSearch({ entityId, value: event.target.value })}
            />
          </label>
          <span aria-live="polite">{filteredColumns.length} of {entity.columns.length}</span>
        </div>
        <fieldset
          disabled={!canEdit}
          style={{ display: "contents", border: "none", padding: 0, margin: 0 }}
        >
        <label>
          Name
          <input
            value={entity.name}
            onChange={(e) => dispatch({ type: "UPDATE_ENTITY", entityId, changes: { name: e.target.value } })}
          />
        </label>
        <label>
          Comment (논리명)
          <input
            value={entity.comment ?? ""}
            placeholder="논리명"
            onChange={(e) => dispatch({ type: "UPDATE_ENTITY", entityId, changes: { comment: e.target.value || undefined } })}
          />
        </label>
        <label>
          Header Color
          <input
            type="color"
            value={entity.headerColor ?? COLORS.entityHeader}
            onChange={(e) => dispatch({ type: "UPDATE_ENTITY", entityId, changes: { headerColor: e.target.value } })}
          />
        </label>
        <button type="button" onClick={() => dispatch({ type: "UPDATE_ENTITY", entityId, changes: { headerColor: undefined } })}>
          기본값으로 초기화
        </button>
        <label>
          Status
          <select
            value={entity.status ?? ""}
            onChange={(e) =>
              dispatch({
                type: "UPDATE_ENTITY",
                entityId,
                changes: { status: e.target.value ? (e.target.value as NonNullable<typeof entity.status>) : undefined },
              })}
          >
            <option value="">없음</option>
            {Object.entries(COLORS.entityStatus).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <h4>Columns</h4>
        {filteredColumns.map((col) => (
          <div key={col.id} className="column-editor-block">
            <div className="column-row">
              <input
                value={col.name}
                placeholder="name"
                aria-label={`${col.name || "column"} name`}
                onChange={(e) => dispatch({ type: "UPDATE_COLUMN", entityId, columnId: col.id, changes: { name: e.target.value } })}
              />
              <input
                value={col.type}
                placeholder="type"
                aria-label={`${col.name || "column"} type`}
                onChange={(e) => dispatch({ type: "UPDATE_COLUMN", entityId, columnId: col.id, changes: { type: e.target.value } })}
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={col.isPrimaryKey}
                  onChange={(e) => dispatch({ type: "UPDATE_COLUMN", entityId, columnId: col.id, changes: { isPrimaryKey: e.target.checked } })}
                />
                PK
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!col.nullable}
                  onChange={(e) => dispatch({ type: "UPDATE_COLUMN", entityId, columnId: col.id, changes: { nullable: !e.target.checked } })}
                />
                NN
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!col.isUnique}
                  onChange={(e) => dispatch({ type: "UPDATE_COLUMN", entityId, columnId: col.id, changes: { isUnique: e.target.checked } })}
                />
                UQ
              </label>
              <label className="checkbox-label" title="Auto increment">
                <input
                  type="checkbox"
                  checked={!!col.isAutoIncrement}
                  onChange={(e) => dispatch({ type: "UPDATE_COLUMN", entityId, columnId: col.id, changes: { isAutoIncrement: e.target.checked } })}
                />
                AI
              </label>
              <button className="btn-danger" onClick={() => dispatch({ type: "DELETE_COLUMN", entityId, columnId: col.id })} aria-label={`Delete column ${col.name || "untitled"}`}>
                x
              </button>
            </div>
            <div className="column-comment-row">
              <input
                value={col.comment ?? ""}
                placeholder="논리명 (comment)"
                aria-label={`${col.name || "column"} comment`}
                onChange={(e) => dispatch({ type: "UPDATE_COLUMN", entityId, columnId: col.id, changes: { comment: e.target.value || undefined } })}
              />
            </div>
          </div>
        ))}
        {filteredColumns.length === 0 && (
          <p className="column-search-empty">No matching columns.</p>
        )}
        <button onClick={() => {
          const col = createColumn({ name: "", type: "VARCHAR(255)" });
          dispatch({ type: "ADD_COLUMN", entityId, column: col });
        }}>
          + Column
        </button>

        <div className="editor-actions">
          <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete Entity
          </button>
        </div>
        </fieldset>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete entity?"
        message={`Remove "${entity.name}" and every connected relation? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Keep"
        variant="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!canEdit) {
            setConfirmDelete(false);
            return;
          }
          dispatch({ type: "DELETE_ENTITY", entityId });
          setConfirmDelete(false);
        }}
      />
    </>
  );
}
