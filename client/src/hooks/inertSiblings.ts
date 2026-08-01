// 모달이 열려 있는 동안 배경 콘텐츠가 포커스/스크린리더에 노출되지 않도록
// 모달에서 body 까지 올라가며 각 조상 레벨의 형제들에 inert 를 건다.
// (ConfirmDialog 처럼 깊은 트리 안에서 렌더되는 모달도 메인 콘텐츠 전체를 격리하기 위함)
export function applyInertToSiblings(target: Element): () => void {
  const touched: Element[] = [];

  let node: Element = target;
  while (node.parentElement && node.parentElement.tagName !== "BODY") {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      touched.push(sibling);
    }
    node = node.parentElement;
  }

  // 직접 설정한 것만 복원 — 원래 inert 였던 형제는 건드리지 않는다
  return () => {
    for (const el of touched) el.removeAttribute("inert");
  };
}
