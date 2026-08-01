import { ModalFrame } from "./ModalFrame";

interface WelcomeOverlayProps {
  onClose: () => void;
}

const HIGHLIGHTS = [
  {
    title: "Build visually",
    body: "Create tables, columns, and relationships directly on the canvas.",
  },
  {
    title: "Start from SQL",
    body: "Paste CREATE TABLE statements and generate a draft ERD in one step.",
  },
  {
    title: "Review faster",
    body: "Use shortcuts, auto layout, and guided states to keep the diagram readable.",
  },
];

export function WelcomeOverlay({ onClose }: WelcomeOverlayProps) {
  return (
    <ModalFrame
      ariaLabelledBy="welcome-title"
      ariaDescribedBy="welcome-description"
      className="welcome-modal"
      onClose={onClose}
    >
      <div className="welcome-stack">
        <p className="eyebrow">ERD Workspace</p>
        <h2 id="welcome-title">Map your schema before it turns into review debt.</h2>
        <p id="welcome-description" className="welcome-description">
          Start with a blank canvas, import SQL, or reopen a saved draft. Press <kbd>?</kbd> any
          time to see shortcuts.
        </p>

        <div className="welcome-grid">
          {HIGHLIGHTS.map((item) => (
            <section key={item.title} className="welcome-card">
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </section>
          ))}
        </div>

        <div className="modal-footer">
          <div className="modal-spacer" />
          <button className="btn-primary" onClick={onClose}>Get Started</button>
        </div>
      </div>
    </ModalFrame>
  );
}
