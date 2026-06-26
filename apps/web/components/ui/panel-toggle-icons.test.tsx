import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  InsetFilledLeftHalfRectangle,
  InsetFilledRightThirdRectangle,
  PanelToggleIcon
} from "./panel-toggle-icons";

describe("panel-toggle-icons", () => {
  it("renders SF-style panel icons", () => {
    expect(renderToStaticMarkup(<InsetFilledLeftHalfRectangle />)).toContain("<svg");
    expect(renderToStaticMarkup(<InsetFilledRightThirdRectangle />)).toContain("<svg");
  });

  it("maps panel targets to icons", () => {
    expect(renderToStaticMarkup(<PanelToggleIcon panel="left" />)).toContain("<svg");
    expect(renderToStaticMarkup(<PanelToggleIcon panel="right" />)).toContain("<svg");
  });
});
