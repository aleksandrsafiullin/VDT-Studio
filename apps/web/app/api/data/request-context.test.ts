import { describe, expect, it } from "vitest";
import { dataApiErrorResponse } from "./request-context";
import { DataApiError } from "./store";

const privateMessage = "quota out of usage /private/synthetic/session secret-token";

describe("data provider error responses", () => {
  it("returns static actionable HTTP429 for the exact RATE_LIMITED code without raw diagnostics", async () => {
    const response = dataApiErrorResponse(Object.assign(new Error(privateMessage), { code: "RATE_LIMITED" }));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, error: { code: "RATE_LIMITED", message: "The selected AI model or account has reached its usage limit. Choose another available model, or try again when access is available." } });
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(JSON.stringify(body)).not.toContain("/private/");
  });

  it("keeps unknown-coded and uncoded quota text generic instead of guessing from messages", async () => {
    for (const error of [
      Object.assign(new Error(privateMessage), { code: "UNKNOWN_PROVIDER_ERROR" }),
      Object.assign(new Error(privateMessage), { code: "rate_limited" }),
      Object.assign(new Error(privateMessage), { name: "ActionRequiredError" }),
      { code: "RATE_LIMITED", message: privateMessage }
    ]) {
      const response = dataApiErrorResponse(error);
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: "DATA_OPERATION_FAILED", message: "The data operation could not be completed." } });
    }
  });

  it("preserves typed data and malformed-request error handling", async () => {
    const missing = dataApiErrorResponse(new DataApiError("Source not found.", 404, "DATASET_NOT_FOUND"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "DATASET_NOT_FOUND" } });
    for (const error of [new TypeError("Invalid input."), new SyntaxError("Invalid JSON.")]) {
      Object.assign(error, { code: "RATE_LIMITED" });
      expect(dataApiErrorResponse(error).status).toBe(400);
    }
  });
});
