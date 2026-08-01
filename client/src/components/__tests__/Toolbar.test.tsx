import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppDispatchContext, AppStateContext } from "../../state/context";
import { createInitialState } from "../../state/reducer";
import { createEntity } from "../../core/model/factory";
import { Toolbar } from "../Toolbar";

function renderToolbar(overrides = {}): string {
  return renderToStaticMarkup(
    <AppStateContext.Provider value={{ ...createInitialState(), isEditor: true, ...overrides }}>
      <AppDispatchContext.Provider value={() => {}}>
        <Toolbar />
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>,
  );
}

describe("Toolbar accessibility", () => {
  it("exposes toggle state without marking ordinary action buttons as toggles", () => {
    const html = renderToolbar();

    expect(html).toMatch(/<button[^>]*aria-label="Inferred"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/<button[^>]*aria-label="1:N"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/<button[^>]*aria-label="Theme"[^>]*aria-pressed="false"/);
    expect(html).not.toMatch(/<button[^>]*aria-label="Add Entity"[^>]*aria-pressed=/);
  });

  it("offers sign out only when an OAuth session is present", () => {
    expect(renderToolbar({ authUserEmail: "user@example.com" })).toContain('aria-label="Sign Out"');
    expect(renderToolbar()).not.toContain('aria-label="Sign Out"');
  });

  it("does not offer another OAuth login when the signed-in account lacks AI access", () => {
    const initial = createInitialState();
    const html = renderToolbar({
      authUserEmail: "user@example.com",
      canUseAI: false,
      aiAccessStatus: "disabled",
      schema: {
        ...initial.schema,
        entities: [createEntity({ name: "users" }), createEntity({ name: "orders" })],
      },
    });

    expect(html).toMatch(/<button(?=[^>]*aria-label="AI Infer")(?=[^>]*disabled)[^>]*>/);
    expect(html).toContain("AI access is not enabled for this account");
  });

  it("requires Save As before a new draft can use Save", () => {
    const initial = createInitialState();
    const html = renderToolbar({
      persistence: {
        ...initial.persistence,
        serverReachable: true,
        hasPersistedProject: false,
      },
    });

    expect(html).toMatch(/<button(?=[^>]*aria-label="Save")(?=[^>]*disabled)[^>]*>/);
    expect(html).toContain("New drafts require Save As");
    expect(html).toMatch(/<button(?=[^>]*aria-label="Save As")(?![^>]*disabled)[^>]*>/);
  });
});
