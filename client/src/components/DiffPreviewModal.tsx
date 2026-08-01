import { useMemo, useState } from "react";
import type { ERDSchema } from "../core/model/types";
import type { ColumnDiff, EntityDiff, SchemaDiff } from "../core/merge";
import { applyDiff } from "../core/merge";
import { ModalFrame } from "./ModalFrame";
import { toggleHardDeleteId } from "./diffPreviewState";

interface DiffPreviewModalProps {
  current: ERDSchema;
  incoming: ERDSchema;
  diff: SchemaDiff;
  onCancel: () => void;
  onBack: () => void;
  onApply: (mergedSchema: ERDSchema) => void;
}

export function DiffPreviewModal({
  current,
  incoming,
  diff,
  onCancel,
  onBack,
  onApply,
}: DiffPreviewModalProps) {
  // Per-entity opt-in for hard delete (instead of deprecated marking).
  const [hardDeleteIds, setHardDeleteIds] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const added = useMemo(() => diff.entities.filter((e) => e.kind === "added"), [diff]);
  const modified = useMemo(() => diff.entities.filter((e) => e.kind === "modified"), [diff]);
  const removed = useMemo(() => diff.entities.filter((e) => e.kind === "removed"), [diff]);
  const relAdded = useMemo(() => diff.relations.filter((r) => r.kind === "added"), [diff]);
  const relRemoved = useMemo(() => diff.relations.filter((r) => r.kind === "removed"), [diff]);
  const isPartialImport = diff.mode === "partial";
  const unmapped = useMemo(
    () => diff.relations.filter((r) => r.kind === "added" && r.unmapped),
    [diff],
  );

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleHardDelete = (id: string) => {
    setHardDeleteIds((prev) => toggleHardDeleteId(prev, id));
  };

  const handleApply = () => {
    const result = applyDiff(current, incoming, diff, {
      markRemovedAsDeprecated: true,
      removeEntityIds: isPartialImport ? [] : Array.from(hardDeleteIds),
    });
    onApply(result.schema);
  };

  return (
    <ModalFrame
      ariaLabelledBy="diff-preview-title"
      ariaDescribedBy="diff-preview-summary"
      onClose={onCancel}
    >
      <h2 id="diff-preview-title">Smart Merge — Diff Preview</h2>
      <p id="diff-preview-summary" className="dialog-message">
        Review what will change before applying. Existing layout, colors, comments and manual
        relations will be preserved.
      </p>

      <ul className="diff-stats">
        <li>
          <strong>{diff.stats.entitiesAdded}</strong> added
        </li>
        <li>
          <strong>{diff.stats.entitiesModified}</strong> modified
        </li>
        <li>
          <strong>{diff.stats.entitiesRemoved}</strong> removed
        </li>
        <li>
          +{diff.stats.relationsAdded} / −{diff.stats.relationsRemoved} FK
        </li>
        {diff.stats.relationsUnmapped > 0 && (
          <li className="diff-stat-warn">{diff.stats.relationsUnmapped} unmapped</li>
        )}
      </ul>

      <div className="diff-sections">
        {added.length > 0 && (
          <DiffSection title={`Added (${added.length})`} variant="added">
            {added.map((e) => (
              <EntityRow key={e.key} entity={e} expanded={expandedKeys.has(e.key)} onToggle={() => toggleExpand(e.key)} />
            ))}
          </DiffSection>
        )}

        {modified.length > 0 && (
          <DiffSection title={`Modified (${modified.length})`} variant="modified">
            {modified.map((e) => (
              <EntityRow key={e.key} entity={e} expanded={expandedKeys.has(e.key)} onToggle={() => toggleExpand(e.key)} />
            ))}
          </DiffSection>
        )}

        {removed.length > 0 && (
          <DiffSection
            title={isPartialImport
              ? `Removed (${removed.length}) - protected during partial import`
              : `Removed (${removed.length}) - kept on canvas as deprecated`}
            variant="removed"
          >
            {removed.map((e) => (
              <RemovedEntityRow
                key={e.key}
                entity={e}
                expanded={expandedKeys.has(e.key)}
                onToggleExpand={() => toggleExpand(e.key)}
                hardDelete={hardDeleteIds.has(e.currentEntity.id)}
                onToggleHardDelete={() => toggleHardDelete(e.currentEntity.id)}
                allowHardDelete={!isPartialImport}
              />
            ))}
          </DiffSection>
        )}

        {(relAdded.length > 0 || relRemoved.length > 0) && (
          <DiffSection title={`Relations (+${relAdded.length} / −${relRemoved.length})`} variant="neutral">
            {relAdded.map((r) => (
              <div key={`add-${r.key}`} className="diff-row diff-row-added">
                <span className="diff-row-name">+ {formatRelKey(r.key)}</span>
                {r.unmapped && <span className="diff-row-meta diff-stat-warn">unmapped: {r.unmapped}</span>}
              </div>
            ))}
            {relRemoved.map((r) => (
              <div key={`rm-${r.key}`} className="diff-row diff-row-removed">
                <span className="diff-row-name">− {formatRelKey(r.key)}</span>
              </div>
            ))}
          </DiffSection>
        )}

        {unmapped.length > 0 && (
          <DiffSection title="Unmapped" variant="warn">
            <p className="dialog-message">
              These DDL relations could not be re-bound to existing tables/columns and will be
              skipped on apply.
            </p>
            {unmapped.map((r) => (
              <div key={`um-${r.key}`} className="diff-row diff-row-warn">
                <span className="diff-row-name">{formatRelKey(r.key)}</span>
                <span className="diff-row-meta">{r.unmapped}</span>
              </div>
            ))}
          </DiffSection>
        )}

        {diff.warnings.length > 0 && (
          <DiffSection title="Warnings" variant="warn">
            {diff.warnings.map((w, i) => (
              <p key={i} className="warning">{w}</p>
            ))}
          </DiffSection>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" onClick={onBack}>Back</button>
        <div className="modal-spacer" />
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={handleApply}>
          Apply Smart Merge
        </button>
      </div>
    </ModalFrame>
  );
}

interface DiffSectionProps {
  title: string;
  variant: "added" | "modified" | "removed" | "warn" | "neutral";
  children: React.ReactNode;
}

function DiffSection({ title, variant, children }: DiffSectionProps) {
  return (
    <section className={`diff-section diff-section-${variant}`}>
      <h3 className="diff-section-title">{title}</h3>
      {children}
    </section>
  );
}

interface EntityRowProps {
  entity: EntityDiff;
  expanded: boolean;
  onToggle: () => void;
}

function EntityRow({ entity, expanded, onToggle }: EntityRowProps) {
  const cls =
    entity.kind === "added"
      ? "diff-row diff-row-added"
      : entity.kind === "modified"
        ? "diff-row diff-row-modified"
        : "diff-row";
  const counts = countColumnDiffs(entity.columns);
  return (
    <div className={cls}>
      <button
        type="button"
        className="diff-row-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="diff-row-name">{entity.displayName}</span>
        <span className="diff-row-meta">
          {entity.kind === "added" && `${entity.incomingEntity?.columns.length ?? 0} cols`}
          {entity.kind === "modified" && (
            <>
              {counts.added > 0 && <span className="diff-pill diff-pill-added">+{counts.added}</span>}
              {counts.modified > 0 && <span className="diff-pill diff-pill-modified">~{counts.modified}</span>}
              {counts.removed > 0 && <span className="diff-pill diff-pill-removed">−{counts.removed}</span>}
            </>
          )}
        </span>
      </button>
      {expanded && <ul className="diff-col-list">{entity.columns.map((c, i) => <ColumnRow key={i} col={c} />)}</ul>}
    </div>
  );
}

interface RemovedEntityRowProps {
  entity: Extract<EntityDiff, { kind: "removed" }>;
  expanded: boolean;
  onToggleExpand: () => void;
  hardDelete: boolean;
  onToggleHardDelete: () => void;
  allowHardDelete: boolean;
}

function RemovedEntityRow({
  entity,
  expanded,
  onToggleExpand,
  hardDelete,
  onToggleHardDelete,
  allowHardDelete,
}: RemovedEntityRowProps) {
  const cur = entity.currentEntity;
  return (
    <div className="diff-row diff-row-removed">
      <button
        type="button"
        className="diff-row-toggle"
        onClick={onToggleExpand}
        aria-expanded={expanded}
      >
        <span className="diff-row-name">{entity.displayName}</span>
        <span className="diff-row-meta">{cur.columns.length} cols</span>
      </button>
      {allowHardDelete && (
        <label className="diff-row-action">
          <input
            type="checkbox"
            checked={hardDelete}
            onChange={onToggleHardDelete}
          />
          Delete from canvas
        </label>
      )}
      {expanded && (
        <ul className="diff-col-list">
          {cur.columns.map((c) => (
            <li key={c.id} className="diff-col diff-col-removed">
              <code>{c.name}</code> <span className="diff-col-type">{c.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ColumnRow({ col }: { col: ColumnDiff }) {
  const name = col.incoming?.name ?? col.current?.name ?? "";
  const type = col.incoming?.type ?? col.current?.type ?? "";
  const cls = `diff-col diff-col-${col.kind}`;
  if (col.kind === "modified") {
    return (
      <li className={cls}>
        <code>{name}</code> <span className="diff-col-type">{type}</span>
        <span className="diff-col-changed">
          {col.changedFields?.map((f) => (
            <span key={f} className="diff-pill diff-pill-modified">{f}</span>
          ))}
        </span>
      </li>
    );
  }
  return (
    <li className={cls}>
      <code>{name}</code> <span className="diff-col-type">{type}</span>
    </li>
  );
}

function countColumnDiffs(diffs: ColumnDiff[]) {
  return {
    added: diffs.filter((c) => c.kind === "added").length,
    modified: diffs.filter((c) => c.kind === "modified").length,
    removed: diffs.filter((c) => c.kind === "removed").length,
  };
}

function formatRelKey(key: string): string {
  // key shape: src.col->tgt.col|cardinality
  return key.replaceAll("|", "  ");
}
