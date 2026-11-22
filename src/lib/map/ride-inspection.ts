import type { ScreenPoint } from './route-data.js';

export interface RouteHit {
  order: number;
  edge: number;
  fraction: number;
}

export interface ScreenRect extends ScreenPoint {
  width: number;
  height: number;
}

function visibleFractions(a: ScreenPoint, b: ScreenPoint, viewport: Pick<ScreenRect, 'width' | 'height'>) {
  let first = 0;
  let last = 1;
  for (const [start, end, limit] of [[a.x, b.x, viewport.width], [a.y, b.y, viewport.height]]) {
    const delta = end - start;
    if (delta === 0) {
      if (start < 0 || start > limit) return undefined;
      continue;
    }
    const leading = -start / delta;
    const trailing = (limit - start) / delta;
    first = Math.max(first, Math.min(leading, trailing));
    last = Math.min(last, Math.max(leading, trailing));
    if (first > last) return undefined;
  }
  return { first, last };
}

export function nearestRouteHit(
  point: ScreenPoint,
  orders: Iterable<number>,
  screenPath: (order: number) => ScreenPoint[],
  radius: number,
  viewport?: Pick<ScreenRect, 'width' | 'height'>
): RouteHit | undefined {
  let best: RouteHit | undefined;
  let closest = radius ** 2;
  for (const order of orders) {
    const screen = screenPath(order);
    for (let edge = 0; edge < screen.length - 1; edge++) {
      const a = screen[edge];
      const b = screen[edge + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      const fractionOnLine = length === 0 ? 0 : ((point.x - a.x) * dx + (point.y - a.y) * dy) / length;
      const bounds = viewport ? visibleFractions(a, b, viewport) : undefined;
      if (viewport && !bounds) continue;
      const fraction = Math.max(bounds?.first ?? 0, Math.min(bounds?.last ?? 1, fractionOnLine));
      const squared = (point.x - a.x - fraction * dx) ** 2 + (point.y - a.y - fraction * dy) ** 2;
      if (squared < closest) {
        closest = squared;
        best = { order, edge, fraction };
      }
    }
  }
  return best;
}

function intersects(a: ScreenRect, b: ScreenRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function placeRidePopup(
  point: ScreenPoint,
  size: Pick<ScreenRect, 'width' | 'height'>,
  viewport: Pick<ScreenRect, 'width' | 'height'>,
  obstacles: ScreenRect[],
  previous: ScreenPoint | undefined
) {
  const { width, height } = size;
  const margin = 8;
  const clearance = 22;
  const valid = (p: ScreenPoint) => {
    const bounds = { ...p, width, height };
    const nearPoint = { x: point.x - clearance, y: point.y - clearance, width: clearance * 2, height: clearance * 2 };
    return p.x >= margin && p.y >= margin && p.x + width <= viewport.width - margin &&
      p.y + height <= viewport.height - margin && !intersects(bounds, nearPoint) &&
      !obstacles.some((obstacle) => intersects(bounds, obstacle));
  };
  const clamp = ({ x, y }: ScreenPoint) => ({
    x: Math.round(Math.max(margin, Math.min(viewport.width - width - margin, x))),
    y: Math.round(Math.max(margin, Math.min(viewport.height - height - margin, y)))
  });
  if (previous && valid(previous)) {
    const dx = Math.max(0, previous.x - point.x, point.x - previous.x - width);
    const dy = Math.max(0, previous.y - point.y, point.y - previous.y - height);
    if (Math.hypot(dx, dy) < 185) return previous;
  }

  const right = { x: point.x + 85, y: point.y - 66 };
  const left = { x: point.x - width - 85, y: point.y - 66 };
  const below = { x: point.x - width / 2, y: point.y + 48 };
  const above = { x: below.x, y: point.y - height - 48 };
  const nearerBelow = { ...below, y: point.y + clearance };
  const nearerAbove = { ...above, y: point.y - height - clearance };
  const candidates = viewport.width < 640
    ? [below, above, nearerBelow, nearerAbove, right, left]
    : [right, left, below, above, nearerBelow, nearerAbove];
  const placements = candidates.map(clamp);
  return placements.find(valid) ?? placements.find((p) => !obstacles.some((obstacle) => intersects({ ...p, width, height }, obstacle))) ?? clamp(below);
}

export function popupLeader(point: ScreenPoint, panel: ScreenPoint, width: number, height: number) {
  const from = `M${point.x} ${point.y}`;
  if (point.x < panel.x || point.x > panel.x + width) {
    const x = point.x < panel.x ? panel.x : panel.x + width;
    const y = Math.max(panel.y + 16, Math.min(panel.y + height - 16, point.y - 48));
    return `${from} L${(point.x + x) / 2} ${y} H${x}`;
  }
  const y = point.y < panel.y ? panel.y : panel.y + height;
  const x = Math.max(panel.x + 16, Math.min(panel.x + width - 16, point.x - 28));
  return `${from} L${x} ${(point.y + y) / 2} V${y}`;
}
