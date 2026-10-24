"use client";

import { Controls, Panel } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { SquareGrid2x2 } from "./canvas-toolbar-icons";
import { KpiSpacingPopover } from "./kpi-spacing-popover";
import styles from "./workspace-shell.module.css";

const inlineControlsStyle = { position: "static", margin: 0 } as const;
export const CANVAS_ARIA_LABEL_CONFIG = {
  "controls.interactive.ariaLabel": "Lock or unlock nodes"
};

export function CanvasControls({ onAutoDistribute }: { onAutoDistribute: () => void }) {
  return (
    <Panel
      position="top-left"
      className={styles.canvasToolbar}
      role="toolbar"
      aria-label="Canvas controls"
      data-testid="canvas-controls"
    >
      <Controls
        orientation="horizontal"
        showInteractive={false}
        style={inlineControlsStyle}
        aria-label="Canvas view controls"
      />
      <div className={styles.canvasLayoutGroup} role="group" aria-label="Canvas layout tools">
        <Button
          size="sm"
          className={styles.canvasAction}
          data-testid="auto-distribute-layout"
          aria-label="Auto-distribute"
          title="Auto-distribute"
          icon={<SquareGrid2x2 />}
          onClick={onAutoDistribute}
        >
          <span className={styles.canvasActionLabel}>Auto-distribute</span>
        </Button>
        <KpiSpacingPopover />
      </div>
      <Controls
        orientation="horizontal"
        showZoom={false}
        showFitView={false}
        className={styles.canvasLockGroup ?? ""}
        style={inlineControlsStyle}
        aria-label="Canvas node interaction"
      />
    </Panel>
  );
}
