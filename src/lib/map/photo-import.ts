import type { Coordinates } from './route-data.js';

interface PhotoMetadata {
  coordinates?: Coordinates;
  time?: string;
}

interface ImportedRoutePhoto extends PhotoMetadata {
  src: string;
  width: number;
  height: number;
  title: string;
}

function readExifDirectory(bytes: DataView): PhotoMetadata {
  const order = bytes.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return {};
  const littleEndian = order === 0x4949;
  const uint16 = (offset: number) => bytes.getUint16(offset, littleEndian);
  const uint32 = (offset: number) => bytes.getUint32(offset, littleEndian);
  if (uint16(2) !== 42) return {};

  function directory(offset: number | undefined) {
    const fields = new Map<number, { type: number; count: number; offset: number }>();
    if (!offset || offset + 2 > bytes.byteLength) return fields;
    const count = uint16(offset);
    if (offset + 2 + count * 12 > bytes.byteLength) return fields;
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12;
      const tag = uint16(entry);
      const type = uint16(entry + 2);
      const count = uint32(entry + 4);
      const unit = type === 2 ? 1 : type === 4 ? 4 : type === 5 ? 8 : 0;
      if (!unit || !count) continue;
      const size = unit * count;
      const valueOffset = size <= 4 ? entry + 8 : uint32(entry + 8);
      if (valueOffset + size <= bytes.byteLength) fields.set(tag, { type, count, offset: valueOffset });
    }
    return fields;
  }

  type ExifFields = ReturnType<typeof directory>;
  function offsetField(fields: ExifFields, tag: number) {
    const field = fields.get(tag);
    if (field?.type === 4 && field.count === 1) return uint32(field.offset);
  }

  function textField(fields: ExifFields, tag: number) {
    const field = fields.get(tag);
    if (field?.type !== 2) return;
    let text = '';
    for (let index = 0; index < Math.min(field.count, 32); index++) {
      const code = bytes.getUint8(field.offset + index);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  }

  function degrees(fields: ExifFields, tag: number) {
    const field = fields.get(tag);
    if (field?.type !== 5 || field.count !== 3) return;
    const [whole, minutes, seconds] = [0, 8, 16].map((index) =>
      uint32(field.offset + index) / uint32(field.offset + index + 4)
    );
    if (!Number.isFinite(whole) || !(minutes < 60 && seconds < 60)) return;
    return whole + minutes / 60 + seconds / 3600;
  }

  const root = directory(uint32(4));
  const camera = directory(offsetField(root, 0x8769));
  const gps = directory(offsetField(root, 0x8825));
  const latitude = degrees(gps, 2);
  const longitude = degrees(gps, 4);
  const latRef = textField(gps, 1);
  const lonRef = textField(gps, 3);
  const hasCoordinates = latitude !== undefined && latitude < 90 && longitude !== undefined && longitude <= 180 &&
    (latRef === 'N' || latRef === 'S') && (lonRef === 'E' || lonRef === 'W');
  const capturedAt = textField(camera, 0x9003) ?? textField(root, 0x0132);
  return {
    coordinates: hasCoordinates
      ? [lonRef === 'W' ? -longitude : longitude, latRef === 'S' ? -latitude : latitude]
      : undefined,
    time: capturedAt && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}/.test(capturedAt) ? capturedAt.slice(11, 16) : undefined
  };
}

function readPhotoMetadata(buffer: ArrayBuffer): PhotoMetadata {
  const bytes = new DataView(buffer);
  if (bytes.byteLength < 4 || bytes.getUint16(0) !== 0xffd8) return {};
  for (let start = 2; start + 4 <= bytes.byteLength;) {
    if (bytes.getUint8(start) !== 0xff) break;
    while (start + 4 <= bytes.byteLength && bytes.getUint8(start + 1) === 0xff) start++;
    if (start + 4 > bytes.byteLength) break;
    const marker = bytes.getUint16(start);
    if (marker === 0xffda || marker === 0xffd9) break;
    const length = bytes.getUint16(start + 2);
    const end = start + 2 + length;
    if (length < 2 || end > bytes.byteLength) break;
    if (marker === 0xffe1 && length >= 16 && bytes.getUint32(start + 4) === 0x45786966 &&
      bytes.getUint16(start + 8) === 0) {
      return readExifDirectory(new DataView(buffer, start + 10, end - start - 10));
    }
    start = end;
  }
  return {};
}

export async function readRoutePhotoFile(file: File): Promise<ImportedRoutePhoto> {
  const src = URL.createObjectURL(file);
  try {
    const photo = new Image();
    photo.src = src;
    const [, prefix] = await Promise.all([photo.decode(), file.slice(0, 256 * 1024).arrayBuffer()]);
    if (!photo.naturalWidth || !photo.naturalHeight) throw new Error('Image has no dimensions');
    return {
      src,
      width: photo.naturalWidth,
      height: photo.naturalHeight,
      title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 96) || 'Imported photo',
      ...readPhotoMetadata(prefix)
    };
  } catch (error) {
    URL.revokeObjectURL(src);
    throw error;
  }
}
