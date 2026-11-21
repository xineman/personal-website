import type { FeatureCollection, LineString } from 'geojson';

export type Coordinates = [longitude: number, latitude: number];
type RouteLine = Omit<LineString, 'coordinates'> & { coordinates: Coordinates[] };

// Chapter IDs link route segments to the story. Ferry crossings have no chapter.
export type RouteData = FeatureCollection<RouteLine, {
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

export interface MapFraming {
  center: number;
  width: number;
}
