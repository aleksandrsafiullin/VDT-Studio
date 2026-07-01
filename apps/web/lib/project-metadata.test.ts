import { describe, expect, it } from "vitest";
import {
  projectCardDetailLines,
  projectCardDetailRows,
  projectCardMetadata,
  projectMetadataText
} from "./project-metadata";

describe("project-metadata", () => {
  it("reads string and numeric metadata values", () => {
    expect(projectMetadataText({ clientName: "Acme", year: 2026 }, "clientName")).toBe("Acme");
    expect(projectMetadataText({ clientName: "Acme", year: 2026 }, "year")).toBe("2026");
    expect(projectMetadataText(undefined, "clientName")).toBe("");
  });

  it("builds card metadata fields", () => {
    expect(
      projectCardMetadata({
        clientName: "North Mining Co",
        siteName: "Pilbara",
        year: "2026"
      })
    ).toEqual({
      clientName: "North Mining Co",
      siteName: "Pilbara",
      year: "2026"
    });
  });

  it("builds fixed card detail rows with Site label", () => {
    expect(
      projectCardDetailRows({
        clientName: "North Mining Co",
        siteName: "Pilbara",
        year: "2026"
      })
    ).toEqual([
      { key: "clientName", label: "Client", value: "North Mining Co" },
      { key: "siteName", label: "Site", value: "Pilbara" },
      { key: "year", label: "Year", value: "2026" }
    ]);
  });

  it("keeps three detail rows when metadata is missing", () => {
    expect(projectCardDetailRows(undefined)).toEqual([
      { key: "clientName", label: "Client", value: "" },
      { key: "siteName", label: "Site", value: "" },
      { key: "year", label: "Year", value: "" }
    ]);
    expect(projectCardDetailLines({ clientName: "   " })).toEqual([]);
  });
});
