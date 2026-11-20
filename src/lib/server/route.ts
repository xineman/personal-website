import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SaxesParser } from 'saxes';
import article from '../../../content/article.json';

type Point = [x: number, y: number];
type TrackSegment = { points: Point[]; official: boolean };

const directory = resolve('data/northcape-4000/gpx');

function project(lon: number, lat: number): Point {
  return [210 + (lon - 14) * 15, 30 + (72.5 - lat) * 19];
}

function pathData(points: Point[]) {
  return 'M' + points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

function simplify(points: Point[]): Point[] {
  if (points.length <= 2) return points;

  const [startX, startY] = points[0];
  const end = points[points.length - 1];
  const [endX, endY] = end;
  const dx = endX - startX;
  const dy = endY - startY;
  const length = dx * dx + dy * dy;
  let maxDistance = 0.11 ** 2;
  let split = 0;

  for (let index = 1; index < points.length - 1; index++) {
    const [x, y] = points[index];
    const relativeX = x - startX;
    const relativeY = y - startY;
    const along = length ? (relativeX * dx + relativeY * dy) / length : 0;
    const fraction = Math.max(0, Math.min(1, along));
    const distance = (relativeX - dx * fraction) ** 2 + (relativeY - dy * fraction) ** 2;
    if (distance > maxDistance) {
      maxDistance = distance;
      split = index;
    }
  }

  return split
    ? [...simplify(points.slice(0, split + 1)).slice(0, -1), ...simplify(points.slice(split))]
    : [points[0], end];
}

async function readGpx(file: string) {
  const segments: Point[][] = [];
  let points: Point[] = [];
  const parser = new SaxesParser();

  parser.on('opentag', ({ name, attributes }) => {
    const tag = name.split(':').at(-1);
    if (tag === 'trkseg' || tag === 'rte') points = [];
    if (tag === 'trkpt' || tag === 'rtept') {
      points.push(project(Number(attributes.lon), Number(attributes.lat)));
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

export async function buildRoute() {
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

  const chapters = article.chapters.map(({ id, days: [first, last], coordinates: [lon, lat] }) => {
    const lines = [];
    for (let day = first; day <= last; day++) {
      const segments = days.get(day);
      if (!segments?.length) throw new Error(`No GPX track for day ${day}`);
      for (const { points, official } of segments) {
        lines.push({ path: pathData(simplify(points)), official });
      }
    }
    const [x, y] = project(lon, lat);
    return { id, x: x.toFixed(1), y: y.toFixed(1), lines };
  });

  const ferries = [7, 12].map((day) => {
    const departure = days.get(day)?.at(-1)?.points.at(-1);
    const arrival = days.get(day + 1)?.[0]?.points[0];
    if (!departure || !arrival) throw new Error(`Missing GPX track for ferry after day ${day}`);
    return pathData([departure, arrival]);
  });
  const meridians = [0, 5, 10, 15, 20, 25, 30, 35].map(lon => `M${project(lon, 60)[0]},0V565`);
  const parallels = [45, 50, 55, 60, 65, 70].map(lat => `M0,${project(15, lat)[1]}H490`);
  const arcticY = project(15, 66.56)[1];

  return { chapters, ferries, grid: [...meridians, ...parallels].join(''), arcticY };
}

export type RouteMapData = Awaited<ReturnType<typeof buildRoute>>;
