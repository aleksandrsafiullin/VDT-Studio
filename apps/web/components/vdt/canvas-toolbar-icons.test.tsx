import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArrowDownBackwardAndArrowUpForwardSquare,
  CANVAS_TOOLBAR_ICON_CLASS,
  SquareGrid2x2
} from "./canvas-toolbar-icons";

describe("canvas-toolbar-icons", () => {
  it("renders exported SF Symbol paths", () => {
    const gridHtml = renderToStaticMarkup(<SquareGrid2x2 className={CANVAS_TOOLBAR_ICON_CLASS} />);
    const spacingHtml = renderToStaticMarkup(
      <ArrowDownBackwardAndArrowUpForwardSquare className={CANVAS_TOOLBAR_ICON_CLASS} />
    );

    expect(gridHtml).toContain('viewBox="0 0 128 128"');
    expect(gridHtml).toContain('fill="currentColor"');
    expect(gridHtml.match(/<path/g)?.length).toBe(4);

    expect(spacingHtml).toContain('viewBox="0 0 128 128"');
    expect(spacingHtml).toContain('fill="currentColor"');
    expect(spacingHtml.match(/<path/g)?.length).toBe(2);
  });
});
