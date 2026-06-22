import type { VdtChangeSet, VdtProject, VdtWarning } from "@vdt-studio/vdt-core";
import { previewChangeSet, validateGraph, warning } from "@vdt-studio/vdt-core";
import type { AiModelWarning } from "../schemas/shared";

export function mapAiWarnings(items: AiModelWarning[]) {
  return items.map((item) =>
    warning({
      severity: item.severity,
      type: "weak_business_logic",
      message: item.message,
      nodeId: item.nodeId,
      edgeId: item.edgeId
    })
  );
}

export function validateChangeSetPreview(
  project: VdtProject,
  changeSet: VdtChangeSet
): { valid: boolean; warnings: VdtWarning[] } {
  const preview = previewChangeSet(project, changeSet);
  const validation = validateGraph(preview.graph, preview.rootNodeId);

  if (!validation.valid) {
    return {
      valid: false,
      warnings: [...validation.errors, ...validation.warnings]
    };
  }

  if (validation.warnings.length > 0) {
    return {
      valid: false,
      warnings: validation.warnings
    };
  }

  return { valid: true, warnings: [] };
}

export function assertChangeSetPreviewValid(project: VdtProject, changeSet: VdtChangeSet, label: string) {
  const graphValidation = validateChangeSetPreview(project, changeSet);
  if (!graphValidation.valid) {
    const messages = graphValidation.warnings.map((entry) => entry.message).join("; ");
    throw new Error(`${label} failed graph validation: ${messages}`);
  }
}

export function stripInvalidSuggestedChangeSet(
  project: VdtProject,
  draft: VdtChangeSet | undefined
): { changeSet?: VdtChangeSet; warnings: VdtWarning[] } {
  if (!draft) {
    return { warnings: [] };
  }

  const graphValidation = validateChangeSetPreview(project, draft);
  if (!graphValidation.valid) {
    return {
      warnings: [
        warning({
          severity: "warning",
          type: "weak_business_logic",
          message:
            "Suggested changes were stripped because they failed graph validation when previewed."
        }),
        ...graphValidation.warnings
      ]
    };
  }

  return { changeSet: draft, warnings: [] };
}

export function assertTextSectionLength(value: string, maxBytes: number, fieldName: string) {
  const byteLength = new TextEncoder().encode(value).length;
  if (byteLength > maxBytes) {
    throw new Error(`${fieldName} exceeds max section size (${byteLength} > ${maxBytes} bytes).`);
  }
}
