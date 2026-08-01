import { describe, it, expect } from "vitest";
import { applyInertToSiblings } from "../inertSiblings";

// jsdom 없이 헬퍼의 형제 순회/복원 로직을 검증하기 위한 최소 fake Element
interface FakeElement {
  attrs: Set<string>;
  tagName: string;
  children: FakeElement[];
  parentElement: FakeElement | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

function fakeEl(tagName = "DIV", attrs: string[] = []): FakeElement {
  const set = new Set(attrs);
  return {
    attrs: set,
    tagName,
    children: [],
    parentElement: null,
    hasAttribute: (name) => set.has(name),
    setAttribute: (name) => { set.add(name); },
    removeAttribute: (name) => { set.delete(name); },
  };
}

/** parent.children 연결 + 자식들의 parentElement 설정 */
function link(parent: FakeElement, children: FakeElement[]): FakeElement {
  parent.children = children;
  for (const child of children) child.parentElement = parent;
  return parent;
}

function asElement(el: FakeElement): Element {
  return el as unknown as Element;
}

describe("applyInertToSiblings", () => {
  it("모달 외 형제들에 inert를 설정하고 자기 자신은 제외한다", () => {
    const appContent = fakeEl();
    const toolbar = fakeEl();
    const overlay = fakeEl();
    link(fakeEl(), [appContent, toolbar, overlay]);

    applyInertToSiblings(asElement(overlay));

    expect(appContent.attrs.has("inert")).toBe(true);
    expect(toolbar.attrs.has("inert")).toBe(true);
    expect(overlay.attrs.has("inert")).toBe(false);
  });

  it("restore는 직접 설정한 inert만 제거하고 원래 inert였던 형제는 유지한다", () => {
    const appContent = fakeEl();
    const alreadyInert = fakeEl("DIV", ["inert"]);
    const overlay = fakeEl();
    link(fakeEl(), [appContent, alreadyInert, overlay]);

    const restore = applyInertToSiblings(asElement(overlay));
    restore();

    expect(appContent.attrs.has("inert")).toBe(false);
    expect(alreadyInert.attrs.has("inert")).toBe(true);
  });

  it("부모가 없으면 아무것도 하지 않는다", () => {
    const orphan = fakeEl();
    expect(() => applyInertToSiblings(asElement(orphan))()).not.toThrow();
  });

  it("깊이 중첩된 모달도 조상 각 레벨의 형제들을 inert 처리한다 (ConfirmDialog in CanvasView)", () => {
    // 구조: BODY > root > app > [toolbar, mainArea > [propertyPanel, canvasContainer > [canvas, overlay]]]
    const overlay = fakeEl();
    const canvas = fakeEl();
    const canvasContainer = link(fakeEl(), [canvas, overlay]);
    const propertyPanel = fakeEl();
    const mainArea = link(fakeEl(), [propertyPanel, canvasContainer]);
    const toolbar = fakeEl();
    const app = link(fakeEl(), [toolbar, mainArea]);
    const root = link(fakeEl(), [app]);
    const body = link(fakeEl("BODY"), [root]);
    expect(body.tagName).toBe("BODY");

    const restore = applyInertToSiblings(asElement(overlay));

    // 모달 체인(overlay→canvasContainer→mainArea→app→root)은 inert 금지, 각 레벨 형제는 inert
    expect(canvas.attrs.has("inert")).toBe(true);
    expect(propertyPanel.attrs.has("inert")).toBe(true);
    expect(toolbar.attrs.has("inert")).toBe(true);
    expect(overlay.attrs.has("inert")).toBe(false);
    expect(mainArea.attrs.has("inert")).toBe(false);
    expect(app.attrs.has("inert")).toBe(false);

    restore();
    expect(canvas.attrs.has("inert")).toBe(false);
    expect(propertyPanel.attrs.has("inert")).toBe(false);
    expect(toolbar.attrs.has("inert")).toBe(false);
  });
});
