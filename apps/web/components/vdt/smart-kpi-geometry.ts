export interface SmartKpiRect { left: number; top: number; width: number; height: number }
export interface SmartKpiViewport { width: number; height: number; left?: number; top?: number }
export interface SmartKpiPlacement {
  left: number; top: number; width: number; maxHeight: number; side: "left" | "right";
  bridge: SmartKpiRect;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/** Screen pixels, after graph transforms. The portal never inherits graph zoom. */
export function placeSmartKpiPanel(anchor: SmartKpiRect, panelHeight: number, viewport: SmartKpiViewport): SmartKpiPlacement {
  const margin = 8, gap = 8, x = viewport.left ?? 0, y = viewport.top ?? 0;
  const width = Math.min(360, Math.max(1, viewport.width - margin * 2));
  const maxHeight = Math.max(1, viewport.height - margin * 2), height = Math.min(panelHeight, maxHeight);
  const right = anchor.left + anchor.width, side = right + gap + width <= x + viewport.width - margin ? "right" : "left";
  const left = clamp(side === "right" ? right + gap : anchor.left - gap - width, x + margin, x + viewport.width - width - margin);
  const top = clamp(anchor.top + anchor.height / 2 - height / 2, y + margin, y + viewport.height - height - margin);
  const bridgeLeft = side === "right" ? right : left + width;
  const bridgeRight = side === "right" ? left : anchor.left;
  return { left, top, width, maxHeight, side, bridge: {
    left: Math.min(bridgeLeft, bridgeRight), top: Math.max(y + margin, Math.min(anchor.top, top)),
    width: Math.max(0, bridgeRight - bridgeLeft),
    height: Math.max(1, Math.min(y + viewport.height - margin, Math.max(anchor.top + anchor.height, top + height)) - Math.max(y + margin, Math.min(anchor.top, top)))
  } };
}

export function smartKpiRectsIntersect(a: SmartKpiRect, b: SmartKpiRect): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

/** Transient graph-space preview. Never moves or inserts project nodes. */
export function placeSmartKpiPreview(target: SmartKpiRect, size: { width: number; height: number }, obstacles: readonly SmartKpiRect[]): SmartKpiRect {
  const initial = { left: target.left + target.width + 112, top: target.top + target.height / 2 - size.height / 2, ...size };
  // Prefer the nearest free space in the next factor column. A bounded search
  // keeps an already populated tree from being covered by the draft cards.
  const candidates: SmartKpiRect[] = [];
  for (let column = 0; column < 4; column++) {
    const left = initial.left + column * (size.width + 64);
    const tops = [initial.top, ...obstacles.flatMap(rect => [rect.top + rect.height + 24, rect.top - size.height - 24])];
    for (const top of tops) {
      const candidate = { ...initial, left, top };
      if (obstacles.every(rect => !smartKpiRectsIntersect(candidate, { left: rect.left - 16, top: rect.top - 16, width: rect.width + 32, height: rect.height + 32 }))) candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => Math.hypot(a.left - initial.left, a.top - initial.top) - Math.hypot(b.left - initial.left, b.top - initial.top));
  return candidates[0] ?? { ...initial, left: Math.max(initial.left, ...obstacles.map(rect => rect.left + rect.width + 64)) };
}

/** One canvas-level pass at viewport end/resize; no per-card preparation effect. */
export function visibleSmartKpiTargets(nodes: readonly { id: string; x: number; y: number; width: number; height: number }[],
  transform: { x: number; y: number; zoom: number }, canvas: { width: number; height: number }, selected?: string): string[] {
  const bounds = { left: 0, top: 0, width: canvas.width, height: canvas.height };
  return nodes.map(node => ({ id: node.id, rect: { left: transform.x + node.x * transform.zoom, top: transform.y + node.y * transform.zoom,
    width: node.width * transform.zoom, height: node.height * transform.zoom } }))
    .filter(node => node.id !== selected && smartKpiRectsIntersect(node.rect, bounds))
    .sort((a, b) => Math.hypot(a.rect.left + a.rect.width / 2 - canvas.width / 2, a.rect.top + a.rect.height / 2 - canvas.height / 2) -
      Math.hypot(b.rect.left + b.rect.width / 2 - canvas.width / 2, b.rect.top + b.rect.height / 2 - canvas.height / 2) || a.id.localeCompare(b.id))
    .slice(0, 6).map(node => node.id);
}
