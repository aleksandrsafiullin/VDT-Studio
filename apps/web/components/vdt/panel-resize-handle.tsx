"use client";

import { useCallback, useRef } from "react";
import { clsx } from "clsx";

/**
 * Drag resize supports pointer and mouse events. Keyboard panel sizing is out of scope.
 */
export function PanelResizeHandle({
  side,
  currentWidth,
  onResize,
  testId
}: {
  side: "left" | "right";
  currentWidth: number;
  onResize: (width: number) => void;
  testId: string;
}) {
  const startXRef = useRef(0);
  const startWidthRef = useRef(currentWidth);

  const beginDrag = useCallback(
    (clientX: number) => {
      startXRef.current = clientX;
      startWidthRef.current = currentWidth;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (moveEvent: MouseEvent | PointerEvent) => {
        const delta = moveEvent.clientX - startXRef.current;
        const nextWidth =
          side === "left" ? startWidthRef.current + delta : startWidthRef.current - delta;
        onResize(nextWidth);
      };

      const onUp = () => {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [currentWidth, onResize, side]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      beginDrag(event.clientX);
    },
    [beginDrag]
  );

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      beginDrag(event.clientX);
    },
    [beginDrag]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Resize setup panel" : "Resize inspector panel"}
      data-testid={testId}
      className={clsx(
        "hidden h-full min-h-0 w-full min-w-[6px] cursor-col-resize touch-none lg:block",
        "relative before:absolute before:inset-y-0 before:w-px before:bg-line",
        "before:left-1/2 before:-translate-x-1/2",
        "hover:before:bg-accent/40 active:before:bg-accent/60"
      )}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
    />
  );
}
