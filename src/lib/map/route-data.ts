import type { FeatureCollection, LineString } from 'geojson';

export type Coordinates = [longitude: number, latitude: number];
type RouteLine = Omit<LineString, 'coordinates'> & { coordinates: Coordinates[] };

// Chapter IDs link route segments to the story. Ferry crossings have no chapter.
export type RouteData = FeatureCollection<RouteLine, {
  chapterId: string | null;
  kind: 'ride' | 'official' | 'ferry';
  day?: number;
  telemetry?: string;
}> & { elevationProfile?: string };

export const earthRadius = 6_371_008.8;

export function greatCircleAngle(a: Coordinates, b: Coordinates) {
  const radians = Math.PI / 180;
  const lat = (b[1] - a[1]) * radians;
  const lon = (b[0] - a[0]) * radians;
  const angle = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(lon / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.min(1, angle)));
}

export interface RouteChapter {
  id: string;
  title: string;
  number: string;
  pin: string;
  coordinates: readonly number[];
  labelSide: string;
}

export interface MapFraming {
  center: number;
  width: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}
