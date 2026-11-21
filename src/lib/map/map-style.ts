import type { MultiPoint } from 'geojson';
import type { DataDrivenPropertyValueSpecification, ExpressionSpecification, StyleSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { RouteChapter, RouteData } from './route-data.js';

export const routeLayers = ['gpx-track', 'official-course'];
export const routeHitLayer = 'route-hit';
const routeColor = '#ff806f';
const ferryColor = '#b6bfda';
const sea = '#151e34';
const land = '#26344e';
const border = '#536380';
const label = '#bac5de';

export function routeEmphasis(
  activeId: string | null,
  hoveredId: string | null,
  emphasis: number,
  normal: number
): DataDrivenPropertyValueSpecification<number> {
  return ['case',
    ['==', ['get', 'chapterId'], hoveredId ?? ''], emphasis,
    ['==', ['get', 'chapterId'], activeId ?? ''], emphasis,
    normal
  ];
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
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      basemap: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      route: { type: 'geojson', data: route },
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
        paint: { 'fill-color': '#223c45', 'fill-opacity': 0.6 }
      },
      {
        id: 'waterways', type: 'line', source: 'basemap', 'source-layer': 'waterway', minzoom: 8,
        paint: { 'line-color': '#17233a', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2] }
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
          'line-color': '#56627c',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 10, 1, 15, 3]
        }
      },
      {
        id: 'local-roads', type: 'line', source: 'basemap', 'source-layer': 'transportation', minzoom: 10,
        filter: ['match', ['get', 'class'], ['minor', 'service', 'track', 'path'], true, false],
        paint: { 'line-color': '#434f68', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 15, 1.6] }
      },
      {
        id: 'arctic-line', type: 'line', source: 'arctic-circle',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#8191b1', 'line-opacity': 0.7, 'line-dasharray': [3, 4] }
      },
      {
        id: 'arctic-label', type: 'symbol', source: 'arctic-circle', maxzoom: 7,
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
        paint: { 'text-color': '#9caed0', 'text-halo-color': land, 'text-halo-width': 1 }
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
      {
        id: 'ferries', type: 'line', source: 'route',
        filter: ['==', ['get', 'kind'], 'ferry'],
        paint: { 'line-color': ferryColor, 'line-width': 1.6, 'line-dasharray': [2, 3] }
      },
      {
        id: 'track-outline', type: 'line', source: 'route',
        filter: ['==', ['get', 'kind'], 'ride'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#11182b', 'line-width': 5, 'line-opacity': 0.8 }
      },
      {
        id: routeLayers[0], type: 'line', source: 'route',
        filter: ['==', ['get', 'kind'], 'ride'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': routeColor, 'line-width': 2.6 }
      },
      {
        id: routeLayers[1], type: 'line', source: 'route',
        filter: ['==', ['get', 'kind'], 'official'],
        paint: { 'line-color': routeColor, 'line-width': 2.6, 'line-dasharray': [2, 1.6] }
      },
      {
        id: routeHitLayer, type: 'line', source: 'route',
        filter: ['!=', ['get', 'kind'], 'ferry'],
        paint: { 'line-width': 16, 'line-opacity': 0 }
      }
    ]
  };
}
