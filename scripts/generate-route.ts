import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SaxesParser } from 'saxes';
import article from '../content/article.json' with { type: 'json' };
import type { Coordinates, RouteData } from '../src/lib/map/route-data.ts';

type TrackSegment = { points: Coordinates[]; official: boolean };

const directory = fileURLToPath(new URL('../data/northcape-4000/gpx/', import.meta.url));

function simplify(points: Coordinates[]): Coordinates[] {
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

  return points.filter((_, index) => keep[index]);
}

function roundCoordinates([lon, lat]: Coordinates): Coordinates {
  return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
}

async function readGpx(file: string) {
  const segments: Coordinates[][] = [];
  let points: Coordinates[] = [];
  const parser = new SaxesParser();

  parser.on('opentag', ({ name, attributes }) => {
    const tag = name.split(':').at(-1);
    if (tag === 'trkseg' || tag === 'rte') points = [];
    if (tag === 'trkpt' || tag === 'rtept') {
      const lon = Number(attributes.lon);
      const lat = Number(attributes.lat);
      if (Number.isFinite(lon) && Number.isFinite(lat)) points.push([lon, lat]);
    }
  });

  parser.on('closetag', ({ name }) => {
    const tag = name.split(':').at(-1);
    if ((tag === 'trkseg' || tag === 'rte') && points.length >= 2) segments.push(points);
  });

  for await (const chunk of createReadStream(resolve(directory, file), 'utf8')) {
    parser.write(chunk);
  }
  parser.close();
  return segments;
}

async function buildRoute(): Promise<RouteData> {
  const days = new Map<number, TrackSegment[]>();
  for (const file of (await readdir(directory)).sort()) {
    const match = /^day-(\d+)\D*\.gpx$/.exec(file);
    // Day 22b records the ride back from the finish to Honningsvåg.
    if (!match || file === 'day-22b.gpx') continue;

    const day = Number(match[1]);
    const segments = days.get(day) ?? [];
    for (const points of await readGpx(file)) {
      segments.push({ points, official: file.includes('official') });
    }
    days.set(day, segments);
  }

  const features: RouteData['features'] = [];
  for (const { id, days: [first, last] } of article.chapters) {
    for (let day = first; day <= last; day++) {
      const segments = days.get(day);
      if (!segments?.length) throw new Error(`No GPX track for day ${day}`);
      for (const { points, official } of segments) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: simplify(points).map(roundCoordinates) },
          properties: { chapterId: id, kind: official ? 'official' : 'ride' }
        });
      }
    }
  }

  for (const day of [7, 12]) {
    const departure = days.get(day)?.at(-1)?.points.at(-1);
    const arrival = days.get(day + 1)?.[0]?.points[0];
    if (!departure || !arrival) throw new Error(`Missing GPX track for ferry after day ${day}`);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [departure, arrival].map(roundCoordinates) },
      properties: { chapterId: null, kind: 'ferry' }
    });
  }

  return { type: 'FeatureCollection', features };
}

const route = await buildRoute();
const output = new URL('../static/route.geojson', import.meta.url);
const temporary = new URL(`../.route-${randomUUID()}.geojson`, import.meta.url);

try {
  await writeFile(temporary, JSON.stringify(route));
  await rename(temporary, output);
} finally {
  await rm(temporary, { force: true });
}
