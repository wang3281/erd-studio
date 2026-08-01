import { ModalFrame } from "./ModalFrame";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <ModalFrame
      ariaLabelledBy="confirm-dialog-title"
      ariaDescribedBy="confirm-dialog-description"
      className="modal-sm"
      onClose={onCancel}
    >
      <div className="dialog-stack">
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-description" className="dialog-message">{message}</p>
        <div className="modal-footer">
          <div className="modal-spacer" />
          <button onClick={onCancel}>{cancelLabel}</button>
          <button className={variant === "danger" ? "btn-danger" : "btn-primary"} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
