import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Tooltip } from "../Tooltip";

describe("Tooltip 접근성", () => {
  it("타겟이 aria-describedby로 툴팁 버블과 연결된다", () => {
    const html = renderToStaticMarkup(
      <Tooltip label="Save project">
        <button>save</button>
      </Tooltip>,
    );

    const bubbleId =
      html.match(/role="tooltip"[^>]*\bid="([^"]+)"/)?.[1] ??
      html.match(/\bid="([^"]+)"[^>]*role="tooltip"/)?.[1];
    expect(bubbleId, "툴팁 버블에 id가 없음").toBeTruthy();
    expect(html).toContain(`aria-describedby="${bubbleId}"`);
  });
});
