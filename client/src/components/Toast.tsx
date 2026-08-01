export type ToastTone = "success" | "info" | "warning" | "danger";

interface ToastProps {
  tone: ToastTone;
  message: string;
  onDismiss: () => void;
}

export function Toast({ tone, message, onDismiss }: ToastProps) {
  const role = tone === "danger" ? "alert" : "status";

  return (
    <div className={`toast toast-${tone}`} role={role} aria-live="polite">
      <span>{message}</span>
      <button className="toast-dismiss" onClick={onDismiss} aria-label="Dismiss notification">
        Dismiss
      </button>
    </div>
  );
}
