import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { useAppState, useAppDispatch } from "../state/hooks";
import { render } from "../canvas/renderer";
import { hitTest } from "../canvas/hitTest";
import { getAllRelationRoutes } from "../canvas/routing";
import { attachNonPassiveWheelListener, shouldRecordDragMove } from "../canvas/events";
import { clampZoom } from "../canvas/viewport";
import { createRelation, createEntity } from "../core/model/factory";
import { getColors } from "../canvas/constants";
import { findEmptyPosition } from "../core/layout/index";
import { ConfirmDialog } from "./ConfirmDialog";

export function CanvasView() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { type: "entity"; id: string; name: string } | { type: "relation"; id: string } | null
  >(null);
  const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null);
  const dragRef = useRef<{
    type: "entity" | "pan";
    entityId?: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    historyRecorded?: boolean;
    historyStartDepth?: number;
  } | null>(null);

  const colors = useMemo(() => getColors(state.theme), [state.theme]);

  // 관계 라우트는 schema가 바뀔 때만 계산해 render와 hitTest가 공유한다.
  // → 보이는 선과 클릭 판정선이 일치하고, 호버(빈 공간 mousemove)에서는 재계산이 없다.
  //   (드래그는 schema가 매 프레임 바뀌므로 여전히 재계산됨 — 필요 시 rAF 스로틀 고려)
  const routes = useMemo(() => getAllRelationRoutes(state.schema), [state.schema]);

  // 최신 그리기 로직을 ref로 보관해 ResizeObserver가 항상 최신 상태로 그리게 한다
  const drawRef = useRef<() => void>(() => {});

  // render loop — 상태 변경 시 이 이펙트만 그린다 (이전: ResizeObserver가 deps마다 재등록되어
  // 변경마다 2회 렌더). 마운트 직후 옵저버의 최초 콜백 1회는 의도된 초기 동기화.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      render(ctx, state.schema, state.viewport, state.selection, rect.width, rect.height, colors, state.ui.showInferredRelations, hoveredRelationId ?? undefined, routes);
    };
    drawRef.current = draw;
    draw();
  }, [state.schema, state.viewport, state.selection, colors, state.ui.showInferredRelations, hoveredRelationId, routes]);

  // resize observer — 마운트 시 1회만 등록, 콜백은 ref로 최신 draw를 호출
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const hit = hitTest(state.schema, state.viewport, sx, sy, routes, { showInferredRelations: state.ui.showInferredRelations });

    if (state.mode === "addRelation") {
      if (!state.isEditor) return;
      if (hit.type === "column") {
        if (!state.addRelationState?.sourceEntityId) {
          dispatch({ type: "SET_ADD_RELATION_STATE", state: { ...state.addRelationState!, sourceEntityId: hit.entityId, sourceColumnId: hit.columnId } });
        } else {
          const srcEId = state.addRelationState.sourceEntityId;
          const srcCId = state.addRelationState.sourceColumnId!;
          const tgtEId = hit.entityId;
          const tgtCId = hit.columnId;

          const duplicate = state.schema.relations.some(
            (r) =>
              (r.sourceEntityId === srcEId && r.sourceColumnId === srcCId && r.targetEntityId === tgtEId && r.targetColumnId === tgtCId) ||
              (r.sourceEntityId === tgtEId && r.sourceColumnId === tgtCId && r.targetEntityId === srcEId && r.targetColumnId === srcCId),
          );

          if (!duplicate) {
            const rel = createRelation({
              sourceEntityId: srcEId,
              sourceColumnId: srcCId,
              targetEntityId: tgtEId,
              targetColumnId: tgtCId,
              cardinality: state.addRelationState.cardinality,
            });
            dispatch({ type: "ADD_RELATION", relation: rel });
          }
          dispatch({ type: "SET_ADD_RELATION_STATE", state: null });
          dispatch({ type: "SET_MODE", mode: "select" });
        }
      }
      return;
    }

    if (hit.type === "entity" || hit.type === "column") {
      dispatch({
        type: "SET_SELECTION",
        selection: hit.type === "column"
          ? { type: "column", entityId: hit.entityId, columnId: hit.columnId }
          : { type: "entity", entityId: hit.entityId },
      });
      const entity = state.schema.entities.find((en) => en.id === hit.entityId);
      if (entity && state.isEditor) {
        dragRef.current = {
          type: "entity",
          entityId: hit.entityId,
          startX: sx,
          startY: sy,
          origX: entity.position.x,
          origY: entity.position.y,
          historyRecorded: false,
          historyStartDepth: state.history.length,
        };
      }
    } else if (hit.type === "relation") {
      dispatch({ type: "SET_SELECTION", selection: { type: "relation", relationId: hit.relationId } });
    } else {
      dispatch({ type: "SET_SELECTION", selection: { type: "none" } });
      dragRef.current = {
        type: "pan",
        startX: sx,
        startY: sy,
        origX: state.viewport.offsetX,
        origY: state.viewport.offsetY,
      };
    }
  }, [state, dispatch, routes]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (!dragRef.current) {
      const hit = hitTest(state.schema, state.viewport, sx, sy, routes, { showInferredRelations: state.ui.showInferredRelations });
      const nextHovered = hit.type === "relation" ? hit.relationId : null;
      setHoveredRelationId((prev) => (prev === nextHovered ? prev : nextHovered));
      return;
    }

    if (!state.isEditor && dragRef.current?.type === "entity") {
      dragRef.current = null;
      return;
    }

    const dx = sx - dragRef.current.startX;
    const dy = sy - dragRef.current.startY;

    if (dragRef.current.type === "entity") {
      const recordHistory = shouldRecordDragMove(
        dragRef.current.historyRecorded ?? false,
        dragRef.current.historyStartDepth ?? state.history.length,
        state.history.length,
      );
      dragRef.current.historyRecorded = true;
      dispatch({
        type: "MOVE_ENTITY",
        entityId: dragRef.current.entityId!,
        position: {
          x: dragRef.current.origX + dx / state.viewport.zoom,
          y: dragRef.current.origY + dy / state.viewport.zoom,
        },
        recordHistory,
      });
    } else {
      dispatch({
        type: "SET_VIEWPORT",
        viewport: {
          ...state.viewport,
          offsetX: dragRef.current.origX + dx,
          offsetY: dragRef.current.origY + dy,
        },
      });
    }
  }, [state, dispatch, routes]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = null;
    setHoveredRelationId(null);
  }, []);

  // 네이티브 WheelEvent 핸들러 — JSX onWheel(passive)이 아닌 passive:false 리스너로 등록된다
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      // zoom
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = clampZoom(state.viewport.zoom * delta);
      const ratio = newZoom / state.viewport.zoom;
      dispatch({
        type: "SET_VIEWPORT",
        viewport: {
          offsetX: sx - (sx - state.viewport.offsetX) * ratio,
          offsetY: sy - (sy - state.viewport.offsetY) * ratio,
          zoom: newZoom,
        },
      });
    } else {
      // pan
      dispatch({
        type: "SET_VIEWPORT",
        viewport: {
          ...state.viewport,
          offsetX: state.viewport.offsetX - e.deltaX,
          offsetY: state.viewport.offsetY - e.deltaY,
        },
      });
    }
  }, [state.viewport, dispatch]);

  // wheel은 preventDefault가 동작하도록 passive:false 네이티브 리스너로 바인딩
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return attachNonPassiveWheelListener(canvas, handleWheel);
  }, [handleWheel]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = hitTest(state.schema, state.viewport, sx, sy, routes, { showInferredRelations: state.ui.showInferredRelations });

    if (!state.isEditor) return;

    if (hit.type === "entity") {
      const entity = state.schema.entities.find((item) => item.id === hit.entityId);
      setPendingDelete({
        type: "entity",
        id: hit.entityId,
        name: entity?.name ?? "Untitled entity",
      });
    } else if (hit.type === "relation") {
      setPendingDelete({ type: "relation", id: hit.relationId });
    }
  }, [state, routes]);

  return (
    <>
      <canvas
        ref={canvasRef}
        role="img"
        tabIndex={0}
        aria-label={`Visual ER diagram for ${state.schema.name}: ${state.schema.entities.length} entities and ${state.schema.relations.length} relations. Press Control or Command K to find a table or column.`}
        style={{ width: "100%", height: "100%", display: "block", cursor: state.mode === "addRelation" ? "crosshair" : "default" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenu}
      />

      <nav
        aria-label="ER diagram schema contents"
        style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}
      >
        <h2>{state.schema.name}</h2>
        <ul>
          {state.schema.entities.map((entity) => (
            <li key={entity.id}>
              <span>Table {entity.name}, {entity.columns.length} columns</span>
              <ul>
                {entity.columns.map((column) => (
                  <li key={column.id}>
                    Column {entity.name}.{column.name}, {column.type}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {state.schema.relations.map((relation) => (
            <li key={relation.id}>
              Relation {relation.name ?? relation.cardinality}
            </li>
          ))}
        </ul>
      </nav>

      {state.schema.entities.length === 0 && (
        <div className="canvas-empty-state">
          <div className="canvas-empty-icon" aria-hidden="true">▦</div>
          <h2>No entities yet</h2>
          <p>Start with a table, import SQL, or reopen a saved project.</p>
          <div className="canvas-empty-actions">
            <button
              className="btn-primary"
              disabled={!state.isEditor}
              onClick={() => {
                const entity = createEntity({ name: "table_1" });
                entity.position = findEmptyPosition(state.schema.entities, entity);
                dispatch({ type: "ADD_ENTITY", entity });
                dispatch({ type: "SET_SELECTION", selection: { type: "entity", entityId: entity.id } });
              }}
            >
              Add Entity
            </button>
            <button disabled={!state.isEditor} onClick={() => dispatch({ type: "TOGGLE_DDL_MODAL" })}>Import DDL</button>
            <button
              disabled={state.persistence.serverReachable !== true}
              title={state.persistence.serverReachable === true ? undefined : "Saved projects are unavailable offline"}
              onClick={() => dispatch({ type: "TOGGLE_PROJECT_LIST" })}
            >
              Open Project
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.type === "entity" ? "Delete entity?" : "Delete relation?"}
        message={
          pendingDelete?.type === "entity"
            ? `Remove "${pendingDelete.name}" and its connected relations? This cannot be undone.`
            : "Remove this relation from the diagram? This cannot be undone."
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        variant="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete || !state.isEditor) return;
          if (pendingDelete.type === "entity") {
            dispatch({ type: "DELETE_ENTITY", entityId: pendingDelete.id });
          } else {
            dispatch({ type: "DELETE_RELATION", relationId: pendingDelete.id });
          }
          setPendingDelete(null);
        }}
      />
    </>
  );
}
