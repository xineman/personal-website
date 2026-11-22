import { earthRadius, greatCircleAngle, type Coordinates } from '../src/lib/map/route-data.ts';
import { isRecordingGap, type ElevationPoint, type RideData, type RideSample } from '../src/lib/map/ride-data.ts';

export interface GpxPoint {
  coordinates: Coordinates;
  elevation: number | null;
  timestamp: number | null;
  heartRate: number | null;
}

const maxInterval = 4;
const maxSpeed = 95;

export function buildTelemetry(points: GpxPoint[], kept: number[], offset: number): RideData {
  let distance = offset;
  const distances = [distance];
  const steps: (number | null)[] = [];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    const meters = earthRadius * greatCircleAngle(a.coordinates, b.coordinates);
    const seconds = a.timestamp === null || b.timestamp === null ? 0 : b.timestamp - a.timestamp;
    distance += meters;
    distances.push(distance);
    const speed = seconds > 0 ? meters / seconds * 3.6 : Infinity;
    steps.push(seconds <= maxInterval && speed <= maxSpeed ? speed : null);
  }

  function estimateSpeed(index: number) {
    // Stay on one side of a pause or rejected GPS jump and require several nearby measurements.
    if (steps[index - 1] === null || steps[index] === null) return null;
    const window: number[] = [];
    for (let i = index - 1; i >= Math.max(0, index - 4) && steps[i] !== null; i--) window.push(steps[i]!);
    for (let i = index; i < Math.min(steps.length, index + 5) && steps[i] !== null; i++) window.push(steps[i]!);
    if (window.length < 4) return null;
    window.sort((a, b) => a - b);
    return Math.round(window[Math.floor(window.length / 2)] * 10) / 10;
  }

  const samples: RideSample[] = [];
  let previous: RideSample | undefined;
  for (let index = 0; index < points.length; index++) {
    const { elevation, timestamp, heartRate } = points[index];
    const current: RideSample = [Math.round(distances[index]), elevation, timestamp, estimateSpeed(index), heartRate];
    const last = samples.at(-1);
    const availabilityChanged = previous && (previous[3] === null) !== (current[3] === null);
    if (!last || index === points.length - 1 || availabilityChanged || current[0] - last[0] >= 20 ||
      (timestamp !== null && last[2] !== null && timestamp - last[2] >= 12)) {
      if (availabilityChanged && previous !== last) samples.push(previous!);
      samples.push(current);
    }
    previous = current;
  }

  return { vertices: kept.map((index) => Math.round(distances[index])), samples };
}

export function buildElevationProfile(samples: RideSample[]): ElevationPoint[] {
  const profile: ElevationPoint[] = [];
  let points: [number, number][] = [];

  function appendSection() {
    if (!points.length) return;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const ranges: [number, number][] = [[0, points.length - 1]];
    while (ranges.length) {
      const [first, last] = ranges.pop()!;
      const [start, low] = points[first];
      const [end, high] = points[last];
      let error = 1;
      let split = first;
      for (let index = first + 1; index < last; index++) {
        const [distance, elevation] = points[index];
        const expected = end === start ? low : low + (high - low) * (distance - start) / (end - start);
        const difference = Math.abs(elevation - expected);
        if (difference > error) {
          error = difference;
          split = index;
        }
      }
      if (split !== first) {
        keep[split] = 1;
        ranges.push([first, split], [split, last]);
      }
    }
    points.forEach((point, index) => { if (keep[index]) profile.push(point); });
    points = [];
  }

  for (const [index, sample] of samples.entries()) {
    const [meters, elevation] = sample;
    const previous = samples[index - 1];
    if (previous && isRecordingGap(previous, sample)) {
      appendSection();
      profile.push([Math.round((previous[0] + meters) / 2), null]);
    }
    if (elevation === null) {
      appendSection();
      profile.push([meters, null]);
    } else {
      points.push([meters, elevation]);
    }
  }
  appendSection();
  return profile;
}
