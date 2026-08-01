import { useState, useMemo } from "react";
import { useAppState, useAppDispatch } from "../state/hooks";
import { resolveAISuggestions } from "../core/ai/resolve";
import { createRelation } from "../core/model/factory";
import type { ResolvedSuggestion } from "../core/ai/types";
import { getAutoSelectedSuggestions } from "./aiModalState";
import { ModalFrame } from "./ModalFrame";

interface AIInferDialogProps {
  resolved: ResolvedSuggestion[];
  summary: string;
  onClose: () => void;
}

function AIInferDialog({ resolved, summary, onClose }: AIInferDialogProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [selected, setSelected] = useState<Set<number>>(() => getAutoSelectedSuggestions(resolved));

  const toggleItem = (index: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectableIndices = resolved
    .map((item, index) => (!item.unresolvable && !item.duplicate ? index : -1))
    .filter((index) => index >= 0);

  const handleApply = () => {
    if (!state.isEditor) return;
    const relations = resolved
      .filter((_, index) => selected.has(index))
      .filter((item) => !item.unresolvable && !item.duplicate)
      .map((item) =>
        createRelation({
          sourceEntityId: item.sourceEntityId,
          sourceColumnId: item.sourceColumnId,
          targetEntityId: item.targetEntityId,
          targetColumnId: item.targetColumnId,
          cardinality: item.suggestion.cardinality,
          source: "ai",
        }),
      );

    if (relations.length > 0) {
      dispatch({ type: "APPLY_AI_RELATIONS", relations });
    }
    onClose();
  };

  const confidenceClass = (confidence: string) =>
    confidence === "high" ? "confidence-high" : confidence === "low" ? "confidence-low" : "confidence-medium";

  return (
    <ModalFrame
      ariaLabelledBy="ai-infer-title"
      ariaDescribedBy={summary ? "ai-infer-description" : undefined}
      className="ai-infer-modal"
      onClose={onClose}
    >
      <h2 id="ai-infer-title">AI Relation Inference</h2>

      {summary && (
        <p id="ai-infer-description" className="ai-summary">{summary}</p>
      )}

      {resolved.length === 0 ? (
        <p className="ai-empty">No relationships found.</p>
      ) : (
        <>
          <div className="ai-suggestion-list">
            {resolved.map((item, index) => {
              const disabled = item.unresolvable || item.duplicate;
              return (
                <label key={index} className={`ai-suggestion-item${disabled ? " disabled" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(index)}
                    disabled={disabled}
                    onChange={() => toggleItem(index)}
                  />
                  <div className="ai-suggestion-content">
                    <div className="ai-suggestion-header">
                      <span className="ai-suggestion-rel">
                        {item.suggestion.sourceEntityName}.{item.suggestion.sourceColumnName}
                        {" → "}
                        {item.suggestion.targetEntityName}.{item.suggestion.targetColumnName}
                      </span>
                      <span className="ai-suggestion-card">{item.suggestion.cardinality}</span>
                      <span className={`ai-confidence ${confidenceClass(item.suggestion.confidence)}`}>
                        {item.suggestion.confidence}
                      </span>
                    </div>
                    <div className="ai-suggestion-reasoning">{item.suggestion.reasoning}</div>
                    {item.duplicate && <div className="ai-suggestion-note">Already exists</div>}
                    {item.unresolvable && (
                      <div className="ai-suggestion-note">{item.unresolvableReason}</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="ai-select-actions">
            <button onClick={() => setSelected(new Set(selectableIndices))}>Select All</button>
            <button onClick={() => setSelected(new Set())}>Deselect All</button>
          </div>
        </>
      )}

      <div className="modal-footer">
        <div className="modal-spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleApply} disabled={!state.isEditor || selected.size === 0}>
          Apply ({selected.size})
        </button>
      </div>
    </ModalFrame>
  );
}

export function AIInferModal() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const resolved = useMemo<ResolvedSuggestion[]>(() => {
    if (state.aiInference.status !== "success") return [];
    return resolveAISuggestions(
      state.aiInference.result.suggestions,
      state.schema.entities,
      state.schema.relations,
    );
  }, [state.aiInference, state.schema.entities, state.schema.relations]);

  if (!state.ui.showAIModal) return null;

  const handleClose = () => {
    dispatch({ type: "TOGGLE_AI_MODAL" });
    dispatch({ type: "SET_AI_INFERENCE_STATE", state: { status: "idle" } });
  };

  if (state.aiInference.status === "loading") {
    return (
      <ModalFrame
        ariaLabelledBy="ai-loading-title"
        ariaDescribedBy="ai-loading-description"
        className="ai-infer-modal"
        onClose={handleClose}
      >
        <h2 id="ai-loading-title">AI Relation Inference</h2>
        <div className="ai-loading">
          <div className="ai-spinner" />
          <p id="ai-loading-description">AI is analyzing relationships...</p>
        </div>
        <div className="modal-footer">
          <div className="modal-spacer" />
          <button onClick={handleClose}>Cancel</button>
        </div>
      </ModalFrame>
    );
  }

  if (state.aiInference.status === "error") {
    return (
      <ModalFrame
        ariaLabelledBy="ai-error-title"
        ariaDescribedBy="ai-error-description"
        className="ai-infer-modal"
        onClose={handleClose}
      >
        <h2 id="ai-error-title">AI Relation Inference</h2>
        <div className="ai-error">
          <p id="ai-error-description">{state.aiInference.message}</p>
        </div>
        <div className="modal-footer">
          <div className="modal-spacer" />
          <button onClick={handleClose}>Close</button>
        </div>
      </ModalFrame>
    );
  }

  if (state.aiInference.status !== "success") return null;

  return (
    <AIInferDialog
      key={state.aiInference.result.suggestions
        .map((suggestion) =>
          `${suggestion.sourceEntityName}.${suggestion.sourceColumnName}->${suggestion.targetEntityName}.${suggestion.targetColumnName}`,
        )
        .join("|")}
      resolved={resolved}
      summary={state.aiInference.result.summary}
      onClose={handleClose}
    />
  );
}
