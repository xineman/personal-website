<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { asset } from '$app/paths';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import type { GeoJSONSource, JumpToOptions, LngLatBounds, Map as MapLibreMap, MapMouseEvent, Marker } from 'maplibre-gl';
  import type { MapFraming, RouteChapter, RouteData } from './route-data.js';
  import { prepareRoute, type ReadingPosition } from './route-progress.js';
  import { atlasStyle, completedFilter, completedRouteLayers, partialRouteSource, routeHitLayer } from './map-style.js';

  interface Props {
    chapters: RouteChapter[];
    position: ReadingPosition;
    framing: MapFraming | undefined;
    scrollPosition: number;
    exploring: boolean;
    onChapter: (id: string) => void;
    ready: boolean;
  }

  let { chapters, position, framing, scrollPosition, exploring, onChapter, ready = $bindable(false) }: Props = $props();
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
  let followsStory = true;
  let switching = false;
  let switchSequence = 0;
  let readingView: { camera: JumpToOptions; follows: boolean } | undefined;
  let previousScroll: number | undefined;
  let previousFraming: MapFraming | undefined;
  const minZoom = 0.5;
  const maxZoom = 16;

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

  function animateCamera(destination: (instance: MapLibreMap) => JumpToOptions | undefined) {
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
    instance.easeTo({ ...target, duration: 280, easing: (t) => 1 - (1 - t) ** 3 });
  }

  function changeMode(open: boolean, panel: MapFraming | undefined) {
    if (open === mode) return;
    animateCamera((instance) => {
      if (open && !readingView) {
        readingView = { camera: { center: instance.getCenter(), zoom: instance.getZoom() }, follows: followsStory };
      }
      mode = open;
      instance.resize();
      if (open) {
        instance.cooperativeGestures.disable();
        instance.scrollZoom.enable();
      } else {
        instance.cooperativeGestures.enable();
        instance.scrollZoom.disable();
        followsStory = readingView?.follows ?? true;
      }
      return readingView && !readingView.follows ? readingView.camera : framedCamera(open ? undefined : panel);
    });
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
    map.easeTo({ zoom: map.getZoom() + direction, duration: 220 });
  }

  function fitRoute() {
    if (!map) return;
    followsStory = true;
    const target = framedCamera(mode ? undefined : framing);
    if (target) map.easeTo({ ...target, duration: 280 });
  }

  function updateMarkers(instance: MapLibreMap) {
    zoom = instance.getZoom();
    for (const { marker } of pins) {
      const { x, y } = instance.project(marker.getLngLat());
      marker.getElement().inert = x < 0 || x > host.clientWidth || y < 0 || y > host.clientHeight;
    }
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
    const open = exploring;
    untrack(() => changeMode(open, framing));
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
          style: atlasStyle(course.data, chapters),
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

        const chapterAt = (event: MapMouseEvent) => {
          if ((event.originalEvent.target as Element).closest('a') || !instance.getLayer(routeHitLayer)) return null;
          return instance.queryRenderedFeatures(event.point, { layers: [routeHitLayer] })[0]?.properties.chapterId ?? null;
        };

        instance.once('load', () => {
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

          instance.on('mousemove', (event) => {
            instance.getCanvas().style.cursor = chapterAt(event) ? 'pointer' : '';
          });
          instance.on('click', (event) => {
            const id = chapterAt(event);
            if (id) onChapter(id);
          });

          updateMarkers(instance);
          if (!unavailable) ready = true;
        });

        followReading();
        instance.on('movestart', (event) => {
          if (event.originalEvent) followsStory = false;
        });
        instance.on('move', () => updateMarkers(instance));
        resize = new ResizeObserver(() => {
          instance.resize();
          followReading();
          updateMarkers(instance);
        });
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
  <div class="map-controls" role="group" aria-label="Map controls">
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
</style>
