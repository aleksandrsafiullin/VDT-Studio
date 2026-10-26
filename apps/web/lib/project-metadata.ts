import type { StoredProjectRecord } from "./vdt-storage-client";

export const PROJECT_DETAIL_LABELS = {
  clientName: "Client",
  siteName: "Site",
  year: "Year"
} as const;

export function projectMetadataText(
  metadata: Record<string, unknown> | undefined,
  key: string
): string {
  const value = metadata?.[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export interface ProjectCardMetadata {
  clientName: string;
  siteName: string;
  year: string;
}

function searchableValues(value: unknown): string[] {
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(searchableValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(searchableValues);
  return [];
}

export function projectMatchesSearch(
  project: Pick<StoredProjectRecord, "name" | "description" | "industry" | "metadata">,
  query: string
): boolean {
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = normalize(searchableValues([project.name, project.description, project.industry, project.metadata]).join(" "));
  return terms.every((term) => text.includes(term));
}

export interface ProjectCardDetailRow {
  key: keyof ProjectCardMetadata;
  label: string;
  value: string;
}

export function projectCardMetadata(
  metadata: Record<string, unknown> | undefined
): ProjectCardMetadata {
  return {
    clientName: projectMetadataText(metadata, "clientName"),
    siteName: projectMetadataText(metadata, "siteName"),
    year: projectMetadataText(metadata, "year")
  };
}

export function projectCardDetailRows(
  metadata: Record<string, unknown> | undefined
): ProjectCardDetailRow[] {
  const details = projectCardMetadata(metadata);
  return (Object.keys(PROJECT_DETAIL_LABELS) as Array<keyof ProjectCardMetadata>).map((key) => ({
    key,
    label: PROJECT_DETAIL_LABELS[key],
    value: details[key]
  }));
}

/** @deprecated Use projectCardDetailRows for fixed-height card layouts. */
export function projectCardDetailLines(metadata: Record<string, unknown> | undefined): string[] {
  return projectCardDetailRows(metadata)
    .filter((row) => row.value.length > 0)
    .map((row) => `${row.label}: ${row.value}`);
}
