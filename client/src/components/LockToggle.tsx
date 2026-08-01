import { useRef, useState } from "react";
import { useAppState, useAppDispatch } from "../state/hooks";
import { login, logoutEditorSession } from "../core/auth/index";
import { ModalFrame } from "./ModalFrame";

export function LockToggle() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [showPwd, setShowPwd] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const loginAbortRef = useRef<AbortController | null>(null);

  const closePwd = () => {
    loginAbortRef.current?.abort();
    loginAbortRef.current = null;
    setSubmitting(false);
    setShowPwd(false);
    setError(null);
    setPassword("");
  };

  const handleLock = async () => {
    if (!await logoutEditorSession()) {
      setError("Could not end the editor session. Try again.");
      return;
    }
    dispatch({ type: "SET_AUTH", isEditor: false, isAdmin: false });
  };

  const handleUnlock = async () => {
    if (!password || submitting) return;
    const controller = new AbortController();
    loginAbortRef.current = controller;
    setSubmitting(true);
    setError(null);
    let result: { ok: boolean; role?: "admin" | "editor" };
    try {
      result = await login(password, controller.signal);
    } catch {
      result = { ok: false };
    }
    if (controller.signal.aborted || loginAbortRef.current !== controller) return;
    loginAbortRef.current = null;
    setSubmitting(false);
    if (result.ok) {
      dispatch({
        type: "SET_AUTH",
        isEditor: true,
        isAdmin: result.role === "admin",
      });
      closePwd();
    } else {
      setError("Incorrect password");
    }
  };

  if (state.isEditor) {
    const label = state.isAdmin ? "Admin" : "Editing";
    const title = state.isAdmin
      ? "Admin — click to lock (AI infer enabled)"
      : "Editing — click to lock";
    return (
      <button
        type="button"
        onClick={() => void handleLock()}
        aria-label="Switch to read-only mode"
        title={title}
      >
        {label}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowPwd(true)}
        aria-label="Unlock for editing"
        title="Read-only — click to unlock"
      >
        Read only
      </button>
      {showPwd && (
        <ModalFrame
          ariaLabelledBy="unlock-title"
          ariaDescribedBy="unlock-description"
          className="modal-sm"
          onClose={closePwd}
        >
          <form
            className="dialog-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void handleUnlock();
            }}
          >
            <h2 id="unlock-title">Unlock</h2>
            <p id="unlock-description" className="dialog-message">
              Editor password enables Save / Delete / DDL Import. Admin password additionally enables AI infer.
            </p>
            <label className="dialog-field">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
              />
            </label>
            {error && (
              <p
                className="dialog-message"
                role="alert"
                style={{ color: "var(--color-status-danger, #d32f2f)" }}
              >
                {error}
              </p>
            )}
            <div className="modal-footer">
              <div className="modal-spacer" />
              <button type="button" onClick={closePwd} disabled={submitting}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={!password || submitting}
              >
                {submitting ? "..." : "Unlock"}
              </button>
            </div>
          </form>
        </ModalFrame>
      )}
    </>
  );
}
