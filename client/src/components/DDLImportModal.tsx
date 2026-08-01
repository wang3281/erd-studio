import { useState, useMemo } from "react";
import { useAppState, useAppDispatch } from "../state/hooks";
import { parseDDL } from "../core/parser/index";
import { layoutGrid } from "../core/layout/index";
import { recalcEntityDimensions } from "../canvas/measure";
import { createViewportToFit } from "../canvas/viewport";
import { ModalFrame } from "./ModalFrame";
import { DiffPreviewModal } from "./DiffPreviewModal";
import { diffSchema, isAllUnchanged, prepareSmartMergeInput } from "../core/merge";
import type { ERDSchema } from "../core/model/types";
import type { SchemaDiff } from "../core/merge";
import { canApplyDDLImport } from "./ddlImportState";

const SAMPLE_DDL = `CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  order_number VARCHAR(100) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
);`;

type ImportMode = "replace" | "smartMerge";

export function DDLImportModal() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [ddl, setDDL] = useState("");
  const [mode, setMode] = useState<ImportMode>("smartMerge");
  const [showExample, setShowExample] = useState(false);
  const [pending, setPending] = useState<{ incoming: ERDSchema; diff: SchemaDiff } | null>(null);
  const [smartMergeNotice, setSmartMergeNotice] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!ddl.trim()) return null;
    return parseDDL(ddl);
  }, [ddl]);

  if (!state.ui.showDDLModal) return null;

  const fitViewportToSchema = (entities: ERDSchema["entities"]) => {
    const canvas = document.querySelector(".canvas-container canvas");
    const rect = canvas?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      dispatch({
        type: "SET_VIEWPORT",
        viewport: createViewportToFit(entities, rect.width, rect.height),
      });
    }
  };

  const handleImport = () => {
    if (!preview || !canApplyDDLImport(state.isEditor, preview)) return;
    setSmartMergeNotice(null);
    const normalized = preview.schema.entities.map(recalcEntityDimensions);

    if (mode === "replace") {
      if (normalized.length === 0 && preview.alters.length > 0) {
        setSmartMergeNotice("ALTER-only imports require Smart Merge.");
        return;
      }
      const laid = layoutGrid(normalized);
      const schema = { ...preview.schema, entities: laid };
      dispatch({ type: "IMPORT_SCHEMA", schema });
      fitViewportToSchema(schema.entities);
      closeAll();
      return;
    }

    // smartMerge: do not pre-layout incoming; applyDiff reuses existing entity positions
    // and lays only the newly-added entities via findEmptyPosition.
    const baseIncoming: ERDSchema = { ...preview.schema, entities: normalized };
    const prepared = prepareSmartMergeInput(state.schema, {
      ...preview,
      schema: baseIncoming,
    });
    const diff = diffSchema(state.schema, prepared.incoming, {
      mode: "partial",
      touchedEntityKeys: prepared.touchedEntityKeys,
    });
    diff.warnings.unshift(...prepared.warnings);
    if (isAllUnchanged(diff)) {
      setSmartMergeNotice("No changes detected — your diagram already matches this DDL.");
      return;
    }
    setPending({ incoming: prepared.incoming, diff });
  };

  const handleApplyMerge = (mergedSchema: ERDSchema) => {
    if (!state.isEditor) return;
    dispatch({ type: "APPLY_SCHEMA_DIFF", schema: mergedSchema });
    fitViewportToSchema(mergedSchema.entities);
    closeAll();
  };

  const closeAll = () => {
    dispatch({ type: "TOGGLE_DDL_MODAL" });
    setDDL("");
    setShowExample(false);
    setPending(null);
    setSmartMergeNotice(null);
  };

  if (pending) {
    return (
      <DiffPreviewModal
        current={state.schema}
        incoming={pending.incoming}
        diff={pending.diff}
        onCancel={closeAll}
        onBack={() => setPending(null)}
        onApply={handleApplyMerge}
      />
    );
  }

  return (
    <ModalFrame
      ariaLabelledBy="ddl-import-title"
      ariaDescribedBy="ddl-import-description"
      onClose={closeAll}
    >
      <h2 id="ddl-import-title">Import DDL</h2>
      <p id="ddl-import-description" className="dialog-message">
        Paste SQL CREATE TABLE statements to generate your ERD. Start with the example if you
        want a working format.
      </p>

      <div className="ddl-intro-actions">
        <button type="button" onClick={() => setShowExample((current) => !current)}>
          {showExample ? "Hide Example" : "Show Example"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDDL(SAMPLE_DDL);
            setShowExample(true);
          }}
        >
          Paste Example
        </button>
      </div>

      {showExample && (
        <pre className="ddl-example" aria-label="DDL example">
          {SAMPLE_DDL}
        </pre>
      )}

      <textarea
        value={ddl}
        onChange={(e) => setDDL(e.target.value)}
        placeholder="Paste SQL DDL here..."
        rows={12}
        aria-label="DDL input"
      />

      {preview && (
        <div className="preview">
          <p>
            Tables: {preview.schema.entities.length}
            {" | "}
            Alters: {preview.alters.length}
            {" | "}
            FK: {preview.foreignKeys.length}
            {" | "}
            Inferred: {preview.schema.relations.filter((relation) => relation.source === "inferred").length}
          </p>
          {preview.errors.length > 0 && (
            <div className="preview-errors">
              {preview.errors.map((err, i) => (
                <p key={i} className="error">Line {err.line}: {err.message}</p>
              ))}
            </div>
          )}
          {preview.warnings.length > 0 && (
            <div className="preview-warnings">
              {preview.warnings.map((w, i) => (
                <p key={i} className="warning">Line {w.line}: {w.message}</p>
              ))}
            </div>
          )}
          {mode === "replace" && preview.foreignKeys.length > preview.schema.relations.filter((relation) => relation.source === "ddl").length && (
            <div className="preview-warnings">
              <p className="warning">
                Replace cannot resolve foreign keys whose target tables are not included in this DDL.
                Use Smart Merge to resolve them against the current diagram.
              </p>
            </div>
          )}
        </div>
      )}

      {smartMergeNotice && (
        <p className="dialog-message" role="status">{smartMergeNotice}</p>
      )}

      <div className="modal-footer">
        <label aria-label="Replace current diagram">
          <input type="radio" value="replace" checked={mode === "replace"} onChange={() => setMode("replace")} />
          Replace current diagram
        </label>
        <label aria-label="Smart merge with current diagram">
          <input type="radio" value="smartMerge" checked={mode === "smartMerge"} onChange={() => setMode("smartMerge")} />
          Smart Merge (preview diff)
        </label>
        <div className="modal-spacer" />
        <button onClick={closeAll}>Cancel</button>
        <button
          className="btn-primary"
          onClick={handleImport}
          disabled={!canApplyDDLImport(state.isEditor, preview)}
        >
          {mode === "replace" ? "Import" : "Continue…"}
        </button>
      </div>
    </ModalFrame>
  );
}
