import { useState, useEffect, useCallback, useRef } from "react";
import { useAppState, useAppDispatch } from "../state/hooks";
import {
  listProjects,
  loadProject,
  deleteProject,
  StorageAuthError,
  type ProjectMeta,
} from "../core/storage/index";
import { ModalFrame } from "./ModalFrame";
import { ConfirmDialog } from "./ConfirmDialog";

export function ProjectListModal() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const openRequestRef = useRef(0);

  const isOpen = state.ui.showProjectList;
  const close = useCallback(() => {
    openRequestRef.current += 1;
    dispatch({ type: "TOGGLE_PROJECT_LIST" });
  }, [dispatch]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listProjects();
      list.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const refreshTimer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [isOpen, refresh]);

  if (!isOpen) return null;

  const handleOpen = async (name: string) => {
    const requestId = ++openRequestRef.current;
    try {
      const schema = await loadProject(name);
      if (requestId !== openRequestRef.current) return;
      if (!schema) {
        setError(`Project "${name}" not found on server`);
        return;
      }
      dispatch({ type: "LOAD_SCHEMA", schema });
      close();
    } catch (err) {
      if (requestId !== openRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to open project");
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteProject(name);
      void refresh();
    } catch (err) {
      if (err instanceof StorageAuthError) {
        setError("Editor permission required to delete projects");
      } else {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    } finally {
      setPendingDelete(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <>
      <ModalFrame
        ariaLabelledBy="project-list-title"
        className="project-list-modal"
        onClose={close}
      >
        <h2 id="project-list-title">Saved Projects (저장된 프로젝트)</h2>
        {loading && <p className="project-list-empty">Loading…</p>}
        {error && !loading && (
          <p className="project-list-empty" role="alert">{error}</p>
        )}
        {!loading && !error && projects.length === 0 && (
          <p className="project-list-empty">
            No saved projects yet. Save this diagram to share it with the team.
          </p>
        )}
        {!loading && projects.length > 0 && (
          <ul className="project-list">
            {projects.map((p) => (
              <li
                key={p.name}
                className={`project-item${p.name === state.schema.name ? " project-item-current" : ""}`}
              >
                <button className="project-info" onClick={() => handleOpen(p.name)}>
                  <span className="project-name">{p.name}</span>
                  <span className="project-date">{formatDate(p.updatedAt)}</span>
                </button>
                <div className="project-actions">
                  <button className="btn-open" onClick={() => handleOpen(p.name)} aria-label={`Open ${p.name}`}>
                    Open
                  </button>
                  <button
                    className="btn-delete"
                    onClick={() => setPendingDelete(p.name)}
                    aria-label={`Delete ${p.name}`}
                    disabled={!state.isEditor}
                    title={state.isEditor ? undefined : "Unlock to delete"}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-footer">
          <div className="modal-spacer" />
          <button onClick={close}>Close</button>
        </div>
      </ModalFrame>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete saved project?"
        message={
          pendingDelete
            ? `Remove "${pendingDelete}" for the entire team? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Keep"
        variant="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
      />
    </>
  );
}
