import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppStateContext, AppDispatchContext } from "../../state/context";
import { createInitialState } from "../../state/reducer";
import { CanvasView } from "../CanvasView";
import { createColumn, createEntity } from "../../core/model/factory";

function renderEmptyCanvas(isEditor: boolean): string {
  const state = { ...createInitialState(), isEditor };
  return renderToStaticMarkup(
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={() => {}}>
        <CanvasView />
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>,
  );
}

describe("CanvasView 빈 상태 버튼 권한", () => {
  it("읽기전용 모드에서는 편집 액션 버튼(Add Entity/Import DDL)이 비활성화된다", () => {
    const html = renderEmptyCanvas(false);

    expect(html).toMatch(/<button[^>]*\bdisabled[^>]*>Add Entity<\/button>/);
    expect(html).toMatch(/<button[^>]*\bdisabled[^>]*>Import DDL<\/button>/);
    // 서버 연결이 확인되기 전에는 프로젝트 목록 요청을 보내지 않는다.
    expect(html).toMatch(/<button[^>]*\bdisabled[^>]*>Open Project<\/button>/);
  });

  it("편집 모드에서는 모든 빈 상태 버튼이 활성화된다", () => {
    const html = renderEmptyCanvas(true);

    expect(html).not.toMatch(/<button[^>]*\bdisabled[^>]*>Add Entity<\/button>/);
    expect(html).not.toMatch(/<button[^>]*\bdisabled[^>]*>Import DDL<\/button>/);
  });

  it("exposes a read-only schema outline without hundreds of hidden buttons", () => {
    const state = createInitialState();
    const entity = createEntity({ name: "users", columns: [createColumn({ name: "email", type: "TEXT" })] });
    const html = renderToStaticMarkup(
      <AppStateContext.Provider value={{ ...state, schema: { ...state.schema, entities: [entity] } }}>
        <AppDispatchContext.Provider value={() => {}}>
          <CanvasView />
        </AppDispatchContext.Provider>
      </AppStateContext.Provider>,
    );

    expect(html).toContain('aria-label="ER diagram schema contents"');
    expect(html).toContain("Table users");
    expect(html).toContain("Column users.email, TEXT");
    expect(html).toMatch(/<canvas[^>]*tabindex="0"/);
    expect(html).not.toContain('tabindex="-1"');
    expect(html).not.toMatch(/<button[^>]*>Table users<\/button>/);
  });
});
