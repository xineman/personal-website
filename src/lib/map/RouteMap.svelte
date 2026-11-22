<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { asset } from '$app/paths';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import type { GeoJSONSource, JumpToOptions, LngLatBounds, Map as MapLibreMap, MapMouseEvent, MapTouchEvent, Marker } from 'maplibre-gl';
  import RidePopup from './RidePopup.svelte';
  import type { Coordinates, MapFraming, RouteChapter, RouteData, ScreenPoint } from './route-data.js';
  import { prepareRoute, type ReadingPosition } from './route-progress.js';
  import { atlasStyle, completedFilter, completedRouteLayers, inspectedRouteSource, partialRouteSource, routeHitLayer } from './map-style.js';
  import { rideSample, rideWindow, routeCoordinate, type RideData, type RideWindow, type RouteElevationData } from './ride-data.js';
  import { locateRidePoint, prepareRideCourse, rideCourseStretch, type RideCourse } from './ride-course.js';
  import { nearestRouteHit, type RouteHit } from './ride-inspection.js';

  type InspectionInput = 'hover' | 'pointer' | 'keyboard';
  type InspectionHit = RouteHit & { input: InspectionInput };
  type RideSelection = { order: number; distance: number; input: InspectionInput };
  type Inspection = RideSelection & { window: RideWindow; coordinate: Coordinates };

  interface Props {
    chapters: RouteChapter[];
    position: ReadingPosition;
    framing: MapFraming | undefined;
    scrollPosition: number;
    exploring: boolean;
    mapOnly: boolean;
    onExplore: (open: boolean, drag?: ScreenPoint) => void;
    onReturnCamera: (offset: ScreenPoint) => void;
    onChapter: (id: string) => void;
    onMapInteraction?: () => void;
    onMapReset?: () => void;
    ready: boolean;
  }

  let { chapters, position, framing, scrollPosition, exploring, mapOnly, onExplore, onReturnCamera, onChapter, onMapInteraction, onMapReset, ready = $bindable(false) }: Props = $props();
  let host: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let routeBounds: LngLatBounds;
  let course: ReturnType<typeof prepareRoute>;
  const pins: { id: string; marker: Marker }[] = [];
  let tip: Marker | undefined;
  let previousOrder = 0;
  let previousPosition: Pick<ReadingPosition, 'chapter' | 'fraction'> | undefined;
  let unavailable = $state(false);
  let basemapUnavailable = $state(false);
  let zoom = $state(0);
  let mode = false;
  let openingFromDrag = false;
  let followsStory = true;
  let switching = false;
  let switchSequence = 0;
  let readingView: { camera: JumpToOptions; follows: boolean } | undefined;
  let previousScroll: number | undefined;
  let previousFraming: MapFraming | undefined;
  let inspection = $state.raw<Inspection>();
  let rideCourse = $state.raw<RideCourse>();
  const recordings = new SvelteMap<number, RideData | 'loading' | 'failed'>();
  let loadReadings: ((order: number, retry: boolean) => Promise<void>) | undefined;
  let inspectionPoint = $state.raw<ScreenPoint>();
  let inspectionAnchor = $state.raw<ScreenPoint>();
  let inspectionPan = $state.raw<Coordinates>();
  let viewport = $state.raw({ width: 0, height: 0 });
  let profileSpan = 10_000;
  let highlighted: RideWindow | undefined;
  let inspectionNotice = $state('');
  let pendingInspection: InspectionHit | undefined;
  const minZoom = 0.5;
  const maxZoom = 16;
  const inspectedTrack = $derived(inspection && rideCourse?.tracks[inspection.order]);
  const dayDistance = $derived(inspection && inspectedTrack ? inspectedTrack.dayStart + inspection.distance - inspectedTrack.start : 0);
  const inspectedSample = $derived.by(() => {
    const recording = inspection && recordings.get(inspection.order);
    return typeof recording === 'object' ? rideSample(recording, dayDistance) : undefined;
  });

  function gesturePosition(event: MouseEvent | TouchEvent | undefined): ScreenPoint | undefined {
    if (event instanceof MouseEvent) return { x: event.clientX, y: event.clientY };
    const touches = event?.touches;
    if (!touches?.length) return;
    let x = 0;
    let y = 0;
    for (const touch of touches) {
      x += touch.clientX;
      y += touch.clientY;
    }
    return { x: x / touches.length, y: y / touches.length };
  }

  function framedCamera(panel?: MapFraming): JumpToOptions | undefined {
    if (!map || !host.clientWidth || !host.clientHeight) return;
    const small = host.clientHeight < 330;
    const padding = panel ? Math.max(0, (host.clientWidth - panel.width) / 2) : small ? 36 : 56;
    return map.cameraForBounds(routeBounds, {
      padding: { top: small ? 22 : 45, bottom: small ? 38 : 48, left: padding, right: padding },
      offset: panel ? [panel.center - host.clientWidth / 2, 0] : [0, 0],
      maxZoom
    });
  }

  function followReading(panel = framing) {
    if (!map || mode || !followsStory || switching) return;
    const target = framedCamera(panel);
    if (target) map.jumpTo(target);
  }

  function animateCamera(destination: (instance: MapLibreMap) => JumpToOptions | undefined, duration = 280) {
    if (!map) return;
    const instance = map;
    const sequence = ++switchSequence;
    switching = true;
    instance.stop();
    const target = destination(instance);

    function settled() {
      if (sequence !== switchSequence) return;
      switching = false;
      if (!mode) {
        readingView = undefined;
        requestAnimationFrame(() => followReading());
      }
    }

    if (!target) {
      settled();
      return;
    }
    instance.once('moveend', settled);
    instance.easeTo({ ...target, duration, easing: (t) => 1 - (1 - t) ** 3 });
  }

  function captureReadingView(instance: MapLibreMap) {
    return { camera: { center: instance.getCenter(), zoom: instance.getZoom() }, follows: followsStory };
  }

  function setMapMode(instance: MapLibreMap, open: boolean) {
    mode = open;
    instance.getCanvas().setAttribute('aria-label', open
      ? 'Route map. Use arrow keys to pan, plus or minus to zoom, and Enter to inspect the nearest route point.'
      : 'Route map. Use arrow keys to pan and plus or minus to zoom.');
    if (open) {
      instance.cooperativeGestures.disable();
      instance.scrollZoom.enable();
    } else {
      clearInspection();
      instance.cooperativeGestures.enable();
      instance.scrollZoom.disable();
      followsStory = readingView?.follows ?? true;
    }
  }

  function changeMode(open: boolean, panel: MapFraming | undefined) {
    if (!map || open === mode) return;
    if (open && openingFromDrag) {
      openingFromDrag = false;
      setMapMode(map, true);
      return;
    }
    // Fit the route as the map shrinks so the returning dock never paints the full-screen camera cropped.
    const returningToDock = !open && host.clientHeight < map.getCanvas().clientHeight;
    animateCamera((instance) => {
      if (open) readingView ??= captureReadingView(instance);
      setMapMode(instance, open);
      instance.resize();
      const target = readingView && !readingView.follows ? readingView.camera : framedCamera(open ? undefined : panel);
      if (!open && target?.center) {
        const from = instance.project(instance.getCenter());
        const to = instance.project(target.center);
        // Let the returning paper move with the map as the route comes back into view.
        onReturnCamera({ x: to.x - from.x, y: to.y - from.y });
      }
      return target;
    }, returningToDock ? 0 : undefined);
  }

  function syncReading(panel: MapFraming | undefined, scroll: number) {
    const scrolled = previousScroll !== undefined && scroll !== previousScroll;
    const reframed = previousScroll === undefined || panel !== previousFraming;
    previousScroll = scroll;
    previousFraming = panel;
    if (mode) return;
    if (scrolled && !followsStory) {
      followsStory = true;
      // Resume even when a short scroll leaves the reader in the same chapter.
      if (!switching) animateCamera(() => framedCamera(panel));
      return;
    }
    if (reframed) followReading(panel);
  }

  function changeZoom(direction: number) {
    if (!map) return;
    followsStory = false;
    if (mapOnly) onMapInteraction?.();
    map.easeTo({ zoom: map.getZoom() + direction, duration: 220 });
  }

  function fitRoute() {
    if (!map) return;
    followsStory = true;
    if (mapOnly) onMapReset?.();
    const target = framedCamera(mode ? undefined : framing);
    if (target) map.easeTo({ ...target, duration: 280 });
  }

  // Leaves map-only mode the way Escape does: close any pinned reading, refit the route, reveal the cover.
  export function returnToCover() {
    if (isInspectionPinned()) clearInspection(true);
    if (map) fitRoute();
    else onMapReset?.();
  }

  function updateMarkers(instance: MapLibreMap) {
    if (!host) return;
    zoom = instance.getZoom();
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (viewport.width !== width || viewport.height !== height) viewport = { width, height };
    for (const { marker } of pins) {
      const { x, y } = instance.project(marker.getLngLat());
      marker.getElement().inert = x < 0 || x > width || y < 0 || y > height;
    }
    projectInspection();
  }

  function isInViewport({ x, y }: ScreenPoint) {
    return x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height;
  }

  function projectInspection() {
    if (!map || !inspection) return;
    const point = map.project(inspection.coordinate);
    inspectionPoint = isInViewport(point) ? point : undefined;
    // Keep the popup anchored while the camera brings the marker back into view.
    if (inspectionPoint && !inspectionPan) inspectionAnchor = inspectionPoint;
  }

  function isInspectionPinned() {
    const selection = pendingInspection ?? inspection;
    return selection !== undefined && selection.input !== 'hover';
  }

  function clearInspection(restoreFocus = false) {
    pendingInspection = undefined;
    inspectionNotice = '';
    if (inspection) {
      inspection = undefined;
      inspectionPoint = undefined;
      inspectionAnchor = undefined;
      highlighted = undefined;
      map?.getSource<GeoJSONSource>(inspectedRouteSource)?.setData({ type: 'FeatureCollection', features: [] });
    }
    if (inspectionPan) {
      inspectionPan = undefined;
      map?.stop();
    }
    if (restoreFocus) map?.getCanvas().focus({ preventScroll: true });
  }

  function showInspection({ order, distance, input }: RideSelection) {
    if (!rideCourse) return;
    const previous = inspection;
    const window = rideWindow(rideCourse.elevation, distance, profileSpan, previous?.window);
    if (previous?.window === window && previous.distance === distance && previous.order === order && previous.input === input) return;

    const { feature, vertices } = rideCourse.tracks[order];
    inspection = {
      order, distance, input, window,
      coordinate: routeCoordinate(feature.geometry.coordinates, vertices, distance)
    };
    // Skip rebuilding map geometry until an endpoint has moved roughly a screen pixel.
    const pixel = (window.end - window.start) / Math.max(1, Math.min(viewport.width, viewport.height) * .65);
    if (!highlighted || (window !== highlighted &&
      (Math.abs(window.start - highlighted.start) >= pixel || Math.abs(window.end - highlighted.end) >= pixel))) {
      highlighted = window;
      map?.getSource<GeoJSONSource>(inspectedRouteSource)?.setData(rideCourseStretch(rideCourse, window));
    }
    projectInspection();
  }

  function scrubInspection(distance: number) {
    if (!inspection || inspection.input === 'hover' || !rideCourse) return;
    const position = locateRidePoint(rideCourse, distance);
    void loadReadings?.(position.order, false);
    showInspection({ ...position, input: inspection.input });
    revealInspectionPoint(true);
    return position.distance;
  }

  function resizeInspectionProfile() {
    if (!mode || !map || !viewport.width || !viewport.height) return;
    const { width, height } = viewport;
    const a = map.unproject([width / 2 - 16, height / 2]);
    const b = map.unproject([width / 2 + 16, height / 2]);
    const next = Math.max(500, a.distanceTo(b) / 32 * Math.min(width, height) * .65);
    if (next === profileSpan) return;
    profileSpan = next;
    if (inspection) showInspection(inspection);
  }

  function revealInspectionPoint(animate = false) {
    if (!map || !inspection || inspectionPan === inspection.coordinate) return;
    if (inspectionPan) {
      const point = inspectionPoint ?? map.project(inspection.coordinate);
      const offset = map.project(map.getCenter()).sub(map.project(inspectionPan));
      if (isInViewport({ x: point.x + offset.x, y: point.y + offset.y })) return;
    }
    if (inspectionPoint) {
      if (inspectionPan) map.stop();
      return;
    }
    const center = inspection.coordinate;
    if (!animate) {
      map.jumpTo({ center });
      return;
    }
    // An older pan can emit moveend while a new scrub target is taking over.
    inspectionPan = center;
    map.easeTo({ center, duration: 200, easing: (t) => t * t * (3 - 2 * t) }, { inspectionPan: center });
  }

  function showProgress(current: ReadingPosition) {
    if (!map || (current.chapter === previousPosition?.chapter && current.fraction === previousPosition.fraction)) return;
    previousPosition = { chapter: current.chapter, fraction: current.fraction };
    const { order, partial, tip: coordinate } = course.reveal(current);
    if (order !== previousOrder) {
      for (const kind of completedRouteLayers) map.setFilter('completed-' + kind, completedFilter(kind, order));
      previousOrder = order;
    }
    map.getSource<GeoJSONSource>(partialRouteSource)?.setData({
      type: 'FeatureCollection', features: partial ? [partial] : []
    });
    if (coordinate) tip?.setLngLat(coordinate);

    const active = chapters[Math.min(current.chapter, chapters.length - 1)]?.id;
    for (const { id, marker } of pins) {
      const element = marker.getElement();
      if (id === active) element.setAttribute('aria-current', 'location');
      else element.removeAttribute('aria-current');
    }
  }

  $effect(() => {
    if (!ready) return;
    const open = exploring || mapOnly;
    untrack(() => changeMode(open, framing));
  });

  // The flag can arrive after the map has loaded, so clear the reading marks it may have drawn.
  $effect(() => {
    if (!ready || !mapOnly) return;
    untrack(() => {
      for (const { marker } of pins) marker.remove();
      pins.length = 0;
      tip?.remove();
      tip = undefined;
    });
  });

  $effect(() => {
    if (!ready) return;
    const panel = framing;
    const scroll = scrollPosition;
    untrack(() => syncReading(panel, scroll));
  });

  $effect(() => {
    if (!ready) return;
    const current = position;
    untrack(() => showProgress(current));
  });

  onMount(() => {
    const controller = new AbortController();
    let observer: IntersectionObserver | undefined;
    let resize: ResizeObserver | undefined;
    let hoverFrame: number | undefined;

    async function start() {
      try {
        const [lib, worker, route] = await Promise.all([
          import('maplibre-gl').then(({ Map, LngLatBounds, Marker, setWorkerUrl }) => ({
            Map, LngLatBounds, Marker, setWorkerUrl
          })),
          import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
          fetch(asset('route.geojson'), { signal: controller.signal }).then((response) => {
            if (!response.ok) throw new Error('Route GeoJSON request failed');
            return response.json() as Promise<RouteData>;
          })
        ]);
        if (controller.signal.aborted) return;

        lib.setWorkerUrl(worker.default);
        course = prepareRoute(route, chapters);
        routeBounds = new lib.LngLatBounds();
        for (const { geometry: { coordinates } } of route.features) {
          for (const [lon, lat] of coordinates) routeBounds.extend([lon, lat]);
        }

        const instance = map = new lib.Map({
          container: host,
          // Chapter pins are hidden when the flag is on, so keep their place labels visible.
          style: atlasStyle(course.data, mapOnly ? [] : chapters),
          bounds: routeBounds,
          fitBoundsOptions: { padding: 24 },
          attributionControl: false,
          cooperativeGestures: true,
          scrollZoom: false,
          trackResize: false,
          dragRotate: false,
          touchPitch: false,
          pitchWithRotate: false,
          maxPitch: 0,
          maxZoom,
          minZoom
        });

        instance.keyboard.disableRotation();
        instance.touchZoomRotate.disableRotation();
        instance.getCanvas().setAttribute('aria-label', 'Route map. Use arrow keys to pan and plus or minus to zoom.');
        instance.on('error', (event) => {
          if (!('sourceId' in event)) return;
          if (event.sourceId === 'basemap') basemapUnavailable = true;
          if (event.sourceId === 'route') unavailable = true;
        });

        const routeQuery = { layers: [routeHitLayer] };
        const telemetryUrl = new URL('route-telemetry/', new URL(asset('route.geojson'), document.baseURI));
        const screenPaths = new Map<number, ScreenPoint[]>();
        let profileStatus: 'idle' | 'loading' | 'failed' = 'idle';

        function routeAt(point: MapMouseEvent['point']) {
          if (!instance.getLayer(routeHitLayer)) return;
          return instance.queryRenderedFeatures(point, routeQuery)[0]?.properties;
        }

        async function fetchTelemetry<T>(key: string): Promise<T> {
          const response = await fetch(new URL(key + '.json', telemetryUrl), { signal: controller.signal });
          if (!response.ok) throw new Error(`Ride telemetry request failed: ${key}`);
          return response.json();
        }

        function inspectAt(point: ScreenPoint, radius?: number) {
          if (!route.elevationProfile) return;
          const matches = radius === undefined ? instance.queryRenderedFeatures(routeQuery) : instance.queryRenderedFeatures(
            [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]], routeQuery
          );
          const orders = new Set<number>(matches.flatMap(({ properties: { order, telemetry, day } }) =>
            typeof order === 'number' && typeof telemetry === 'string' && typeof day === 'number' ? [order] : []
          ));
          return nearestRouteHit(point, orders, (order) => {
            let path = screenPaths.get(order);
            if (!path) {
              path = course.data.features[order].geometry.coordinates.map((coordinate) => instance.project(coordinate));
              screenPaths.set(order, path);
            }
            return path;
          }, radius ?? Infinity, radius === undefined ? viewport : undefined);
        }

        function displayInspection({ order, edge, fraction, input }: InspectionHit) {
          const vertices = rideCourse?.tracks[order]?.vertices;
          if (!vertices) return;
          const a = vertices[edge];
          const b = vertices[edge + 1];
          inspectionNotice = '';
          void loadReadings?.(order, input !== 'hover');
          showInspection({ order, distance: a + fraction * (b - a), input });
          if (input === 'keyboard') revealInspectionPoint();
        }

        async function inspect(hit: RouteHit, input: InspectionInput) {
          const profile = route.elevationProfile;
          if (!profile) return;
          const pinned = input !== 'hover';
          if (pinned && inspectionPan) instance.stop();
          if (pinned && inspection && inspection.order !== hit.order) clearInspection();
          if (!inspection && !pendingInspection) resizeInspectionProfile();
          const selection = { ...hit, input };
          if (rideCourse) {
            displayInspection(selection);
            return;
          }
          if (profileStatus === 'failed' && !pinned) return;
          pendingInspection = selection;
          if (pinned) inspectionNotice = 'Loading elevation profile…';
          if (profileStatus === 'loading') return;
          profileStatus = 'loading';

          try {
            const data = await fetchTelemetry<RouteElevationData>(profile);
            if (controller.signal.aborted) return;
            rideCourse = prepareRideCourse(course.data, data);
            profileStatus = 'idle';
          } catch {
            if (controller.signal.aborted) return;
            profileStatus = 'failed';
            if (isInspectionPinned()) {
              inspectionNotice = 'Elevation profile couldn’t load. Select the route to retry.';
            }
          }

          const pending = pendingInspection;
          pendingInspection = undefined;
          if (rideCourse && pending) displayInspection(pending);
        }

        loadReadings = async (order, retry) => {
          const feature = course.data.features[order];
          const key = feature.properties.telemetry;
          const cached = recordings.get(order);
          if (!key || (cached && !(cached === 'failed' && retry))) return;
          recordings.set(order, 'loading');
          try {
            const recording = await fetchTelemetry<RideData>(key);
            if (controller.signal.aborted) return;
            if (!Array.isArray(recording.vertices) || recording.vertices.length !== feature.geometry.coordinates.length ||
              !Array.isArray(recording.samples) || recording.samples.length < 2) throw new Error('Ride data does not match the track');
            recordings.set(order, recording);
          } catch {
            if (!controller.signal.aborted) recordings.set(order, 'failed');
          }
        };

        let hoverPoint: ScreenPoint | undefined;
        function stopHover() {
          hoverPoint = undefined;
          if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
          hoverFrame = undefined;
        }

        instance.once('load', () => {
          if (!mapOnly) {
            for (const [index, chapter] of chapters.entries()) {
              const link = document.createElement('a');
              link.className = 'chapter-pin';
              link.classList.toggle('chapter-pin--endpoint', index === 0 || index === chapters.length - 1);
              link.dataset.labelSide = index === 0 ? 'right' : chapter.labelSide;
              link.href = '#' + chapter.id;
              link.setAttribute('aria-label', `${chapter.pin}, ${chapter.title}`);

              const disc = document.createElement('span');
              disc.className = 'chapter-pin__disc';
              const label = document.createElement('span');
              label.className = 'chapter-pin__label';
              label.textContent = chapter.pin;
              link.appendChild(disc);
              link.appendChild(label);

              link.addEventListener('click', (event) => {
                if (event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                onChapter(chapter.id);
              });

              const [lon, lat] = chapter.coordinates;
              const marker = new lib.Marker({ element: link }).setLngLat([lon, lat]).addTo(instance);
              pins.push({ id: chapter.id, marker });
            }

            const coordinate = course.reveal(position).tip;
            if (coordinate) {
              const element = document.createElement('span');
              element.className = 'route-tip';
              element.setAttribute('aria-hidden', 'true');
              tip = new lib.Marker({ element }).setLngLat(coordinate).addTo(instance);
            }
          }

          instance.on('mousemove', (event) => {
            const overLink = (event.originalEvent.target as Element).closest('a');
            if (!mode) {
              instance.getCanvas().style.cursor = !overLink && routeAt(event.point)?.chapterId ? 'pointer' : '';
              return;
            }
            if (isInspectionPinned() || instance.isMoving()) return;
            if (overLink) {
              stopHover();
              clearInspection();
              return;
            }
            hoverPoint = event.point;
            hoverFrame ??= requestAnimationFrame(() => {
              hoverFrame = undefined;
              if (!hoverPoint || !mode || isInspectionPinned() || instance.isMoving()) return;
              const hit = inspectAt(hoverPoint, 9);
              instance.getCanvas().style.cursor = hit ? 'crosshair' : '';
              if (hit) void inspect(hit, 'hover');
              else clearInspection();
            });
          });
          instance.on('mouseout', () => {
            stopHover();
            if (!isInspectionPinned()) clearInspection();
          });
          instance.on('click', (event) => {
            if ((event.originalEvent.target as Element).closest('a')) return;
            if (mode) {
              stopHover();
              const hit = inspectAt(event.point, 16);
              if (hit) {
                void inspect(hit, 'pointer');
                return;
              }
              clearInspection();
            }
            const feature = routeAt(event.point);
            if (mode && feature?.telemetry && route.elevationProfile) return;
            if (feature?.chapterId) onChapter(feature.chapterId);
          });

          document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && mapOnly) {
              // Same contract as story mode: Escape leaves the map and puts the cover back.
              event.preventDefault();
              event.stopPropagation();
              if (isInspectionPinned()) {
                clearInspection(true);
                return;
              }
              returnToCover();
              return;
            }
            if (!mode) return;
            if (event.key === 'Escape' && isInspectionPinned()) {
              event.preventDefault();
              event.stopPropagation();
              clearInspection(true);
            }
            if (event.key === 'Enter' && event.target === instance.getCanvas()) {
              const hit = inspectAt({ x: viewport.width / 2, y: viewport.height / 2 });
              if (!hit) return;
              event.preventDefault();
              void inspect(hit, 'keyboard');
            }
          }, { signal: controller.signal });

          updateMarkers(instance);
          if (!unavailable) ready = true;
        });

        followReading();
        instance.on('movestart', (event) => {
          if (event.originalEvent) followsStory = false;
          // In map-only mode the cover card would otherwise sit on top of the area being panned.
          if (mapOnly && event.originalEvent) onMapInteraction?.();
          stopHover();
          if (!isInspectionPinned()) clearInspection();
        });
        instance.on('move', () => {
          screenPaths.clear();
          updateMarkers(instance);
        });
        instance.on('moveend', (event) => {
          if (inspectionPan) {
            if (!('inspectionPan' in event) || event.inspectionPan !== inspectionPan) return;
            inspectionPan = undefined;
          }
          if (inspection && inspection.input !== 'hover' && !inspectionPoint) clearInspection();
        });
        instance.on('zoom', resizeInspectionProfile);

        let beforeDrag: typeof readingView;
        let dragOrigin: ScreenPoint | undefined;
        let panning = false;
        let resizePending = false;
        function resizeMap() {
          if (controller.signal.aborted) return;
          // MapLibre can cancel the current pan when the dock expands to fill the viewport.
          resizePending = panning;
          if (resizePending) return;
          instance.resize();
          followReading();
          updateMarkers(instance);
          resizeInspectionProfile();
        }

        function prepareDrag({ originalEvent }: MapMouseEvent | MapTouchEvent) {
          if (exploring || mapOnly) return;
          beforeDrag = captureReadingView(instance);
          dragOrigin = gesturePosition(originalEvent);
        }

        instance.on('mousedown', prepareDrag);
        instance.on('touchstart', prepareDrag);
        instance.on('dragstart', ({ originalEvent }) => {
          panning = true;
          if (exploring || mapOnly) return;
          readingView ??= beforeDrag;
          openingFromDrag = true;
          const current = gesturePosition(originalEvent);
          onExplore(true, dragOrigin && current && {
            x: current.x - dragOrigin.x,
            y: current.y - dragOrigin.y
          });
        });
        instance.on('dragend', () => {
          panning = false;
          if (resizePending) queueMicrotask(resizeMap);
        });
        resize = new ResizeObserver(resizeMap);
        resize.observe(host);
      } catch {
        if (!controller.signal.aborted) unavailable = true;
      }
    }

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        observer?.disconnect();
        void start();
      }, { rootMargin: '160px' });
      observer.observe(host);
    } else {
      void start();
    }

    return () => {
      controller.abort();
      if (hoverFrame !== undefined) cancelAnimationFrame(hoverFrame);
      observer?.disconnect();
      resize?.disconnect();
      for (const { marker } of pins) marker.remove();
      tip?.remove();
      map?.remove();
      map = undefined;
    };
  });
</script>

<div class="map-host" class:exploring bind:this={host} inert={!ready} aria-label="Route from Rovereto to North Cape"></div>

{#if ready}
  <div class="map-controls" class:inspecting={(exploring || mapOnly) && !!inspection && !!(inspectionPoint || inspectionPan)} role="group" aria-label="Map controls">
    <button type="button" aria-label="Zoom in" title="Zoom in" onclick={() => changeZoom(1)} disabled={zoom >= maxZoom}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
    </button>
    <button type="button" aria-label="Zoom out" title="Zoom out" onclick={() => changeZoom(-1)} disabled={zoom <= minZoom}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
    </button>
    <button type="button" aria-label="Fit the whole route" title="Fit the whole route" onclick={fitRoute}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H5v4m10-4h4v4M5 15v4h4m10-4v4h-4"/></svg>
    </button>
  </div>
  {#if basemapUnavailable}
    <p class="basemap-status" role="status">Some map detail couldn’t load.</p>
  {/if}
  <div class="attribution">
    <a href="https://openfreemap.org/">OpenFreeMap</a>
    <span aria-hidden="true">·</span>
    <a href="https://www.openmaptiles.org/">© OpenMapTiles</a>
    <span aria-hidden="true">·</span>
    <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>
  </div>
  {#if (exploring || mapOnly) && inspection && inspectionAnchor && (inspectionPoint || inspectionPan) && rideCourse && inspectedTrack}
    <RidePopup day={inspectedTrack.feature.properties.day} kind={inspectedTrack.feature.properties.kind}
      {dayDistance} sample={inspectedSample} distance={inspection.distance} window={inspection.window} routeElevation={rideCourse.elevation}
      point={inspectionPoint} anchor={inspectionAnchor} {viewport} pinned={inspection.input !== 'hover'} keyboard={inspection.input === 'keyboard'}
      onClear={() => clearInspection(true)} onScrub={scrubInspection} />
  {/if}
  {#if (exploring || mapOnly) && inspectionNotice}
    <p class="inspection-notice" role="status">{inspectionNotice}</p>
  {/if}
{:else}
  <p class="map-status" role="status">
    {#if unavailable}
      The map couldn’t load. <a href="#chapters">Browse the chapters.</a>
    {:else}
      Loading route map…
    {/if}
  </p>
{/if}

<style>
  .map-host { position: absolute; inset: 0; background: var(--color-map-water); pointer-events: auto; }
  .map-host :global(.maplibregl-canvas) { cursor: grab; }
  .map-host :global(.maplibregl-canvas:active) { cursor: grabbing; }
  .map-host :global(.maplibregl-canvas:focus-visible) { outline-offset: -4px; }
  .map-host :global(.maplibregl-cooperative-gesture-screen) { font-family: var(--font-ui); }
  .map-host :global(.chapter-pin) {
    position: absolute;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    color: var(--color-ink);
    text-decoration: none;
  }
  .map-host :global(.chapter-pin:hover),
  .map-host :global(.chapter-pin:focus-visible),
  .map-host :global(.chapter-pin[aria-current]) { z-index: 1; }
  .map-host :global(.chapter-pin:focus-visible) { border-radius: 50%; outline-offset: -2px; }
  .map-host :global(.chapter-pin__disc),
  .map-host :global(.route-tip) {
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--color-ink);
    border-radius: 50%;
    background: var(--color-paper);
  }
  .map-host :global(.chapter-pin:is(:hover, :focus-visible, [aria-current]) .chapter-pin__disc) {
    background: var(--color-route);
    border-width: 2px;
  }
  .map-host :global(.route-tip) { width: 12px; height: 12px; background: var(--color-route); pointer-events: none; }
  .map-host :global(.chapter-pin__label) {
    position: absolute;
    left: calc(50% + 8px);
    font: 750 .8rem/1.2 var(--font-ui);
    white-space: nowrap;
    paint-order: stroke fill;
    -webkit-text-stroke: 3px var(--color-paper);
  }
  .map-host :global(.chapter-pin[data-label-side='left'] .chapter-pin__label) { left: auto; right: calc(50% + 8px); }

  .map-controls {
    position: absolute;
    right: 1.25rem;
    bottom: 5.5rem;
    display: grid;
    border: 1px solid var(--color-ink);
    background: var(--color-paper);
    pointer-events: auto;
  }
  .map-controls button {
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    border: 0;
    padding: 0;
    background: none;
    color: var(--color-ink);
    cursor: pointer;
  }
  .map-controls button + button { border-top: 1px solid var(--color-ink); }
  .map-controls button:hover:not(:disabled) { background: var(--color-route); }
  .map-controls button:disabled { opacity: .5; cursor: default; }
  .map-controls button:focus-visible { outline-offset: -4px; }
  .map-controls svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .attribution, .map-status, .basemap-status {
    position: absolute;
    background: var(--color-paper);
    padding: .25rem .45rem;
  }
  .attribution {
    right: .55rem;
    bottom: .2rem;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: .12rem .32rem;
    font: 550 .64rem/1.35 var(--font-ui);
    pointer-events: auto;
  }
  .attribution a { text-decoration: none; }
  .attribution a:hover { text-decoration: underline; }
  .attribution a:focus-visible { outline-offset: 1px; }
  .map-status, .basemap-status { right: .65rem; max-width: 11rem; font-size: .78rem; pointer-events: auto; }
  .map-status { top: 1.35rem; }
  .basemap-status { top: 11rem; }
  .inspection-notice {
    position: absolute; z-index: 1; bottom: 5.5rem; left: var(--edge); max-width: min(20rem, 72vw);
    padding: .4rem .6rem; background: var(--color-paper); font-size: .76rem; font-weight: 640;
  }

  @media (min-width: 1181px) {
    :global(.atlas.panel-right:not(.exploring)) .attribution { right: auto; left: .55rem; }
  }

  @media (max-width: 1060px) {
    .map-controls { right: .55rem; bottom: 4.8rem; }
    .map-controls button { width: 2.4rem; height: 2.4rem; }
    .map-host:not(.exploring) :global(.chapter-pin:not(.chapter-pin--endpoint):not([aria-current]):not(:focus-visible) .chapter-pin__label) { display: none; }
    .map-host :global(.chapter-pin__label) { font-size: .72rem; }
    .map-status { top: .55rem; }
    .basemap-status { inset: 4.5rem auto auto .55rem; max-width: 8rem; }
  }

  @media (max-width: 360px) {
    .map-controls.inspecting { top: 3.4rem; bottom: auto; display: flex; }
    .map-controls.inspecting button + button { border-top: 0; border-left: 1px solid var(--color-ink); }
  }
</style>
