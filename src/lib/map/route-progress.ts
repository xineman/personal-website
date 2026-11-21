import type { Coordinates, RouteChapter, RouteData } from './route-data.js';

export interface ReadingPosition {
  chapter: number;
  fraction: number;
  percent: number;
}

type RouteFeature = RouteData['features'][number];
type OrderedFeature = RouteFeature & { properties: RouteFeature['properties'] & { order: number } };
type OrderedRoute = Omit<RouteData, 'features'> & { features: OrderedFeature[] };

function distance(a: Coordinates, b: Coordinates) {
  const radians = Math.PI / 180;
  const lat = (b[1] - a[1]) * radians;
  const lon = (b[0] - a[0]) * radians;
  const angle = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(lon / 2) ** 2;
  return 2 * Math.asin(Math.sqrt(Math.min(1, angle)));
}

export function prepareRoute(route: RouteData, chapters: RouteChapter[]) {
  const crossings = new Map(route.features.filter(({ properties }) => properties.kind === 'ferry')
    .map((feature) => [feature.geometry.coordinates[0].join(','), feature]));
  const ordered: OrderedRoute = { type: 'FeatureCollection', features: [] };
  const groups = chapters.map(({ id }) => {
    const segments = route.features.filter(({ properties }) => properties.chapterId === id)
      .flatMap((feature) => {
        const end = feature.geometry.coordinates.at(-1)?.join(',');
        const crossing = end && crossings.get(end);
        if (!crossing) return [feature];
        crossings.delete(end);
        return [feature, crossing];
      });
    let total = 0;
    const tracks = segments.map((feature) => {
      const order = ordered.features.length;
      const entry = { ...feature, properties: { ...feature.properties, order } };
      ordered.features.push(entry);
      const points = feature.geometry.coordinates;
      const distances = [0];
      for (let index = 1; index < points.length; index++) {
        distances.push(distances[index - 1] + distance(points[index - 1], points[index]));
      }
      const length = distances[distances.length - 1];
      const start = total;
      total += length;
      return { entry, start, distances, length };
    });
    return { tracks, total };
  });

  const first = ordered.features[0]?.geometry.coordinates[0];
  const last = ordered.features.at(-1)?.geometry.coordinates.at(-1);
  // Keep unmatched crossings from older data visible on the map.
  for (const feature of crossings.values()) {
    ordered.features.push({ ...feature, properties: { ...feature.properties, order: ordered.features.length } });
  }

  function reveal({ chapter, fraction }: ReadingPosition) {
    if (chapter < 0) return { order: 0, tip: first, partial: undefined };
    const group = groups[chapter];
    if (!group) return { order: ordered.features.length, tip: last, partial: undefined };

    const travelled = fraction * group.total;
    const track = group.tracks.findLast(({ start }) => start <= travelled);
    if (!track) return { order: 0, tip: first, partial: undefined };
    const { entry, start, distances, length } = track;
    const points = entry.geometry.coordinates;
    const local = travelled - start;
    if (local <= 0) return { order: entry.properties.order, tip: points[0], partial: undefined };
    if (local >= length) return { order: entry.properties.order + 1, tip: points.at(-1), partial: undefined };

    // Find the edge containing the reading position without walking the whole track on scroll.
    let low = 1;
    let high = distances.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (distances[middle] < local) low = middle + 1;
      else high = middle;
    }
    const a = points[low - 1];
    const b = points[low];
    const ratio = (local - distances[low - 1]) / (distances[low] - distances[low - 1]);
    const tip: Coordinates = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
    const partial: RouteFeature = { ...entry, geometry: { type: 'LineString', coordinates: [...points.slice(0, low), tip] } };
    return { order: entry.properties.order, tip, partial };
  }

  return { data: ordered, reveal };
}
