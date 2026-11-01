import type { BrowserDraft } from "../core/storage/draft";

function formatSavedAt(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return "an earlier session";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function DraftRestoreBanner({
  draft,
  onRestore,
  onDiscard,
}: {
  draft: BrowserDraft;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const tables = draft.schema.entities.length;
  return (
    <section className="draft-banner" aria-label="Unsaved draft">
      <p className="draft-banner-message">
        <strong>Unsaved changes found in this browser.</strong>{" "}
        “{draft.schema.name}” ({tables} {tables === 1 ? "table" : "tables"}), kept {formatSavedAt(draft.savedAt)}
        {draft.fromServerProject ? ". Restoring opens it as a new draft — use Save As to keep it on the server." : "."}
      </p>
      <div className="draft-banner-actions">
        <button type="button" onClick={onDiscard}>Discard</button>
        <button type="button" className="btn-primary" onClick={onRestore}>Restore draft</button>
      </div>
    </section>
  );
}
