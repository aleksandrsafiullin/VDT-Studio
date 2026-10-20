import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SmartKpiPreparationNotice } from "./smart-kpi-panel";

it("keeps the specific empty explanation escaped and places its limits in Details", () => {
  const html = renderToStaticMarkup(<SmartKpiPreparationNotice reason={'No supported split: <script>alert("reason")</script>'}
    limitations={['Only measured speed is available.', '<img src=x onerror="alert(1)">']} />);
  expect(html).toContain('role="status"'); expect(html).toContain("No supported split:"); expect(html).toContain("Only measured speed is available.");
  expect(html).toContain("<details"); expect(html).toContain(">Details</summary>");
  expect(html).toContain("&lt;script&gt;"); expect(html).toContain("&lt;img"); expect(html).not.toContain("<script>"); expect(html).not.toContain("<img");
});
