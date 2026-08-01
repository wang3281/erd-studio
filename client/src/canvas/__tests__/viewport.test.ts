import { describe, it, expect } from "vitest";
import {
  screenToWorld,
  worldToScreen,
  clampZoom,
  createViewportCenteredOn,
  createViewportToFit,
  getBounds,
  type Viewport,
} from "../viewport";

describe("viewport", () => {
  const identity: Viewport = { offsetX: 0, offsetY: 0, zoom: 1 };

  it("zoom=1, offset=0 → 동일 좌표", () => {
    expect(screenToWorld(identity, 100, 200)).toEqual({ x: 100, y: 200 });
    expect(worldToScreen(identity, 100, 200)).toEqual({ x: 100, y: 200 });
  });

  it("offset 적용", () => {
    const vp: Viewport = { offsetX: 50, offsetY: 30, zoom: 1 };
    expect(screenToWorld(vp, 100, 100)).toEqual({ x: 50, y: 70 });
  });

  it("zoom 적용", () => {
    const vp: Viewport = { offsetX: 0, offsetY: 0, zoom: 2 };
    expect(screenToWorld(vp, 200, 100)).toEqual({ x: 100, y: 50 });
  });

  it("왕복 변환 (screen→world→screen)", () => {
    const vp: Viewport = { offsetX: 120, offsetY: -30, zoom: 1.5 };
    const world = screenToWorld(vp, 300, 400);
    const screen = worldToScreen(vp, world.x, world.y);
    expect(Math.round(screen.x)).toBe(300);
    expect(Math.round(screen.y)).toBe(400);
  });

  it("clampZoom 범위 제한", () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(5)).toBe(3);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("bounds 계산", () => {
    const bounds = getBounds([
      { position: { x: 100, y: 200 }, width: 300, height: 120 },
      { position: { x: -50, y: 80 }, width: 100, height: 60 },
    ]);
    expect(bounds).toEqual({ minX: -50, minY: 80, maxX: 400, maxY: 320 });
  });

  it("엔티티 전체가 캔버스 안에 들어오도록 viewport를 계산", () => {
    const vp = createViewportToFit(
      [
        { position: { x: 100, y: 100 }, width: 300, height: 200 },
        { position: { x: 500, y: 450 }, width: 200, height: 100 },
      ],
      1000,
      800,
      40,
    );

    const topLeft = worldToScreen(vp, 100, 100);
    const bottomRight = worldToScreen(vp, 700, 550);
    expect(topLeft.x).toBeGreaterThanOrEqual(39.9);
    expect(topLeft.y).toBeGreaterThanOrEqual(39.9);
    expect(bottomRight.x).toBeLessThanOrEqual(960.1);
    expect(bottomRight.y).toBeLessThanOrEqual(760.1);
  });

  it("검색한 엔티티를 중앙에 두고 최소 75% 줌을 보장한다", () => {
    const entity = { position: { x: 400, y: 300 }, width: 240, height: 180 };
    const vp = createViewportCenteredOn(entity, 1000, 800, 0.25);
    const center = worldToScreen(vp, 520, 390);

    expect(vp.zoom).toBe(0.75);
    expect(center).toEqual({ x: 500, y: 400 });
  });

  it("검색 이동 시 현재 줌이 75%보다 크면 그대로 유지한다", () => {
    const vp = createViewportCenteredOn(
      { position: { x: 0, y: 0 }, width: 100, height: 100 },
      600,
      400,
      1.4,
    );

    expect(vp.zoom).toBe(1.4);
  });
});
