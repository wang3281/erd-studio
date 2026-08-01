import { ModalFrame } from "./ModalFrame";

interface ShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  ["Save", "Cmd/Ctrl + S"],
  ["Save As", "Cmd/Ctrl + Shift + S"],
  ["Open projects", "Cmd/Ctrl + O"],
  ["Undo", "Cmd/Ctrl + Z"],
  ["Redo", "Cmd/Ctrl + Shift + Z"],
  ["Help", "?"],
  ["Close dialog", "Esc"],
];

export function ShortcutsPanel({ open, onClose }: ShortcutsPanelProps) {
  if (!open) return null;

  return (
    <ModalFrame
      ariaLabelledBy="shortcuts-title"
      ariaDescribedBy="shortcuts-description"
      className="shortcuts-modal modal-sm"
      onClose={onClose}
    >
      <div className="dialog-stack">
        <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
        <p id="shortcuts-description" className="dialog-message">
          Keep the canvas moving without reaching for the pointer.
        </p>

        <div className="shortcuts-table" role="table" aria-label="Keyboard shortcuts">
          {SHORTCUTS.map(([label, key]) => (
            <div key={label} className="shortcuts-row" role="row">
              <span role="cell">{label}</span>
              <kbd role="cell">{key}</kbd>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <div className="modal-spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </ModalFrame>
  );
}
