import type { MultiPoint } from 'geojson';
import type { ExpressionSpecification, FilterSpecification, LineLayerSpecification, StyleSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { RouteChapter, RouteData } from './route-data.js';

export const routeHitLayer = 'route-hit';
export const partialRouteSource = 'partial-route';
const sea = '#c2bbec';
const land = '#f7eba5';
const border = '#9d8760';
const label = '#4e3f5d';
const routeKinds = ['ride', 'official', 'ferry'] as const;
const unread = '#75627b';
const yellow = '#ffdf32';
const outline = '#61462a';

const kindFilter = (kind: string): ExpressionSpecification => ['==', ['get', 'kind'], kind];
export const completedRouteLayers = ['outline', ...routeKinds];

export function completedFilter(kind: string, order: number): FilterSpecification {
  return ['all', kindFilter(kind === 'outline' ? 'ride' : kind), ['<', ['get', 'order'], order]];
}

function routeLines(source: string, completed: boolean): LineLayerSpecification[] {
  const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
  const layers: LineLayerSpecification[] = routeKinds.map((kind) => ({
    id: source + '-' + kind,
    source: source === 'completed' ? 'route' : source,
    type: 'line',
    filter: source === 'completed' ? completedFilter(kind, 0) : kindFilter(kind),
    layout,
    paint: {
      'line-color': completed ? yellow : unread,
      'line-width': kind === 'ride' ? (completed ? 3.8 : 2.8) : (completed ? 3 : 2),
      ...(kind !== 'ride' && { 'line-dasharray': kind === 'ferry' ? [0.65, 2.25] : [2, 1.6] })
    }
  }));

  if (!completed) return layers;
  return [{
    id: source + '-outline',
    source: source === 'completed' ? 'route' : source,
    type: 'line',
    filter: source === 'completed' ? completedFilter('outline', 0) : kindFilter('ride'),
    layout,
    paint: { 'line-color': outline, 'line-width': 6 }
  }, ...layers];
}

export function atlasStyle(route: RouteData, chapters: RouteChapter[]): StyleSpecification {
  const placeName: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name']];
  const pinLocations: MultiPoint = {
    type: 'MultiPoint',
    coordinates: chapters.map(({ coordinates: [lon, lat] }) => [lon, lat])
  };
  const pinNames = chapters.map(({ pin }) => pin);
  const placeLayout: NonNullable<SymbolLayerSpecification['layout']> = {
    'text-field': placeName,
    'text-font': ['Noto Sans Regular']
  };

  return {
    version: 8,
    projection: { type: 'mercator' },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      basemap: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      route: { type: 'geojson', data: route },
      [partialRouteSource]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'arctic-circle': {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [-180, -90, 0, 90, 180].map((longitude) => [longitude, 66.56])
              }
            },
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [4, 66.56] }
            }
          ]
        }
      }
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': land } },
      {
        id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': sea }
      },
      {
        id: 'woodland', type: 'fill', source: 'basemap', 'source-layer': 'landcover', minzoom: 8,
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': '#bcbe7f', 'fill-opacity': 0.6 }
      },
      {
        id: 'waterways', type: 'line', source: 'basemap', 'source-layer': 'waterway', minzoom: 8,
        paint: { 'line-color': '#afa4cf', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2] }
      },
      {
        id: 'borders', type: 'line', source: 'basemap', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': border, 'line-width': 1, 'line-opacity': 0.75, 'line-dasharray': [3, 2] }
      },
      {
        id: 'major-roads', type: 'line', source: 'basemap', 'source-layer': 'transportation', minzoom: 6,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        paint: {
          'line-color': '#c0a46e',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 10, 1, 15, 3]
        }
      },
      {
        id: 'local-roads', type: 'line', source: 'basemap', 'source-layer': 'transportation', minzoom: 10,
        filter: ['match', ['get', 'class'], ['minor', 'service', 'track', 'path'], true, false],
        paint: { 'line-color': '#c5ad76', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 15, 1.6] }
      },
      {
        id: 'arctic-line', type: 'line', source: 'arctic-circle',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#776a91', 'line-opacity': 0.7, 'line-dasharray': [3, 4] }
      },
      {
        id: 'arctic-label', type: 'symbol', source: 'arctic-circle', minzoom: 2.4, maxzoom: 7,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': 'ARCTIC CIRCLE',
          'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-letter-spacing': 0.18, 'text-offset': [0, -0.9]
        },
        paint: { 'text-color': label, 'text-halo-color': sea, 'text-halo-width': 1 }
      },
      {
        id: 'countries', type: 'symbol', source: 'basemap', 'source-layer': 'place', maxzoom: 7,
        filter: ['==', ['get', 'class'], 'country'],
        layout: {
          ...placeLayout,
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 7, 13],
          'text-transform': 'uppercase', 'text-letter-spacing': 0.16, 'text-padding': 12
        },
        paint: { 'text-color': '#5c4b50', 'text-halo-color': land, 'text-halo-width': 1 }
      },
      {
        id: 'places', type: 'symbol', source: 'basemap', 'source-layer': 'place', minzoom: 5,
        filter: ['all',
          ['match', ['get', 'class'], ['city', 'town', 'village'], true, false],
          // Nearby chapter pins already label these places.
          ['!', ['all', ['in', placeName, ['literal', pinNames]], ['<', ['distance', pinLocations], 10_000]]]
        ],
        layout: { ...placeLayout, 'text-size': 12 },
        paint: { 'text-color': label, 'text-halo-color': land, 'text-halo-width': 1.4 }
      },
      ...routeLines('route', false),
      ...routeLines('completed', true),
      ...routeLines(partialRouteSource, true),
      // A wider invisible line makes route segments easier to select.
      {
        id: routeHitLayer, type: 'line', source: 'route',
        filter: ['!=', ['get', 'kind'], 'ferry'],
        paint: { 'line-width': 16, 'line-opacity': 0 }
      }
    ]
  };
}
