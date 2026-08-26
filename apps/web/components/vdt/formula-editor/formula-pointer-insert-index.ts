export type FormulaTokenRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type IndexedTokenRect = FormulaTokenRect & { index: number };

const FORMULA_INSERT_SLOT_PREFIX = "formula-insert-slot-";

export function formulaInsertSlotId(index: number): string {
  return `${FORMULA_INSERT_SLOT_PREFIX}${index}`;
}

export function parseFormulaInsertSlotIndex(id: string): number | null {
  if (!id.startsWith(FORMULA_INSERT_SLOT_PREFIX)) {
    return null;
  }

  const suffix = id.slice(FORMULA_INSERT_SLOT_PREFIX.length);
  if (!/^\d+$/.test(suffix)) {
    return null;
  }

  return Number.parseInt(suffix, 10);
}

export function resolveInsertIndexFromPointer(
  clientX: number,
  clientY: number,
  rects: FormulaTokenRect[]
): number {
  if (rects.length === 0) {
    return 0;
  }

  const indexedRects = rects.map((rect, index) => ({ ...rect, index }));
  const rows = groupRectsIntoRows(indexedRects);

  const top = Math.min(...indexedRects.map((rect) => rect.y));
  const bottom = Math.max(...indexedRects.map((rect) => rect.y + rect.height));

  if (clientY < top) {
    return 0;
  }

  if (clientY > bottom) {
    return rects.length;
  }

  const row = findRowForPointer(clientY, rows);
  return findInsertIndexInRow(clientX, row);
}

function groupRectsIntoRows(rects: IndexedTokenRect[]): IndexedTokenRect[][] {
  const minHeight = Math.min(...rects.map((rect) => rect.height));
  const yTolerance = minHeight * 0.5;

  const rows: IndexedTokenRect[][] = [];

  for (const rect of rects) {
    const rectCenterY = rect.y + rect.height / 2;
    let placed = false;

    for (const row of rows) {
      const rowCenterY =
        row.reduce((sum, token) => sum + token.y + token.height / 2, 0) / row.length;

      if (Math.abs(rectCenterY - rowCenterY) <= yTolerance) {
        row.push(rect);
        placed = true;
        break;
      }
    }

    if (!placed) {
      rows.push([rect]);
    }
  }

  rows.sort((left, right) => Math.min(...left.map((rect) => rect.y)) - Math.min(...right.map((rect) => rect.y)));

  for (const row of rows) {
    row.sort((left, right) => left.x - right.x);
  }

  return rows;
}

function findRowForPointer(clientY: number, rows: IndexedTokenRect[][]): IndexedTokenRect[] {
  const rowBands = rows.map((row) => {
    const top = Math.min(...row.map((rect) => rect.y));
    const bottom = Math.max(...row.map((rect) => rect.y + rect.height));

    return {
      row,
      top,
      bottom,
      center: (top + bottom) / 2
    };
  });

  for (const band of rowBands) {
    if (clientY >= band.top && clientY <= band.bottom) {
      return band.row;
    }
  }

  let nearestBand = rowBands[0]!;
  let nearestDistance = Math.abs(clientY - nearestBand.center);

  for (const band of rowBands.slice(1)) {
    const distance = Math.abs(clientY - band.center);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestBand = band;
    }
  }

  return nearestBand.row;
}

function findInsertIndexInRow(clientX: number, row: IndexedTokenRect[]): number {
  for (const rect of row) {
    const midpoint = rect.x + rect.width / 2;
    if (clientX < midpoint) {
      return rect.index;
    }
  }

  const lastRect = row[row.length - 1];
  if (!lastRect) {
    return 0;
  }

  return lastRect.index + 1;
}
