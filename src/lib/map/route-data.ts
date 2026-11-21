import type { FeatureCollection, LineString } from 'geojson';

export type Coordinates = [longitude: number, latitude: number];

export type RouteData = FeatureCollection<LineString, {
  chapterId: string | null;
  kind: 'ride' | 'official' | 'ferry';
}>;

export interface RouteChapter {
  id: string;
  title: string;
  number: string;
  pin: string;
  coordinates: readonly number[];
  labelSide: string;
}
