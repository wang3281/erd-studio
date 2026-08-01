// React 19는 JSX onWheel을 루트 위임 passive 리스너로 등록하므로 preventDefault가 무시된다.
// 캔버스 줌/팬이 브라우저 페이지 줌/스크롤을 막으려면 passive:false 네이티브 리스너가 필요하다.
export function attachNonPassiveWheelListener(
  target: HTMLElement,
  handler: (event: WheelEvent) => void,
): () => void {
  target.addEventListener("wheel", handler, { passive: false });
  return () => target.removeEventListener("wheel", handler);
}

export function shouldRecordDragMove(
  historyRecorded: boolean,
  historyStartDepth: number,
  currentHistoryDepth: number,
): boolean {
  return !historyRecorded || currentHistoryDepth <= historyStartDepth;
}
