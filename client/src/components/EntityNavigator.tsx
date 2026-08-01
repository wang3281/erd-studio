import { useEffect, useMemo, useRef, useState } from "react";
import type { Entity } from "../core/model/types";
import { ModalFrame } from "./ModalFrame";
import { filterEntityNavigatorResults } from "./entityNavigatorSearch";

export function EntityNavigator({
  open,
  entities,
  onClose,
  onSelect,
}: {
  open: boolean;
  entities: Entity[];
  onClose: () => void;
  onSelect: (entityId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => filterEntityNavigatorResults(entities, query),
    [entities, query],
  );

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;
  const safeActiveIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  const selectResult = (index: number) => {
    const result = results[index];
    if (!result) return;
    onSelect(result.entity.id);
    onClose();
  };

  return (
    <ModalFrame
      ariaLabelledBy="entity-navigator-title"
      ariaDescribedBy="entity-navigator-description"
      className="entity-navigator"
      onClose={onClose}
    >
      <div className="entity-navigator-header">
        <div>
          <h2 id="entity-navigator-title">Find an entity</h2>
          <p id="entity-navigator-description">
            Search table or column names, then press Enter to center the table.
          </p>
        </div>
        <kbd>Esc</kbd>
      </div>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search tables and columns"
        aria-controls="entity-navigator-results"
        aria-expanded="true"
        aria-activedescendant={results[safeActiveIndex] ? `entity-result-${results[safeActiveIndex].entity.id}` : undefined}
        autoComplete="off"
        placeholder="Table or column name…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (results.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % results.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => (current - 1 + results.length) % results.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            selectResult(safeActiveIndex);
          }
        }}
      />
      <div className="entity-navigator-summary" aria-live="polite">
        {results.length} {results.length === 1 ? "table" : "tables"}
      </div>
      <div
        id="entity-navigator-results"
        className="entity-navigator-results"
        role="listbox"
        aria-label="Matching tables"
      >
        {results.map((result, index) => (
          <button
            id={`entity-result-${result.entity.id}`}
            key={result.entity.id}
            type="button"
            role="option"
            aria-selected={index === safeActiveIndex}
            className={index === safeActiveIndex ? "active" : undefined}
            onMouseMove={() => setActiveIndex(index)}
            onClick={() => selectResult(index)}
          >
            <span className="entity-navigator-name">{result.entity.name}</span>
            <span className="entity-navigator-detail">
              {result.matchingColumns.length > 0
                ? `Columns: ${result.matchingColumns.slice(0, 3).join(", ")}${result.matchingColumns.length > 3 ? ` +${result.matchingColumns.length - 3}` : ""}`
                : `${result.entity.columns.length} columns`}
            </span>
          </button>
        ))}
        {results.length === 0 && (
          <p className="entity-navigator-empty">No matching tables or columns.</p>
        )}
      </div>
      <div className="entity-navigator-hint">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>Enter</kbd> Center</span>
      </div>
    </ModalFrame>
  );
}
