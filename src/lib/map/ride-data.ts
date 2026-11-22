import type { Coordinates } from './route-data.js';

export type RideSample = [
  meters: number,
  elevation: number | null,
  timestamp: number | null,
  speed: number | null,
  heartRate: number | null
];

export interface RideData {
  // One distance per vertex of the matching simplified map line.
  vertices: number[];
  samples: RideSample[];
}

export type ElevationPoint = [meters: number, elevation: number | null];

export type RouteElevationData = Record<string, {
  vertices: number[];
  elevation: ElevationPoint[];
}>;

export interface RideWindow {
  start: number;
  end: number;
  samples: ElevationPoint[];
}

export function indexAtDistance<T>(values: T[], distance: number, meters: (value: T) => number) {
  let low = 0;
  let high = values.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (meters(values[middle]) < distance) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function isRecordingGap(a: RideSample, b: RideSample) {
  return a[2] !== null && b[2] !== null && b[0] - a[0] > 200 && b[2] - a[2] > 120;
}

export function rideSample(data: RideData, distance: number): RideSample | undefined {
  const index = indexAtDistance(data.samples, distance, (sample) => sample[0]);
  const next = data.samples[index];
  const previous = data.samples[index - 1];
  if (previous && distance < next[0] && isRecordingGap(previous, next)) return undefined;
  const closest = previous && distance - previous[0] < next[0] - distance ? previous : next;
  if (!previous || distance >= next[0] || previous[3] === null || next[3] === null) return closest;
  const fraction = (distance - previous[0]) / (next[0] - previous[0]);
  const speed = previous[3] + fraction * (next[3] - previous[3]);
  return [closest[0], closest[1], closest[2], speed, closest[4]];
}

export function elevationAtDistance(samples: ElevationPoint[], distance: number): number | null {
  const index = indexAtDistance(samples, distance, (sample) => sample[0]);
  const next = samples[index];
  const previous = samples[index - 1];
  if (next[0] === distance) return next[1];
  if (!previous || distance > next[0] || previous[1] === null || next[1] === null) return null;
  const fraction = (distance - previous[0]) / (next[0] - previous[0]);
  return previous[1] + fraction * (next[1] - previous[1]);
}

export function rideWindow(elevation: ElevationPoint[], distance: number, meters: number, previous?: RideWindow): RideWindow {
  const first = elevation[0][0];
  const last = elevation[elevation.length - 1][0];
  // Keep room to scroll even when the map shows the entire course.
  const span = Math.min(meters, (last - first) * .65);
  const start = Math.max(first, Math.min(last - span, distance - span / 2));
  const end = start + span;
  if (previous?.start === start && previous.end === end) return previous;
  const from = Math.max(0, indexAtDistance(elevation, start, (sample) => sample[0]) - 1);
  const to = indexAtDistance(elevation, end, (sample) => sample[0]);
  return { start, end, samples: elevation.slice(from, to + 1) };
}

export function routeCoordinate(coordinates: Coordinates[], distances: number[], distance: number): Coordinates {
  const index = indexAtDistance(distances, distance, (value) => value);
  const next = coordinates[index];
  if (index === 0) return next;
  const previous = coordinates[index - 1];
  const span = distances[index] - distances[index - 1];
  const ratio = span > 0 ? (distance - distances[index - 1]) / span : 0;
  return [previous[0] + (next[0] - previous[0]) * ratio, previous[1] + (next[1] - previous[1]) * ratio];
}

export function routeStretch(coordinates: Coordinates[], distances: number[], { start, end }: Pick<RideWindow, 'start' | 'end'>) {
  const from = indexAtDistance(distances, start, (value) => value);
  const to = indexAtDistance(distances, end, (value) => value);
  return [
    routeCoordinate(coordinates, distances, start),
    ...coordinates.slice(from, to),
    routeCoordinate(coordinates, distances, end)
  ];
}
