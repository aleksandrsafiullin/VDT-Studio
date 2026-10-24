"use client";

import { Paperclip } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { useVdtStudioStore } from "@/components/vdt/vdt-store";
import { requestIncomingKpisFromFile } from "./import-context";

export function DataImportAttachmentButton({
  className,
  label,
  onAttach
}: {
  className?: string;
  label?: string;
  onAttach?: () => void;
} = {}) {
  const targetNodeId = useVdtStudioStore((state) => state.selectedNodeId ?? state.project.rootNodeId);
  return (
    <Button
      type="button"
      className={clsx("shrink-0", !label && "h-9 w-9", className)}
      size={label ? "md" : "icon"}
      variant="secondary"
      icon={<Paperclip className="h-4 w-4" />}
      aria-label="Attach data file to create incoming KPIs"
      aria-haspopup="dialog"
      title="Create incoming KPIs from a file or saved project source"
      data-testid="data-import-attachment-button"
      onClick={() => {
        onAttach?.();
        requestIncomingKpisFromFile(targetNodeId, "agent_composer_attachment");
      }}
    >
      {label}
    </Button>
  );
}
