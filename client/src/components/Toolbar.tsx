import { useState, useRef, useEffect, useCallback, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useAppState, useAppDispatch } from "../state/hooks";
import { createEntity } from "../core/model/factory";
import { findEmptyPosition } from "../core/layout/index";
import { saveProject, exportToJSON, importFromJSON } from "../core/storage/index";
import { generateDDL, type SQLDialect } from "../core/generator/ddl";
import { generateMermaid } from "../core/generator/mermaid";
import { generateDBML } from "../core/generator/dbml";
import { exportToImage } from "../core/export/image";
import { inferRelationsWithAI } from "../core/ai/client";
import { loadAIConfig, getDefaultAIConfig } from "../core/ai/config";
import { logoutSession, startOAuthLogin } from "../core/auth/index";
import { Tooltip } from "./Tooltip";
import { LockToggle } from "./LockToggle";
import type { Cardinality } from "../core/model/types";

interface ToolbarProps {
  onSave?: () => void | Promise<void>;
  onSaveAs?: () => void;
  onOpenNavigator?: () => void;
}

function ToolbarIcon({ children }: { children: ReactNode }) {
  return <span className="toolbar-icon" aria-hidden="true">{children}</span>;
}

function IconPaths({ name }: { name: string }) {
  switch (name) {
    case "import":
      return <path d="M12 3v10m0 0l4-4m-4 4L8 9M5 21h14" />;
    case "undo":
      return <path d="M9 7H5v4M5 11a7 7 0 117 7h-3" />;
    case "redo":
      return <path d="M15 7h4v4M19 11a7 7 0 10-7 7h3" />;
    case "entity":
      return <path d="M4 6h16M4 12h16M4 18h16M8 4v16" />;
    case "layout":
      return <path d="M4 4h7v7H4zm9 0h7v5h-7zM4 13h5v7H4zm9 3h7v4h-7z" />;
    case "link":
      return <path d="M10.5 13.5l3-3m-5.5 6H7a4 4 0 010-8h3m4 0h3a4 4 0 010 8h-3" />;
    case "open":
      return <path d="M4 19V7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2z" />;
    case "save":
      return <path d="M5 21V5h11l3 3v13H5zm3-9h8m-8 4h6M8 5v4h6V5" />;
    case "export":
      return <path d="M12 21V11m0 0l4 4m-4-4l-4 4M5 7h14" />;
    case "spark":
      return <path d="M12 3l1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3z" />;
    case "settings":
      return <path d="M12 8.5A3.5 3.5 0 1112 15.5 3.5 3.5 0 0112 8.5zm0-5.5l1.2 2.4 2.7.4.7 2.6 2 1.8-1 2.5 1 2.5-2 1.8-.7 2.6-2.7.4L12 21l-1.2-2.4-2.7-.4-.7-2.6-2-1.8 1-2.5-1-2.5 2-1.8.7-2.6 2.7-.4L12 3z" />;
    case "theme":
      return <path d="M20 12.5A8.5 8.5 0 1111.5 4 6.5 6.5 0 0020 12.5z" />;
    case "search":
      return <path d="M11 5a6 6 0 100 12 6 6 0 000-12zm4.5 10.5L20 20" />;
    default:
      return <path d="M5 12h14" />;
  }
}

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <IconPaths name={name} />
    </svg>
  );
}

interface ToolbarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: string;
  label: string;
  tooltip: string;
  shortcut?: string;
  active?: boolean;
}

function ToolbarButton({
  icon,
  label,
  tooltip,
  shortcut,
  active,
  className,
  ...buttonProps
}: ToolbarButtonProps) {
  const classes = [className, icon ? "toolbar-button-icon" : "", active ? "active" : ""].filter(Boolean).join(" ");

  return (
    <Tooltip label={tooltip} shortcut={shortcut}>
      <button {...buttonProps} className={classes} aria-label={label} aria-pressed={active === undefined ? undefined : active}>
        {icon ? (
          <ToolbarIcon>
            <Icon name={icon} />
          </ToolbarIcon>
        ) : null}
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}

export function Toolbar({ onSave, onSaveAs, onOpenNavigator }: ToolbarProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const canEdit = state.isEditor;
  const lockTooltip = canEdit ? undefined : "Unlock for editing first";
  const serverAvailable = state.persistence.serverReachable === true;
  const serverTooltip = state.persistence.serverReachable === null
    ? "Checking saved-project server"
    : "Unavailable offline — export JSON to keep this draft";
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportMenuPosition, setExportMenuPosition] = useState({ top: 0, left: 0 });
  const exportRef = useRef<HTMLDivElement>(null);

  const closeExportMenuAndRestoreFocus = useCallback(() => {
    setShowExportMenu(false);
    window.requestAnimationFrame(() => {
      exportRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
  }, []);

  useEffect(() => {
    if (!showExportMenu) return;
    const updatePosition = () => {
      const rect = exportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const toolbarBottom = exportRef.current?.closest(".toolbar")?.getBoundingClientRect().bottom ?? rect.bottom;
      setExportMenuPosition({
        top: Math.max(rect.bottom, toolbarBottom) + 8,
        left: Math.max(8, Math.min(rect.right - 168, window.innerWidth - 176)),
      });
    };
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      exportRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    });
    const handleMouseDown = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    const toolbar = exportRef.current?.closest(".toolbar");
    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("resize", updatePosition);
    toolbar?.addEventListener("scroll", updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("resize", updatePosition);
      toolbar?.removeEventListener("scroll", updatePosition);
    };
  }, [showExportMenu]);

  const handleExportMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!showExportMenu) return;
    const items = Array.from(exportRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    if (event.key === "Escape") {
      event.preventDefault();
      closeExportMenuAndRestoreFocus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (currentIndex < 0 ? 0 : (currentIndex + 1) % items.length)
          : (currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length);
    items[nextIndex].focus();
  };

  const handleAddEntity = () => {
    const entity = createEntity({
      name: `table_${state.schema.entities.length + 1}`,
    });
    entity.position = findEmptyPosition(state.schema.entities, entity);
    dispatch({ type: "ADD_ENTITY", entity });
    dispatch({ type: "SET_SELECTION", selection: { type: "entity", entityId: entity.id } });
  };

  const handleSave = () => {
    if (onSave) {
      void onSave();
      return;
    }
    void saveProject(state.schema).catch(() => { /* parent handles UX */ });
  };

  const handleSaveAs = () => {
    onSaveAs?.();
  };

  const handleExportJSON = () => {
    const json = exportToJSON(state.schema);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.schema.name || "erd"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    closeExportMenuAndRestoreFocus();
  };

  const handleExportDDL = (dialect: SQLDialect) => {
    const ddl = generateDDL(state.schema, { dialect });
    const blob = new Blob([ddl], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.schema.name || "erd"}.sql`;
    anchor.click();
    URL.revokeObjectURL(url);
    closeExportMenuAndRestoreFocus();
  };

  const handleExportMermaid = () => {
    const mermaid = generateMermaid(state.schema);
    const blob = new Blob([mermaid], { type: "text/vnd.mermaid" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.schema.name || "erd"}.mmd`;
    anchor.click();
    URL.revokeObjectURL(url);
    closeExportMenuAndRestoreFocus();
  };

  const handleExportDBML = () => {
    const dbml = generateDBML(state.schema);
    const blob = new Blob([dbml], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.schema.name || "erd"}.dbml`;
    anchor.click();
    URL.revokeObjectURL(url);
    closeExportMenuAndRestoreFocus();
  };

  const handleExportPNG = async () => {
    const blob = await exportToImage(state.schema, state.theme);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.schema.name || "erd"}.png`;
    anchor.click();
    URL.revokeObjectURL(url);
    closeExportMenuAndRestoreFocus();
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const result = importFromJSON(text);
      if (result.error) {
        alert(`Import error: ${result.error}`);
        return;
      }
      dispatch({ type: "IMPORT_SCHEMA", schema: result.schema });
    };
    input.click();
  };

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (state.aiInference.status === "idle" && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [state.aiInference.status]);

  const handleAIInfer = useCallback(async () => {
    if (!state.canUseAI) {
      if (state.authUserEmail) return;
      startOAuthLogin("github");
      return;
    }
    const config = loadAIConfig() ?? getDefaultAIConfig();
    if (!config.apiUrl) {
      dispatch({ type: "TOGGLE_AI_SETTINGS_MODAL" });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: "TOGGLE_AI_MODAL" });
    dispatch({ type: "SET_AI_INFERENCE_STATE", state: { status: "loading" } });

    try {
      const result = await inferRelationsWithAI(
        config,
        state.schema.entities,
        state.schema.relations,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        dispatch({ type: "SET_AI_INFERENCE_STATE", state: { status: "success", result } });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch({
        type: "SET_AI_INFERENCE_STATE",
        state: { status: "error", message: error instanceof Error ? error.message : String(error) },
      });
    }
  }, [dispatch, state.authUserEmail, state.canUseAI, state.schema.entities, state.schema.relations]);

  const handleSignOut = useCallback(async () => {
    if (!await logoutSession()) {
      alert("Failed to sign out. Please try again.");
      return;
    }
    dispatch({ type: "SET_AI_ACCESS", canUseAI: false, authUserEmail: null, aiAccessStatus: null });
    dispatch({ type: "SET_AUTH", isEditor: false, isAdmin: false });
  }, [dispatch]);

  const activeCardinality = state.mode === "addRelation" ? state.addRelationState?.cardinality : null;

  const handleRelation = (cardinality: Cardinality) => {
    if (activeCardinality === cardinality) {
      dispatch({ type: "SET_MODE", mode: "select" });
    } else {
      dispatch({ type: "SET_MODE", mode: "addRelation" });
      dispatch({ type: "SET_ADD_RELATION_STATE", state: { cardinality } });
    }
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="ERD actions">
      <ToolbarButton
        icon="import"
        label="DDL Import"
        tooltip={lockTooltip ?? "Paste SQL CREATE TABLE statements"}
        onClick={() => dispatch({ type: "TOGGLE_DDL_MODAL" })}
        disabled={!canEdit}
      />
      <ToolbarButton
        icon="undo"
        label="Undo"
        tooltip={lockTooltip ?? "Undo the last canvas change"}
        shortcut="Cmd/Ctrl + Z"
        onClick={() => dispatch({ type: "UNDO" })}
        disabled={!canEdit || state.history.length === 0}
      />
      <ToolbarButton
        icon="redo"
        label="Redo"
        tooltip={lockTooltip ?? "Redo the last undone change"}
        shortcut="Cmd/Ctrl + Shift + Z"
        onClick={() => dispatch({ type: "REDO" })}
        disabled={!canEdit || state.future.length === 0}
      />
      <ToolbarButton
        icon="entity"
        label="Add Entity"
        tooltip={lockTooltip ?? "Create a new table on the canvas"}
        onClick={handleAddEntity}
        disabled={!canEdit}
      />
      <ToolbarButton
        icon="layout"
        label="Auto Layout"
        tooltip={lockTooltip ?? "Reflow entities into a clean layout"}
        onClick={() => dispatch({ type: "AUTO_LAYOUT" })}
        disabled={!canEdit || state.schema.entities.length < 2}
      />
      <ToolbarButton
        icon="search"
        label="Find"
        tooltip="Find a table or column and center it"
        shortcut="Cmd/Ctrl + K"
        onClick={onOpenNavigator}
        disabled={state.schema.entities.length === 0}
      />
      <span className="toolbar-divider" />
      {(["1:1", "1:N", "N:1", "N:M"] as const).map((cardinality) => (
        <ToolbarButton
          key={cardinality}
          label={cardinality}
          tooltip={lockTooltip ?? `Start ${cardinality} relation mode`}
          active={activeCardinality === cardinality}
          onClick={() => handleRelation(cardinality)}
          disabled={!canEdit}
        />
      ))}
      <div className="toolbar-spacer" />
      <ToolbarButton
        icon="open"
        label="Open"
        tooltip={serverAvailable ? "Browse saved projects" : serverTooltip}
        shortcut="Cmd/Ctrl + O"
        onClick={() => dispatch({ type: "TOGGLE_PROJECT_LIST" })}
        disabled={!serverAvailable}
      />
      <ToolbarButton
        icon="save"
        label="Save"
        tooltip={
          !serverAvailable
            ? serverTooltip
            : !state.persistence.hasPersistedProject
              ? "New drafts require Save As"
              : lockTooltip ?? "Save the current project"
        }
        shortcut="Cmd/Ctrl + S"
        onClick={handleSave}
        disabled={!canEdit || !serverAvailable || !state.persistence.hasPersistedProject}
      />
      <ToolbarButton
        icon="save"
        label="Save As"
        tooltip={!serverAvailable ? serverTooltip : lockTooltip ?? "Save a new copy with another name"}
        shortcut="Cmd/Ctrl + Shift + S"
        onClick={handleSaveAs}
        disabled={!canEdit || !serverAvailable}
      />
      <div className="export-wrapper" ref={exportRef} onKeyDown={handleExportMenuKeyDown}>
        <ToolbarButton
          icon="export"
          label="Export"
          tooltip="Download the current diagram"
          onClick={() => setShowExportMenu((open) => !open)}
          aria-expanded={showExportMenu}
          aria-haspopup="menu"
        />
        {showExportMenu && (
          <div className="export-menu" role="menu" aria-label="Export options" style={exportMenuPosition}>
            <button onClick={handleExportPNG} role="menuitem">PNG (.png)</button>
            <button onClick={handleExportJSON} role="menuitem">JSON (.json)</button>
            <button onClick={() => handleExportDDL("postgresql")} role="menuitem">DDL - PostgreSQL (.sql)</button>
            <button onClick={() => handleExportDDL("mysql")} role="menuitem">DDL - MySQL (.sql)</button>
            <button onClick={handleExportMermaid} role="menuitem">Mermaid (.mmd)</button>
            <button onClick={handleExportDBML} role="menuitem">DBML (.dbml)</button>
          </div>
        )}
      </div>
      <ToolbarButton
        icon="import"
        label="Import"
        tooltip={lockTooltip ?? "Load a schema from JSON"}
        onClick={handleImport}
        disabled={!canEdit}
      />
      <span className="toolbar-divider" />
      <ToolbarButton
        icon="layout"
        label="Inferred"
        tooltip="Toggle inferred relations"
        active={state.ui.showInferredRelations}
        onClick={() => dispatch({ type: "TOGGLE_INFERRED_RELATIONS" })}
      />
      <ToolbarButton
        icon="spark"
        label="AI Infer"
        tooltip={
          state.canUseAI
            ? state.authUserEmail
              ? `Ask AI to suggest new relations (${state.authUserEmail})`
              : "Ask AI to suggest new relations"
            : state.aiAccessStatus
              ? "AI access is not enabled for this account"
              : "Sign in with GitHub to use AI"
        }
        onClick={handleAIInfer}
        disabled={state.schema.entities.length < 2 || Boolean(state.authUserEmail && !state.canUseAI)}
      />
      {state.authUserEmail ? (
        <ToolbarButton
          label="Sign Out"
          tooltip={`Sign out ${state.authUserEmail}`}
          onClick={() => void handleSignOut()}
        />
      ) : null}
      <ToolbarButton
        icon="theme"
        label="Theme"
        tooltip="Switch between light and dark mode"
        active={state.theme === "dark"}
        onClick={() =>
          dispatch({
            type: "SET_THEME",
            theme: state.theme === "light" ? "dark" : "light",
          })
        }
      />
      <LockToggle />
    </div>
  );
}
