import { useEffect, useState, useCallback, useRef } from "react";
import { useAppState, useAppDispatch } from "./state/hooks";
import { CanvasView } from "./components/CanvasView";
import { Toolbar } from "./components/Toolbar";
import { PropertyPanel } from "./components/PropertyPanel";
import { StatusBar } from "./components/StatusBar";
import { DDLImportModal } from "./components/DDLImportModal";
import { ProjectListModal } from "./components/ProjectListModal";
import { AIInferModal } from "./components/AIInferModal";
import { AISettingsModal } from "./components/AISettingsModal";
import { ModalFrame } from "./components/ModalFrame";
import { Toast, type ToastTone } from "./components/Toast";
import { WelcomeOverlay } from "./components/WelcomeOverlay";
import { ShortcutsPanel } from "./components/ShortcutsPanel";
import { EntityNavigator } from "./components/EntityNavigator";
import { saveProject, StorageAuthError, StorageConflictError } from "./core/storage/index";
import { getSessionGeneration, getSessionInfo } from "./core/auth/index";
import { createViewportCenteredOn } from "./canvas/viewport";
import "./App.css";

const WELCOME_STORAGE_KEY = "erd-tool:welcome-dismissed";

function isWelcomeDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(WELCOME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistWelcomeDismissed(): void {
  try {
    window.localStorage.setItem(WELCOME_STORAGE_KEY, "1");
  } catch {
    // Storage can be blocked in privacy/sandbox modes; dismiss for this session only.
  }
}

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function SaveAsDialog({
  open,
  name,
  onNameChange,
  onCancel,
  onSave,
}: {
  open: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  if (!open) return null;

  const trimmed = name.trim();

  return (
    <ModalFrame
      ariaLabelledBy="save-as-title"
      ariaDescribedBy="save-as-description"
      className="modal-sm"
      onClose={onCancel}
    >
      <form
        className="dialog-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          onSave(trimmed);
        }}
      >
        <h2 id="save-as-title">Save As</h2>
        <p id="save-as-description" className="dialog-message">
          Save a new copy with a clear project name.
        </p>
        <label className="dialog-field">
          Project name
          <input
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Untitled"
          />
        </label>
        <div className="modal-footer">
          <div className="modal-spacer" />
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!trimmed}>Save Copy</button>
        </div>
      </form>
    </ModalFrame>
  );
}

function AppInner() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false);
  const [saveAsName, setSaveAsName] = useState("Untitled");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showEntityNavigator, setShowEntityNavigator] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !isWelcomeDismissed());
  const schemaRef = useRef(state.schema);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  const handleSave = useCallback(async () => {
    if (!state.isEditor) {
      showToast("Unlock for editing to save", "info");
      return;
    }
    if (state.persistence.serverReachable !== true) {
      showToast("Local draft — export JSON to keep your work", "info");
      return;
    }
    if (!state.persistence.hasPersistedProject) {
      showToast("New drafts require Save As", "info");
      return;
    }
    dispatch({ type: "SET_SAVE_STATE", saveState: "saving" });
    try {
      await saveProject(state.schema);
      dispatch({ type: "MARK_SAVED" });
      showToast("Saved", "success");
    } catch (err) {
      dispatch({ type: "SET_SAVE_STATE", saveState: "error" });
      if (err instanceof StorageAuthError) {
        showToast("Editor permission expired — unlock again", "info");
      } else if (err instanceof StorageConflictError) {
        showToast("Save conflict — reload the project before saving again", "info");
      } else {
        showToast("Save failed", "info");
      }
    }
  }, [
    dispatch,
    showToast,
    state.isEditor,
    state.persistence.hasPersistedProject,
    state.persistence.serverReachable,
    state.schema,
  ]);

  const handleSaveAs = useCallback(async (name: string) => {
    if (!state.isEditor) {
      showToast("Unlock for editing to save", "info");
      return;
    }
    if (state.persistence.serverReachable !== true) {
      showToast("Local draft — export JSON to keep your work", "info");
      return;
    }
    dispatch({ type: "SET_SAVE_STATE", saveState: "saving" });
    try {
      await saveProject({ ...state.schema, name });
      dispatch({ type: "SET_SCHEMA_NAME", name });
      dispatch({ type: "MARK_SAVED" });
      showToast(`Saved as "${name}"`, "success");
      setShowSaveAsDialog(false);
      setSaveAsName(name);
    } catch (err) {
      dispatch({ type: "SET_SAVE_STATE", saveState: "error" });
      if (err instanceof StorageAuthError) {
        showToast("Editor permission expired — unlock again", "info");
      } else if (err instanceof StorageConflictError) {
        showToast("Save conflict — reload the project before saving again", "info");
      } else {
        showToast("Save failed", "info");
      }
    }
  }, [dispatch, showToast, state.isEditor, state.persistence.serverReachable, state.schema]);

  const openSaveAsDialog = useCallback(() => {
    setSaveAsName(state.schema.name);
    setShowSaveAsDialog(true);
  }, [state.schema.name]);

  const dismissWelcome = useCallback(() => {
    persistWelcomeDismissed();
    setShowWelcome(false);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    const requestGeneration = getSessionGeneration();
    getSessionInfo().then(
      (info) => {
        if (cancelled || requestGeneration !== getSessionGeneration()) return;
        dispatch({
          type: "SET_AI_ACCESS",
          canUseAI: info.canUseAI,
          authUserEmail: info.user?.email ?? null,
          aiAccessStatus: info.aiAccessGrant?.status ?? null,
        });
        dispatch({ type: "SET_SERVER_REACHABLE", reachable: info.serverReachable });
        dispatch({
          type: "SET_AUTH",
          isEditor: info.serverReachable ? info.canEdit : true,
          isAdmin: info.serverReachable && info.editorRole === "admin",
        });
        // No server to gate writes → local/offline mode is editable without a
        // password (Save-to-server stays unavailable; local edit/import/export work).
      },
      () => {
        if (!cancelled && requestGeneration === getSessionGeneration()) {
          dispatch({ type: "SET_SERVER_REACHABLE", reachable: false });
          dispatch({ type: "SET_AI_ACCESS", canUseAI: state.isAdmin, authUserEmail: null, aiAccessStatus: null });
          dispatch({ type: "SET_AUTH", isEditor: true, isAdmin: false });
        }
      },
    );
    return () => { cancelled = true; };
  }, [dispatch, state.isAdmin]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target);

      const hasBlockingOverlay =
        state.ui.showDDLModal ||
        state.ui.showProjectList ||
        state.ui.showAIModal ||
        state.ui.showAISettingsModal ||
        showSaveAsDialog ||
        showShortcuts ||
        showEntityNavigator ||
        showWelcome;

      if (!editable && !hasBlockingOverlay && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowEntityNavigator(true);
        return;
      }

      if (!editable && !hasBlockingOverlay && event.key === "?") {
        event.preventDefault();
        setShowShortcuts((current) => !current);
        return;
      }

      if (editable || hasBlockingOverlay) return;
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (event.shiftKey) {
          openSaveAsDialog();
        } else {
          handleSave();
        }
      } else if (key === "z") {
        if (!state.isEditor) return;
        event.preventDefault();
        dispatch(event.shiftKey ? { type: "REDO" } : { type: "UNDO" });
      } else if (key === "o") {
        event.preventDefault();
        if (state.persistence.serverReachable === true) {
          dispatch({ type: "TOGGLE_PROJECT_LIST" });
        } else {
          showToast("Saved projects are unavailable while the server is offline", "info");
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    dispatch,
    handleSave,
    openSaveAsDialog,
    showToast,
    showSaveAsDialog,
    showEntityNavigator,
    showShortcuts,
    showWelcome,
    state.isEditor,
    state.persistence.serverReachable,
    state.ui.showAIModal,
    state.ui.showAISettingsModal,
    state.ui.showDDLModal,
    state.ui.showProjectList,
  ]);

  useEffect(() => {
    schemaRef.current = state.schema;
  }, [state.schema]);

  useEffect(() => {
    if (
      !state.isEditor
      || state.persistence.serverReachable !== true
      || !state.persistence.hasPersistedProject
      || !state.persistence.dirty
    ) return;
    const timer = window.setInterval(() => {
      dispatch({ type: "SET_SAVE_STATE", saveState: "saving" });
      saveProject(schemaRef.current).then(
        () => {
          dispatch({ type: "MARK_SAVED" });
          showToast("Auto-saved", "info");
        },
        (err) => {
          dispatch({ type: "SET_SAVE_STATE", saveState: "error" });
          if (err instanceof StorageConflictError) {
            showToast("Save conflict — reload the project before saving again", "info");
          }
          // Other failures stay silent — auth-fail event handles re-lock.
        },
      );
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [
    dispatch,
    showToast,
    state.isEditor,
    state.persistence.dirty,
    state.persistence.hasPersistedProject,
    state.persistence.serverReachable,
  ]);

  useEffect(() => {
    const handler = () => {
      dispatch({ type: "SET_AUTH", isEditor: false, isAdmin: false });
      showToast("Editor session expired — please unlock again", "info");
    };
    window.addEventListener("erd-auth-fail", handler);
    return () => window.removeEventListener("erd-auth-fail", handler);
  }, [dispatch, showToast]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);

  return (
    <div className="app">
      <Toolbar
        onSave={handleSave}
        onSaveAs={openSaveAsDialog}
        onOpenNavigator={() => setShowEntityNavigator(true)}
      />
      <div className="main-area">
        <div className="canvas-container">
          <CanvasView />
        </div>
        <PropertyPanel />
      </div>
      <StatusBar />

      <DDLImportModal />
      <ProjectListModal />
      <AIInferModal />
      <AISettingsModal />
      <SaveAsDialog
        open={showSaveAsDialog}
        name={saveAsName}
        onNameChange={setSaveAsName}
        onCancel={() => setShowSaveAsDialog(false)}
        onSave={handleSaveAs}
      />
      <ShortcutsPanel open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {showEntityNavigator && (
        <EntityNavigator
          open
          entities={state.schema.entities}
          onClose={() => setShowEntityNavigator(false)}
          onSelect={(entityId) => {
            const entity = state.schema.entities.find((item) => item.id === entityId);
            const canvas = document.querySelector<HTMLCanvasElement>(".canvas-container > canvas");
            if (!entity || !canvas) return;
            const rect = canvas.getBoundingClientRect();
            dispatch({
              type: "SET_VIEWPORT",
              viewport: createViewportCenteredOn(
                entity,
                rect.width,
                rect.height,
                state.viewport.zoom,
              ),
            });
            dispatch({ type: "SET_SELECTION", selection: { type: "entity", entityId } });
          }}
        />
      )}
      {showWelcome && <WelcomeOverlay onClose={dismissWelcome} />}
      {toast && <Toast tone={toast.tone} message={toast.message} onDismiss={() => setToast(null)} />}
    </div>
  );
}

export default function App() {
  return <AppInner />;
}
