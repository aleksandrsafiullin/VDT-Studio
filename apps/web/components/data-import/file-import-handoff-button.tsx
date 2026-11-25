"use client";

import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVdtStudioStore } from "@/components/vdt/vdt-store";
import { requestIncomingKpisFromFile } from "./import-context";

export function FileImportHandoffButton({ nodeId }: { nodeId?: string | undefined }) {
  const target = useVdtStudioStore((state) => {
    const targetId = nodeId ?? state.selectedNodeId ?? state.project.rootNodeId;
    return state.project.graph.nodes.find((node) => node.id === targetId);
  });

  if (!target) return <p className="text-xs text-muted">The target KPI is no longer available.</p>;

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      icon={<Paperclip className="h-4 w-4" />}
      aria-haspopup="dialog"
      data-testid="agent-file-import-handoff"
      onClick={() => requestIncomingKpisFromFile(target.id, "agent_composer_attachment")}
    >
      Choose source for {target.name}
    </Button>
  );
}
