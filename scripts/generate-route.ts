import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SaxesParser } from 'saxes';
import article from '../content/article.json' with { type: 'json' };
import type { Coordinates, RouteData } from '../src/lib/map/route-data.ts';
import type { RouteElevationData } from '../src/lib/map/ride-data.ts';
import { buildElevationProfile, buildTelemetry, type GpxPoint } from './ride-telemetry.ts';

type TrackSegment = { points: GpxPoint[]; official: boolean; name: string };

const directory = fileURLToPath(new URL('../data/northcape-4000/gpx/', import.meta.url));
const telemetryDirectory = new URL('../static/route-telemetry/', import.meta.url);

function simplify(points: Coordinates[]): number[] {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const ranges: [number, number][] = [[0, points.length - 1]];

  while (ranges.length) {
    const [first, last] = ranges.pop()!;
    const [startLon, startLat] = points[first];
    const [endLon, endLat] = points[last];
    const lonScale = Math.cos((startLat + endLat) * Math.PI / 360);
    const dx = (endLon - startLon) * lonScale;
    const dy = endLat - startLat;
    const length = dx * dx + dy * dy;
    // Keep detail down to roughly six metres while reducing the GeoJSON payload.
    let maxDistance = 0.000055 ** 2;
    let split = first;

    for (let index = first + 1; index < last; index++) {
      const [lon, lat] = points[index];
      const x = (lon - startLon) * lonScale;
      const y = lat - startLat;
      const fraction = length ? Math.max(0, Math.min(1, (x * dx + y * dy) / length)) : 0;
      const distance = (x - dx * fraction) ** 2 + (y - dy * fraction) ** 2;
      if (distance > maxDistance) {
        maxDistance = distance;
        split = index;
      }
    }

    if (split !== first) {
      keep[split] = 1;
      ranges.push([first, split], [split, last]);
    }
  }

  return points.flatMap((_, index) => keep[index] ? [index] : []);
}

function roundCoordinates([lon, lat]: Coordinates): Coordinates {
  return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
}

async function readGpx(file: string) {
  const segments: GpxPoint[][] = [];
  let points: GpxPoint[] = [];
  let point: GpxPoint | undefined;
  let field: string | undefined;
  let value = '';
  const parser = new SaxesParser();

  // GPX files can contain recorded track segments or planned routes.
  parser.on('opentag', ({ name, attributes }) => {
    const tag = name.split(':').at(-1);
    if (tag === 'trkseg' || tag === 'rte') points = [];
    if (tag === 'trkpt' || tag === 'rtept') {
      const lon = Number(attributes.lon);
      const lat = Number(attributes.lat);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        point = { coordinates: [lon, lat], elevation: null, timestamp: null, heartRate: null };
      }
    }
    if (point && (tag === 'ele' || tag === 'time' || tag === 'hr')) {
      field = tag;
      value = '';
    }
  });
  parser.on('text', (chunk) => { if (field) value += chunk; });

  parser.on('closetag', ({ name }) => {
    const tag = name.split(':').at(-1);
    if (point && field && tag === field) {
      const parsed = tag === 'time' ? Date.parse(value) / 1000 : Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        if (tag === 'ele') point.elevation = parsed;
        if (tag === 'time') point.timestamp = parsed;
        if (tag === 'hr') point.heartRate = parsed;
      }
      field = undefined;
    }
    if (tag === 'trkpt' || tag === 'rtept') {
      if (point) points.push(point);
      point = undefined;
    }
    if ((tag === 'trkseg' || tag === 'rte') && points.length >= 2) segments.push(points);
  });

  for await (const chunk of createReadStream(resolve(directory, file), 'utf8')) {
    parser.write(chunk);
  }
  parser.close();
  return segments;
}

async function writeAtomically(output: URL, content: string) {
  const temporary = new URL(`.${randomUUID()}.tmp`, output);
  try {
    await writeFile(temporary, content);
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeTelemetry(name: string, data: object) {
  const payload = JSON.stringify(data);
  // Version the assets so cached routes always reference matching data.
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 12);
  const key = `${name}-${hash}`;
  await writeAtomically(new URL(key + '.json', telemetryDirectory), payload);
  return key;
}

async function buildRoute(): Promise<RouteData> {
  const days = new Map<number, TrackSegment[]>();
  for (const file of (await readdir(directory)).sort()) {
    const match = /^day-(\d+)\D*\.gpx$/.exec(file);
    // Day 22b records the ride back from the finish to Honningsvåg.
    if (!match || file === 'day-22b.gpx') continue;

    const day = Number(match[1]);
    const segments = days.get(day) ?? [];
    for (const [index, points] of (await readGpx(file)).entries()) {
      segments.push({ points, official: file.includes('official'), name: `${file.slice(0, -4)}-${index + 1}` });
    }
    days.set(day, segments);
  }

  const features: RouteData['features'] = [];
  const profiles: RouteElevationData = {};
  for (const { id, days: [first, last] } of article.chapters) {
    for (let day = first; day <= last; day++) {
      const segments = days.get(day);
      if (!segments?.length) throw new Error(`No GPX track for day ${day}`);
      let distance = 0;
      for (const { points, official, name } of segments) {
        const coordinates = points.map((point) => point.coordinates);
        const kept = simplify(coordinates);
        const data = buildTelemetry(points, kept, distance);
        distance = data.vertices[data.vertices.length - 1];
        const telemetry = await writeTelemetry(name, data);
        profiles[telemetry] = { vertices: data.vertices, elevation: buildElevationProfile(data.samples) };
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: kept.map((index) => roundCoordinates(coordinates[index])) },
          properties: { chapterId: id, kind: official ? 'official' : 'ride', day, telemetry }
        });
      }
    }
  }

  // Draw ferry crossings between the end of one day's track and the next day's start.
  for (const day of [7, 12]) {
    const departure = days.get(day)?.at(-1)?.points.at(-1)?.coordinates;
    const arrival = days.get(day + 1)?.[0]?.points[0]?.coordinates;
    if (!departure || !arrival) throw new Error(`Missing GPX track for ferry after day ${day}`);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [departure, arrival].map(roundCoordinates) },
      properties: { chapterId: null, kind: 'ferry' }
    });
  }

  return { type: 'FeatureCollection', features, elevationProfile: await writeTelemetry('elevation', profiles) };
}

await mkdir(telemetryDirectory, { recursive: true });
const route = await buildRoute();
await writeAtomically(new URL('../static/route.geojson', import.meta.url), JSON.stringify(route));
