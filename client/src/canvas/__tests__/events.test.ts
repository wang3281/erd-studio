import { describe, it, expect, vi } from "vitest";
import { attachNonPassiveWheelListener, shouldRecordDragMove } from "../events";

// React 19의 JSX onWheel은 passive 리스너로 위임되어 preventDefault가 무시된다.
// 캔버스 줌/팬은 페이지 줌/스크롤을 막아야 하므로 반드시 passive:false 네이티브 등록이어야 한다.
describe("attachNonPassiveWheelListener", () => {
  function createFakeTarget() {
    return {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  }

  it("wheel 리스너를 passive:false 옵션으로 등록한다", () => {
    const target = createFakeTarget();
    const handler = vi.fn();

    attachNonPassiveWheelListener(target as unknown as HTMLElement, handler);

    expect(target.addEventListener).toHaveBeenCalledWith("wheel", handler, { passive: false });
  });

  it("반환된 detach 함수가 동일 핸들러를 해제한다", () => {
    const target = createFakeTarget();
    const handler = vi.fn();

    const detach = attachNonPassiveWheelListener(target as unknown as HTMLElement, handler);
    detach();

    expect(target.removeEventListener).toHaveBeenCalledWith("wheel", handler);
  });
});

describe("shouldRecordDragMove", () => {
  it("starts a new history entry when undo returns to the drag start depth", () => {
    expect(shouldRecordDragMove(true, 3, 3)).toBe(true);
    expect(shouldRecordDragMove(true, 3, 4)).toBe(false);
    expect(shouldRecordDragMove(false, 3, 3)).toBe(true);
  });
});
