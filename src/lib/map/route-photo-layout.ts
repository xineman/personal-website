import { earthRadius, greatCircleAngle, type Coordinates, type ScreenPoint } from './route-data.js';

export interface RoutePhoto {
  id: string;
  src: string;
  alt: string;
  caption: string;
  date?: string;
  day?: number;
  time?: string;
  note?: string;
  width: number;
  height: number;
  coordinates: Coordinates;
}

export type PhotoLayout = 'side' | 'below' | 'fullscreen';
export type PhotoBox = ScreenPoint & { width: number; height: number };
export type PhotoFlightBox = PhotoBox & { cropX: number; cropY: number };
export type PhotoViewport = Pick<PhotoBox, 'width' | 'height'>;
export type ProjectedPhoto = { photo: RoutePhoto; point: ScreenPoint };
type Print = PhotoBox & { imageHeight: number };
type PrintSlot = { side: number; offset: number; gap: number };
export type PhotoPlacement = { photo: RoutePhoto; members: RoutePhoto[]; slot?: PrintSlot; print?: Print };
export type PhotoPosition = { print?: Print; marker?: ScreenPoint; printScale?: number };
export type PhotoStack = ProjectedPhoto & { members: RoutePhoto[]; marker?: ScreenPoint; box?: PhotoBox; print?: PhotoBox; printScale?: number };
export const photoMarkerSize = 34;

export function photoFlightEasing(progress: number) {
  if (progress <= 0 || progress >= 1) return progress;
  // Match the viewer's cubic-bezier(.16, 1, .3, 1).
  let low = 0;
  let high = 1;
  for (let step = 0; step < 16; step++) {
    const t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * .16 + 3 * (1 - t) * t ** 2 * .3 + t ** 3;
    if (x < progress) low = t;
    else high = t;
  }
  return 1 - (1 - (low + high) / 2) ** 3;
}

export function interpolatePhotoFlight(from: PhotoFlightBox, to: PhotoFlightBox, progress: number): PhotoFlightBox {
  const mix = (a: number, b: number) => a + (b - a) * progress;
  return { x: mix(from.x, to.x), y: mix(from.y, to.y), width: mix(from.width, to.width),
    height: mix(from.height, to.height), cropX: mix(from.cropX, to.cropX), cropY: mix(from.cropY, to.cropY) };
}

export function visiblePhotoFlight({ x, y, width, height, cropX, cropY }: PhotoFlightBox): PhotoBox {
  return { x: x + width * cropX, y: y + height * cropY, width: width * (1 - 2 * cropX), height: height * (1 - 2 * cropY) };
}

export const desktopPhotos = ({ width, height }: PhotoViewport) => width >= 900 && height >= 520;

export function photoLayout(photo: RoutePhoto, viewport: PhotoViewport, previous?: PhotoLayout): PhotoLayout {
  if (!desktopPhotos(viewport)) return 'fullscreen';
  const ratio = photo.width / photo.height;
  if (ratio >= 1.6) return 'below';
  return ratio >= 1 / 1.1 && ratio <= 1.1 && previous === 'below' ? 'below' : 'side';
}

export function mapSpace({ width, height }: PhotoViewport) {
  return { width: width * .53, height: Math.max(height * .45, 250) };
}

export function photoAnchor(point: ScreenPoint, viewport: PhotoViewport): ScreenPoint {
  const shared = mapSpace(viewport);
  return {
    x: Math.max(viewport.width * .27, Math.min(point.x, shared.width - 88)),
    y: Math.max(94, Math.min(point.y, shared.height - 48))
  };
}

export function samePhotoStop(photos: RoutePhoto[]) {
  return photos.every((a, i) => photos.slice(i + 1).every((b) =>
    greatCircleAngle(a.coordinates, b.coordinates) * earthRadius <= 100
  ));
}

function comparePhotos(a: RoutePhoto, b: RoutePhoto) {
  return (a.day ?? Infinity) - (b.day ?? Infinity) || (a.date ?? '').localeCompare(b.date ?? '') ||
    (a.time ?? '').localeCompare(b.time ?? '') || a.id.localeCompare(b.id);
}

function overlaps(a: PhotoBox, b: PhotoBox) {
  return a.x < b.x + b.width + 8 && a.x + a.width + 8 > b.x &&
    a.y < b.y + b.height + 8 && a.y + a.height + 8 > b.y;
}

export function visiblePhotoPoint({ x, y }: ScreenPoint, { width, height }: PhotoViewport) {
  return x >= 12 && x <= width - 12 && y >= 12 && y <= height - 12;
}

export function placePhotoStacks(
  points: ProjectedPhoto[], viewport: PhotoViewport, overlapsRoute: (box: PhotoBox) => boolean,
  previous: PhotoPlacement[] = []
): PhotoPlacement[] {
  const { width, height } = viewport;
  const small = width < 700;
  const groups: (PhotoPlacement & { point: ScreenPoint })[] = [];
  const placed: PhotoBox[] = [
    { x: 0, y: 0, width: small ? 174 : 250, height: small ? 190 : 82 },
    { x: width - 172, y: 0, width: 172, height: 164 },
    { x: width - 142, y: height - 260, width: 142, height: 260 },
    { x: 0, y: height - 60, width: width < 450 ? width - 42 : 200, height: 60 }
  ];
  const previousGroups = new Map(previous.map((group) => [group.photo.id, group]));
  const previousMembers = new Map(previous.flatMap((group) =>
    group.members.map((photo) => [photo.id, group.photo.id] as const)
  ));
  for (const item of points) {
    const group = groups.find(({ photo, point }) => {
      const existing = previousMembers.get(item.photo.id);
      const sameGroup = existing !== undefined && existing === previousMembers.get(photo.id);
      const threshold = sameGroup ? 44 : existing ? 32 : 36;
      return Math.hypot(item.point.x - point.x, item.point.y - point.y) < threshold;
    });
    if (group) group.members.push(item.photo);
    else groups.push({ ...item, members: [item.photo] });
  }

  for (const group of groups) group.members.sort(comparePhotos);
  const visible = groups.filter(({ point }) => visiblePhotoPoint(point, viewport));
  const anchors = visible.map(({ point: { x, y } }) => ({ x: x - 12, y: y - 12, width: 24, height: 24 }));
  for (const group of groups) {
    const prior = previousGroups.get(group.photo.id);
    if (visiblePhotoPoint(group.point, viewport)) continue;
    // Keep the last placement so panning away and back does not pick a new side.
    group.slot = prior?.slot;
    group.print = prior?.print;
  }
  visible.sort((a, b) => Number(!!previousGroups.get(b.photo.id)?.print) - Number(!!previousGroups.get(a.photo.id)?.print));
  for (const group of visible) {
    const { x, y } = group.point;
    const imageWidth = group.members.length > 1 ? (small ? 66 : 98) :
      Math.round(Math.max(53, Math.min(small ? 82 : 116, (small ? 72 : 98) * group.photo.width / group.photo.height)));
    const imageHeight = group.members.length > 1 ? Math.round(imageWidth * .7) :
      Math.round(Math.min(small ? 76 : 100, imageWidth * group.photo.height / group.photo.width));
    const cardHeight = imageHeight + (group.members.length > 1 || !small ? 23 : 0);
    const side = x < width * .5 ? -1 : 1;
    const prior = previousGroups.get(group.photo.id)?.slot;
    const slots = [34, 58].flatMap((gap) => [side, -side].flatMap((side) =>
      [-.45, -.83, .12].map((offset) => ({ side, offset, gap }))));
    if (prior) slots.unshift(prior);
    for (const slot of slots) {
      const print = { x: slot.side < 0 ? -imageWidth - slot.gap : slot.gap, y: cardHeight * slot.offset,
        width: imageWidth, height: cardHeight, imageHeight };
      const printX = x + print.x;
      const printY = y + print.y;
      // The fanned prints extend above and to the right of the front photo.
      const box = group.members.length > 1
        ? { x: printX, y: printY - 12, width: imageWidth + 14, height: cardHeight + 12 }
        : { x: printX, y: printY, width: imageWidth, height: cardHeight };
      if (box.x < 8 || box.y < 8 || box.x + box.width > width - 8 || box.y + box.height > height - 8 ||
        placed.some((other) => overlaps(box, other)) || anchors.some((other) => overlaps(box, other)) ||
        overlapsRoute(box)) continue;
      group.slot = slot;
      group.print = print;
      placed.push(box);
      break;
    }
    group.slot ??= prior;
  }
  return groups.map(({ photo, members, slot, print }) => ({ photo, members, slot, print }));
}

export function samePhotoPlacements(a: PhotoPlacement[], b: PhotoPlacement[]) {
  return a.length === b.length && a.every((group, i) => {
    const other = b[i];
    return group.photo === other.photo && group.members.length === other.members.length &&
      group.members.every((photo, index) => photo === other.members[index]) &&
      group.print?.x === other.print?.x && group.print?.y === other.print?.y &&
      group.print?.width === other.print?.width && group.print?.height === other.print?.height &&
      group.print?.imageHeight === other.print?.imageHeight;
  });
}

export function photoPosition(placement: PhotoPlacement, previous: PhotoPosition | undefined, progress: number): PhotoPosition {
  const print = placement.print;
  if (!previous || progress === 1) return { print };
  const from = previous.print;
  const mix = (a: number, b: number) => a + (b - a) * progress;
  if (print) {
    // A print changing sides would otherwise slide over the point it labels.
    if (from && !previous.printScale && Math.sign(from.x) !== Math.sign(print.x)) return { print };
    const scale = previous.printScale ?? (from ? 1 : photoMarkerSize / Math.max(print.width, print.imageHeight));
    const marker = previous.marker ?? { x: 0, y: 0 };
    // Begin with the image centered on the marker and the same size as its badge.
    const start = from ?? { x: marker.x - print.width * scale / 2, y: marker.y - print.imageHeight * scale / 2,
      width: print.width * scale, height: print.height * scale, imageHeight: print.imageHeight * scale };
    return { print: { x: mix(start.x, print.x), y: mix(start.y, print.y),
      width: mix(start.width, print.width), height: mix(start.height, print.height),
      imageHeight: mix(start.imageHeight, print.imageHeight) },
      printScale: scale < 1 ? mix(scale, 1) : undefined };
  }
  const marker = from ? { x: from.x + from.width / 2, y: from.y + from.imageHeight / 2 } : previous.marker;
  return { marker: marker && { x: mix(marker.x, 0), y: mix(marker.y, 0) } };
}

export function projectPhotoStack(placement: PhotoPlacement, point: ScreenPoint, position: PhotoPosition): PhotoStack {
  const { print, marker } = position;
  const box = print && { x: point.x + print.x, y: point.y + print.y, width: print.width, height: print.height };
  return { photo: placement.photo, members: placement.members, point, box,
    print: box && { ...box, height: print!.imageHeight },
    printScale: position.printScale,
    marker: marker && { x: point.x + marker.x, y: point.y + marker.y } };
}

export function photoLeader(anchor: ScreenPoint, box: PhotoBox, layout: PhotoLayout = 'side') {
  if (layout === 'below') {
    const x = Math.max(box.x + 8, Math.min(anchor.x, box.x + box.width - 8));
    const elbow = anchor.y + (box.y - anchor.y) * .55;
    return `M${anchor.x},${anchor.y} V${elbow} L${x},${box.y - 12} V${box.y}`;
  }
  const fromRight = anchor.x > box.x + box.width / 2;
  const x = fromRight ? box.x + box.width : box.x;
  const y = Math.max(box.y + 8, Math.min(anchor.y, box.y + box.height - 8));
  const elbow = anchor.x + (x - anchor.x) * .55;
  return `M${anchor.x},${anchor.y} H${elbow} L${x + (fromRight ? 12 : -12)},${y} H${x}`;
}
