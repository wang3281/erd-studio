import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftRestoreBanner } from "../DraftRestoreBanner";
import { createSchema } from "../../core/model/factory";
import type { BrowserDraft } from "../../core/storage/draft";

function render(draft: Partial<BrowserDraft> = {}) {
  return renderToStaticMarkup(
    <DraftRestoreBanner
      draft={{
        schema: { ...createSchema({ name: "shop" }) },
        savedAt: "2026-11-01T13:00:00.000Z",
        fromServerProject: false,
        ...draft,
      }}
      onRestore={() => {}}
      onDiscard={() => {}}
    />,
  );
}

describe("DraftRestoreBanner", () => {
  it("is a labelled region offering restore and discard", () => {
    const html = render();
    expect(html).toContain('aria-label="Unsaved draft"');
    expect(html).toContain("“shop” (0 tables)");
    expect(html).toContain(">Restore draft</button>");
    expect(html).toContain(">Discard</button>");
    expect(html).not.toContain("Save As");
  });

  it("explains that a server-based draft must be saved with Save As", () => {
    expect(render({ fromServerProject: true })).toContain("use Save As to keep it on the server");
  });

  it("falls back gracefully for an unreadable timestamp", () => {
    expect(render({ savedAt: "garbage" })).toContain("kept an earlier session");
  });
});
