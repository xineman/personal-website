<script lang="ts">
  import { onMount } from 'svelte';
  import { asset } from '$app/paths';
  import type { FitBoundsOptions, LngLatBounds, Map as MapLibreMap, MapMouseEvent, Marker } from 'maplibre-gl';
  import type { RouteChapter, RouteData } from './route-data.js';
  import { atlasStyle, routeEmphasis, routeHitLayer, routeLayers } from './map-style.js';

  interface Props {
    chapters: RouteChapter[];
    activeId: string | null;
  }

  let { chapters, activeId }: Props = $props();
  let stage: HTMLDivElement;
  let host: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let routeBounds: LngLatBounds;
  const chapterBounds = new Map<string, LngLatBounds>();
  let cameraBounds: LngLatBounds | undefined;
  let lastChapterId: string | null = null;
  let markers: { id: string; marker: Marker }[] = [];
  let ready = $state(false);
  let unavailable = $state(false);
  let basemapUnavailable = $state(false);
  let hoveredId = $state<string | null>(null);
  let zoom = $state(0);
  const maxZoom = 16;

  const overviewPadding = { top: 29, right: 60, bottom: 48, left: 60 };
  const chapterPadding = { top: 42, right: 82, bottom: 56, left: 82 };

  function fitMap(bounds: LngLatBounds, animate: boolean) {
    cameraBounds = bounds;
    const overview = bounds === routeBounds;
    const options: FitBoundsOptions = {
      padding: overview ? overviewPadding : chapterPadding,
      maxZoom: overview ? maxZoom : 8,
      linear: true,
      animate,
      duration: 450
    };
    map?.fitBounds(bounds, options);
  }

  function changeZoom(direction: number) {
    if (!map) return;
    cameraBounds = undefined;
    map.easeTo({ zoom: map.getZoom() + direction, duration: 240 });
  }

  function updateMarkers(instance: MapLibreMap) {
    zoom = instance.getZoom();
    const { clientWidth, clientHeight } = host;
    for (const { marker } of markers) {
      const { x, y } = instance.project(marker.getLngLat());
      marker.getElement().inert = x < 0 || x > clientWidth || y < 0 || y > clientHeight;
    }
  }

  $effect(() => {
    if (!ready || activeId === lastChapterId) return;
    lastChapterId = activeId;
    const bounds = (activeId && chapterBounds.get(activeId)) || routeBounds;
    const { top, bottom } = stage.getBoundingClientRect();
    fitMap(bounds, bottom > 0 && top < window.innerHeight);
  });

  $effect(() => {
    if (!ready || !map) return;
    for (const layer of routeLayers) {
      map.setPaintProperty(layer, 'line-width', routeEmphasis(activeId, hoveredId, 4, 2.6));
      map.setPaintProperty(layer, 'line-opacity', routeEmphasis(activeId, hoveredId, 1, activeId ? 0.62 : 1));
    }
    for (const { id, marker } of markers) {
      const link = marker.getElement();
      if (id === activeId) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
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
          fetch(asset('route.geojson'), { signal: controller.signal }).then(async (response) => {
            if (!response.ok) throw new Error('Route GeoJSON request failed');
            return await response.json() as RouteData;
          })
        ]);
        if (controller.signal.aborted) return;

        lib.setWorkerUrl(worker.default);
        routeBounds = new lib.LngLatBounds();
        cameraBounds = routeBounds;
        for (const { id, coordinates: [lon, lat] } of chapters) {
          chapterBounds.set(id, new lib.LngLatBounds([lon, lat], [lon, lat]));
          routeBounds.extend([lon, lat]);
        }
        for (const { geometry, properties } of route.features) {
          const bounds = properties.chapterId ? chapterBounds.get(properties.chapterId) : undefined;
          for (const [lon, lat] of geometry.coordinates) {
            routeBounds.extend([lon, lat]);
            bounds?.extend([lon, lat]);
          }
        }

        const instance = map = new lib.Map({
          container: host,
          style: atlasStyle(route, chapters),
          bounds: routeBounds,
          fitBoundsOptions: { padding: overviewPadding },
          attributionControl: false,
          cooperativeGestures: true,
          dragRotate: false,
          touchPitch: false,
          pitchWithRotate: false,
          maxPitch: 0,
          maxZoom,
          minZoom: 1,
          renderWorldCopies: false
        });

        instance.keyboard.disableRotation();
        instance.touchZoomRotate.disableRotation();
        instance.on('error', (event) => {
          if ('sourceId' in event && event.sourceId === 'basemap') basemapUnavailable = true;
          if ('sourceId' in event && event.sourceId === 'route') {
            ready = false;
            unavailable = true;
          }
        });

        const chapterAt = (event: MapMouseEvent) => {
          if ((event.originalEvent.target as Element).closest('a') || !instance.getLayer(routeHitLayer)) return null;
          return instance.queryRenderedFeatures(event.point, { layers: [routeHitLayer] })[0]?.properties.chapterId ?? null;
        };

        instance.once('load', () => {
          for (const [index, chapter] of chapters.entries()) {
            const link = document.createElement('a');
            link.className = 'chapter-pin';
            link.dataset.labelSide = chapter.labelSide;
            link.href = '#' + chapter.id;
            link.setAttribute('aria-label', `Chapter ${index + 1}, ${chapter.title} via ${chapter.pin}`);

            const disc = document.createElement('span');
            disc.className = 'chapter-pin__disc';
            disc.textContent = chapter.number;
            disc.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'chapter-pin__label';
            label.textContent = chapter.pin;
            label.setAttribute('aria-hidden', 'true');
            link.appendChild(disc);
            link.appendChild(label);

            link.addEventListener('pointerenter', () => hoveredId = chapter.id);
            link.addEventListener('pointerleave', () => hoveredId = null);
            link.addEventListener('focus', () => hoveredId = chapter.id);
            link.addEventListener('blur', () => hoveredId = null);

            const [lon, lat] = chapter.coordinates;
            const marker = new lib.Marker({ element: link }).setLngLat([lon, lat]).addTo(instance);
            markers.push({ id: chapter.id, marker });
          }

          instance.on('mousemove', (event) => {
            const target = event.originalEvent.target as Element;
            if (target.closest('.chapter-pin')) return;
            hoveredId = chapterAt(event);
            instance.getCanvas().style.cursor = hoveredId ? 'pointer' : '';
          });
          instance.getCanvas().addEventListener('mouseleave', () => {
            hoveredId = null;
            instance.getCanvas().style.cursor = '';
          });
          instance.on('click', (event) => {
            const id = chapterAt(event);
            if (id) window.location.hash = id;
          });

          updateMarkers(instance);
          ready = !unavailable;
        });

        instance.on('movestart', (event) => {
          if (event.originalEvent) cameraBounds = undefined;
        });
        instance.on('move', () => updateMarkers(instance));
        resize = new ResizeObserver(() => {
          instance.resize();
          if (cameraBounds) fitMap(cameraBounds, false);
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
      observer.observe(stage);
    } else {
      void start();
    }

    return () => {
      controller.abort();
      observer?.disconnect();
      resize?.disconnect();
      for (const { marker } of markers) marker.remove();
      map?.remove();
    };
  });
</script>

<div class="map-stage" bind:this={stage}>
  <div
    class="map-host"
    bind:this={host}
    inert={!ready}
    role="region"
    aria-label="Interactive route map from Rovereto to North Cape"
  ></div>

  {#if ready}
    <div class="map-controls" role="group" aria-label="Map controls">
      <button type="button" aria-label="Zoom in" title="Zoom in" onclick={() => changeZoom(1)} disabled={zoom >= maxZoom}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <button type="button" aria-label="Zoom out" title="Zoom out" onclick={() => changeZoom(-1)} disabled={zoom <= 1}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>
      </button>
      <button type="button" aria-label="Fit the whole route" title="Fit the whole route" onclick={() => fitMap(routeBounds, true)}>
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
      <a href="https://www.openstreetmap.org/copyright">Data from OpenStreetMap</a>
    </div>
  {:else}
    <p class="map-status map-status--pending" role="status">
      {unavailable ? 'The map couldn’t load. Use the chapter links below.' : 'Loading route map…'}
    </p>
    <noscript><p class="map-status">Use the chapter links below to follow the route.</p></noscript>
  {/if}
</div>

<style>
  .map-stage {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    height: clamp(16.5rem, calc(100svh - 17rem), 37.5rem);
    background: #151e34;
  }
  .map-host { position: absolute; inset: 0; overflow: hidden; touch-action: pan-x pan-y; }
  /* MapLibre creates these elements at runtime. Keep its required styles inside this map. */
  .map-host :global(.maplibregl-canvas) { position: absolute; inset: 0; cursor: grab; }
  .map-host :global(.maplibregl-canvas:active) { cursor: grabbing; }
  .map-host :global(.maplibregl-canvas:focus-visible) { outline-offset: -3px; }
  .map-host :global(.maplibregl-cooperative-gesture-screen) {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgb(17 24 43 / 85%);
    color: var(--color-white);
    font-size: .9rem;
    text-align: center;
    opacity: 0;
    transition: opacity 180ms;
    pointer-events: none;
    z-index: 2;
  }
  .map-host :global(.maplibregl-cooperative-gesture-screen.maplibregl-show) { opacity: 1; }
  .map-host :global(.maplibregl-mobile-message) { display: none; }
  .map-host :global(.chapter-pin) {
    position: absolute;
    top: 0;
    left: 0;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    color: var(--color-white);
    text-decoration: none;
  }
  .map-host :global(.chapter-pin:hover),
  .map-host :global(.chapter-pin:focus-visible),
  .map-host :global(.chapter-pin[aria-current]) { z-index: 1; }
  .map-host :global(.chapter-pin:focus-visible) { border-radius: 50%; outline-offset: -2px; }
  .map-host :global(.chapter-pin__disc) {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 2px solid var(--color-route);
    border-radius: 50%;
    background: var(--color-ink);
    font: 700 .68rem/1 var(--font-ui);
    font-variant-numeric: tabular-nums;
  }
  .map-host :global(.chapter-pin:is(:hover, :focus-visible, [aria-current]) .chapter-pin__disc) {
    color: var(--color-ink);
    background: var(--color-route);
  }
  .map-host :global(.chapter-pin__label) {
    position: absolute;
    left: 100%;
    padding: .15rem .28rem;
    background: var(--color-ink);
    color: var(--color-white);
    border-radius: 3px;
    font: 650 .72rem/1.2 var(--font-ui);
    white-space: nowrap;
  }
  .map-host :global(.chapter-pin[data-label-side='left'] .chapter-pin__label) { left: auto; right: 100%; }

  .map-controls {
    --control-size: 34px;
    --control-target: var(--control-size);
    position: absolute;
    z-index: 1;
    top: .65rem;
    right: .65rem;
    display: grid;
    gap: 4px;
  }
  .map-controls button {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--control-target);
    height: var(--control-target);
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--color-white);
    cursor: pointer;
  }
  .map-controls button::before {
    content: '';
    position: absolute;
    width: var(--control-size);
    height: var(--control-size);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-ink);
  }
  .map-controls button:hover:not(:disabled) { color: var(--color-route); }
  .map-controls button:disabled { color: var(--color-muted); cursor: default; }
  .map-controls button:focus-visible { outline: none; }
  .map-controls button:focus-visible::before { outline: 2px solid currentColor; outline-offset: -3px; }
  .map-controls svg {
    position: relative;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (pointer: coarse) {
    .map-controls { --control-target: 44px; gap: 0; }
  }

  .attribution {
    position: absolute;
    right: 0;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: .1rem .32rem;
    padding: .25rem .5rem;
    background: var(--color-ink);
    color: var(--color-muted);
    font-size: .64rem;
    line-height: 1.35;
  }
  .attribution a { text-decoration: none; }
  .attribution a:hover { text-decoration: underline; }
  .attribution a:focus-visible { outline-offset: 1px; }
  .map-status {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1rem;
    color: var(--color-muted);
    font-size: .88rem;
    text-align: center;
    pointer-events: none;
  }
  .basemap-status {
    position: absolute;
    bottom: 1.65rem;
    left: .65rem;
    padding: .35rem .55rem;
    background: var(--color-ink);
    color: var(--color-muted);
    font-size: .72rem;
  }

  @media (hover: none), (pointer: coarse) {
    .map-host :global(.maplibregl-desktop-message) { display: none; }
    .map-host :global(.maplibregl-mobile-message) { display: block; }
  }
  @media (max-width: 960px) {
    .map-stage { height: clamp(24rem, 100vw, 34rem); }
  }
  @media (max-width: 480px) {
    .map-stage { height: clamp(21rem, 113vw, 30.5rem); }
  }
  @media (scripting: none) {
    .map-status--pending { display: none; }
  }
</style>
