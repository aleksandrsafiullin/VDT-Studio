export { changeSnapshotName, readableFormula, versionDisplayName, versionNodeChanges } from "@vdt-studio/vdt-core";

export function formatVersionDate(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? createdAt : new Intl.DateTimeFormat("en", {
    dateStyle: "medium", timeStyle: "short"
  }).format(date);
}
