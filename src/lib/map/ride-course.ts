import { earthRadius, greatCircleAngle, type Coordinates, type RouteData } from './route-data.js';
import { indexAtDistance, routeStretch, type ElevationPoint, type RideWindow, type RouteElevationData } from './ride-data.js';

type RouteFeature = RouteData['features'][number];

interface RideTrack {
  feature: RouteFeature;
  vertices: number[];
  start: number;
  end: number;
  dayStart: number;
}

export interface RideCourse {
  tracks: RideTrack[];
  elevation: ElevationPoint[];
}

const metersBetween = (a: Coordinates, b: Coordinates) => Math.round(earthRadius * greatCircleAngle(a, b));

export function prepareRideCourse(route: RouteData, data: RouteElevationData): RideCourse {
  const elevation: ElevationPoint[] = [];
  let cursor = 0;
  let lastPosition: Coordinates | undefined;

  const tracks = route.features.map((feature): RideTrack => {
    const points = feature.geometry.coordinates;
    const gap = lastPosition ? metersBetween(lastPosition, points[0]) : 0;
    if (gap > 150) elevation.push([cursor + gap / 2, null]);
    const start = cursor + gap;
    lastPosition = points[points.length - 1];

    if (feature.properties.kind === 'ferry') {
      const end = start + metersBetween(points[0], lastPosition);
      elevation.push([start + (end - start) / 2, null]);
      cursor = end;
      return { feature, vertices: [start, end], start, end, dayStart: 0 };
    }

    const recording = data[feature.properties.telemetry ?? ''];
    if (!recording || recording.vertices.length !== points.length || !recording.elevation.length) {
      throw new Error('Elevation data does not match the route');
    }
    const dayStart = recording.vertices[0];
    const offset = start - dayStart;
    const vertices = recording.vertices.map((distance) => distance + offset);
    const end = vertices[vertices.length - 1];
    for (const [distance, meters] of recording.elevation) {
      elevation.push([distance + offset, meters]);
    }
    cursor = end;
    return { feature, vertices, start, end, dayStart };
  });

  if (!elevation.length) throw new Error('No elevation data for the route');
  return { tracks, elevation };
}

export function locateRidePoint(course: RideCourse, distance: number) {
  const order = indexAtDistance(course.tracks, distance, (track) => track.end);
  const track = course.tracks[order];
  const previous = course.tracks[order - 1];
  if (previous && distance < track.start && distance - previous.end < track.start - distance) {
    return { order: order - 1, distance: previous.end };
  }
  return { order, distance: Math.max(track.start, Math.min(track.end, distance)) };
}

export function rideCourseStretch(course: RideCourse, window: RideWindow): RouteData {
  const features = course.tracks.flatMap(({ feature, vertices, start, end }): RouteFeature[] => {
    const from = Math.max(start, window.start);
    const to = Math.min(end, window.end);
    if (from >= to || feature.properties.kind === 'ferry') return [];
    if (from === start && to === end) return [feature];
    return [{
      ...feature,
      geometry: { type: 'LineString', coordinates: routeStretch(feature.geometry.coordinates, vertices, { start: from, end: to }) }
    }];
  });
  return { type: 'FeatureCollection', features };
}
