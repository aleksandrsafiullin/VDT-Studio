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
