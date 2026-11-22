<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { on } from 'svelte/events';
  import RollingNumber from '../RollingNumber.svelte';
  import type { RouteData, ScreenPoint } from './route-data.js';
  import { elevationAtDistance, type ElevationPoint, type RideSample, type RideWindow } from './ride-data.js';
  import { placeRidePopup, popupLeader, type ScreenRect } from './ride-inspection.js';

  interface Props {
    day: number | undefined;
    kind: RouteData['features'][number]['properties']['kind'];
    dayDistance: number;
    sample: RideSample | undefined;
    distance: number;
    window: RideWindow;
    routeElevation: ElevationPoint[];
    point: ScreenPoint | undefined;
    anchor: ScreenPoint;
    viewport: Pick<ScreenRect, 'width' | 'height'>;
    pinned: boolean;
    keyboard: boolean;
    onClear: () => void;
    onScrub: (distance: number) => number | undefined;
  }

  let { day, kind, dayDistance, sample, distance, window, routeElevation, point, anchor, viewport, pinned, keyboard, onClear, onScrub }: Props = $props();
  let panel = $state<HTMLElement>();
  let clearButton = $state<HTMLButtonElement>();
  let plotElement = $state<HTMLDivElement>();
  let slider = $state<HTMLInputElement>();
  let size = $state({ width: 0, height: 0 });
  let obstacles = $state.raw<ScreenRect[]>([]);
  let position = $state<ScreenPoint>();
  let swipe: { pointerId: number; x: number; startY?: number } | undefined;
  let scrubTarget: { requested: number; selected: number } | undefined;
  let lastScrub = -Infinity;
  let focused = false;
  const id = $props.id();
  const number = new Intl.NumberFormat('en');
  const axisNumber = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
  const decimal = new Intl.NumberFormat('en', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });

  function readingScale(value: number, scaleRange: number) {
    return Math.min(1.06, Math.max(.94, .91 + .15 * value / scaleRange));
  }

  function emphasizeReading(node: HTMLElement, previous: { value: number; scale: number }) {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | undefined;
    const cancel = () => animation?.cancel();
    motion.addEventListener('change', cancel);

    return {
      update(reading: typeof previous) {
        const direction = Math.sign(reading.value - previous.value);
        const previousScale = previous.scale;
        previous = reading;
        if (!direction) return;
        if (motion.matches) return;
        const start = animation?.playState === 'running'
          ? getComputedStyle(node).transform
          : `scale(${previousScale})`;
        cancel();

        const settled = reading.scale;
        const emphasis = Math.min(1.18, Math.max(.84, settled + direction * .12));
        animation = node.animate([
          { transform: start, easing: 'ease-out' },
          { transform: `scale(${emphasis})`, offset: .35, easing: 'ease-in-out' },
          { transform: `scale(${settled})` }
        ], 360);
      },
      destroy() {
        motion.removeEventListener('change', cancel);
        cancel();
      }
    };
  }

  const elevation = $derived(elevationAtDistance(routeElevation, distance));
  const readings = $derived([
    { label: 'Speed', value: sample?.[3] == null ? null : Math.round(sample[3]), unit: 'km/h', maxAnimatedDelta: 5, scaleRange: 50 },
    { label: 'Elevation', value: elevation === null ? null : Math.round(elevation), unit: 'm', maxAnimatedDelta: 30, scaleRange: 1000 },
    { label: 'Heart rate', value: sample?.[4] ?? null, unit: 'bpm' }
  ].filter((reading): reading is typeof reading & { value: number } => reading.value !== null));
  const title = $derived(kind === 'ferry' ? 'Ferry crossing' :
    kind === 'official' ? `Day ${day} · Official course` : `Day ${day} · km ${decimal.format(dayDistance / 1000)}`);
  const time = $derived(kind === 'ride' && sample?.[2] != null ? `${clock.format(sample[2] * 1000)} UTC` : undefined);
  const description = $derived([`Trip kilometer ${axisNumber.format(distance / 1000)}`,
    ...readings.map(({ label, value, unit }) => `${label} ${number.format(value)} ${unit}`), time].filter(Boolean).join(', '));

  const plot = { left: 43, top: 10, right: 305, bottom: 64 };
  const plotWidth = plot.right - plot.left;
  const distanceTicks = $derived.by(() => {
    const span = window.end - window.start;
    if (span <= 0) return [];
    const target = span / 4;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const step = ([1, 2, 2.5, 5, 10].find((multiple) => multiple * magnitude >= target) ?? 10) * magnitude;
    const first = Math.ceil(window.start / step);
    const last = Math.floor(window.end / step);
    return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step);
  });

  // Draw the trip trace once. Crossing a day boundary only updates the viewport.
  const trace = $derived.by(() => {
    const segments: [number, number][][] = [[]];
    let low = Infinity;
    let high = -Infinity;
    for (const [meters, elevation] of routeElevation) {
      if (elevation === null) {
        if (segments.at(-1)?.length) segments.push([]);
        continue;
      }
      low = Math.min(low, elevation);
      high = Math.max(high, elevation);
      segments[segments.length - 1].push([meters, elevation]);
    }
    const floor = low - Math.max(10, (high - low) / 10);
    return segments.filter((segment) => segment.length > 1).map((segment) => {
      const line = 'M' + segment.map(([x, y]) => `${x} ${y}`).join('L');
      return { line, fill: `${line}L${segment.at(-1)![0]} ${floor}H${segment[0][0]}Z` };
    });
  });

  const chart = $derived.by(() => {
    const { start, end, samples } = window;
    if (end <= start || !trace.length) return undefined;
    let low = Infinity;
    let high = -Infinity;
    function include(elevation: number | null) {
      if (elevation === null) return;
      low = Math.min(low, elevation);
      high = Math.max(high, elevation);
    }
    // Include interpolated edges so the vertical scale doesn't jump as samples enter or leave.
    include(elevationAtDistance(samples, start));
    include(elevationAtDistance(samples, end));
    for (const [meters, elevation] of samples) {
      if (meters >= start && meters <= end) include(elevation);
    }
    const hasElevation = low !== Infinity;
    const middle = hasElevation ? (low + high) / 2 : 0;
    const half = hasElevation ? Math.max(10, (high - low) * .55) : 10;
    const min = middle - half;
    const xScale = plotWidth / (end - start);
    const yScale = (plot.bottom - plot.top) / (2 * half);
    const x = (meters: number) => plot.left + (meters - start) * xScale;
    const y = (meters: number) => plot.bottom - (meters - min) * yScale;
    const transform = `matrix(${xScale} 0 0 ${-yScale} ${plot.left - start * xScale} ${plot.bottom + min * yScale})`;
    return { x, y, transform, ticks: hasElevation ? [middle + half, middle, min] : [] };
  });

  function scrubTo(next: number) {
    const first = routeElevation[0][0];
    const last = routeElevation[routeElevation.length - 1][0];
    const requested = Math.max(first, Math.min(last, next));
    lastScrub = performance.now();
    const selected = onScrub(requested);
    if (selected !== undefined) scrubTarget = { requested, selected };
  }

  function scrubBy(fraction: number) {
    // Keep accumulating motion if the map snaps the selected point across a gap in the route.
    const start = scrubTarget?.selected === distance ? scrubTarget.requested : distance;
    scrubTo(start + fraction * (window.end - window.start));
  }

  function scrubWithKey(event: KeyboardEvent) {
    const direction = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    scrubBy(direction / 100);
  }

  function scrubWithWheel(event: WheelEvent) {
    const width = slider?.clientWidth;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!width || !delta || event.ctrlKey) return;
    event.preventDefault();
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 :
      event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? width : 1;
    scrubBy(delta * unit / (4 * width));
  }

  function startScrub(event: PointerEvent & { currentTarget: HTMLDivElement }) {
    if (!pinned || event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0 || swipe) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    swipe = { pointerId: event.pointerId, x: event.clientX, startY: event.clientY };
  }

  function moveScrub(event: PointerEvent & { currentTarget: HTMLDivElement }) {
    if (swipe?.pointerId !== event.pointerId) return;
    const delta = swipe.x - event.clientX;
    if (swipe.startY !== undefined) {
      if (Math.abs(delta) < Math.max(6, Math.abs(swipe.startY - event.clientY))) return;
      swipe.startY = undefined;
    }
    swipe.x = event.clientX;
    if (delta) scrubBy(delta / event.currentTarget.clientWidth);
  }

  function endScrub(event?: PointerEvent) {
    if (!swipe || (event && swipe.pointerId !== event.pointerId)) return;
    const { pointerId } = swipe;
    swipe = undefined;
    if (plotElement?.hasPointerCapture(pointerId)) plotElement.releasePointerCapture(pointerId);
  }

  $effect(() => {
    if (plotElement && pinned) return on(plotElement, 'wheel', scrubWithWheel, { passive: false });
  });

  $effect(() => {
    if (!panel || !viewport.width || !viewport.height) return;
    const parent = panel.parentElement!;
    function measure() {
      if (!panel) return;
      size = { width: panel.offsetWidth, height: panel.offsetHeight };
      const origin = parent.getBoundingClientRect();
      obstacles = Array.from(parent.parentElement!.querySelectorAll('.map-controls, .reading-status, .map-compass, .map-key, .map-gesture, .explore, .attribution'))
        .map((element) => element.getBoundingClientRect())
        .filter((bounds) => bounds.width && bounds.height)
        .map((bounds) => ({
          x: bounds.left - origin.left - 4, y: bounds.top - origin.top - 4,
          width: bounds.width + 8, height: bounds.height + 8
        }));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  });

  $effect(() => {
    const placementInputs = [anchor, size, viewport, obstacles] as const;
    // Keep the chart still during swipes and bursts of wheel or keyboard input.
    if (!size.width || untrack(() => swipe || performance.now() - lastScrub < 200)) return;
    position = placeRidePopup(...placementInputs, untrack(() => position));
  });

  $effect(() => {
    const control = slider ?? clearButton;
    if (!keyboard) focused = false;
    if (!keyboard || !position || !control || focused) return;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled) return;
      control.focus({ preventScroll: true });
      focused = document.activeElement === control;
    });
    return () => { cancelled = true; };
  });

  const leader = $derived(point && position && popupLeader(point, position, size.width, size.height));
</script>

<svelte:window onblur={() => endScrub()} />

<div class="ride-overlay">
  <svg class="leader" viewBox="0 0 {viewport.width} {viewport.height}" aria-hidden="true">
    {#if leader}
      <path d={leader} stroke="var(--color-paper)" stroke-width="4.5" />
      <path d={leader} stroke="var(--color-ink)" stroke-width="1.4" />
    {/if}
  </svg>
  {#if point}
    <span class="map-point" style:left="{point.x}px" style:top="{point.y}px" aria-hidden="true"></span>
  {/if}

  <section class="ride-popup" class:pinned bind:this={panel} aria-label="Ride data"
    inert={!pinned} style:left="{position?.x ?? 0}px" style:top="{position?.y ?? 0}px" style:visibility={position ? 'visible' : 'hidden'}>
    <header class="ride-heading">
      <strong>{title}</strong>
      {#if time}<span>{time}</span>{/if}
      {#if pinned && !chart}<button type="button" bind:this={clearButton} onclick={onClear}>Clear point</button>{/if}
    </header>
    {#if readings.length}
      <dl class="readings" style:--reading-count={readings.length}>
        {#each readings as { label, value, unit, maxAnimatedDelta, scaleRange } (label)}
          <div>
            <dt>{label}</dt>
            <dd>
              {#if scaleRange !== undefined}
                {@const scale = readingScale(value, scaleRange)}
                <span class="scaled-value" class:wide-value={Math.abs(value) >= 1000}
                  style:--reading-scale={scale} use:emphasizeReading={{ value, scale }}>
                  <RollingNumber {value} formatter={number} {maxAnimatedDelta} />
                </span>
              {:else}
                {number.format(value)}
              {/if}<small>{unit}</small>
            </dd>
          </div>
        {/each}
      </dl>
    {:else}
      <p class="missing">No readings at this point.</p>
    {/if}
    {#if chart}
      <div class="profile">
        <header>
          <strong>Elevation profile</strong>
          {#if pinned}<button type="button" bind:this={clearButton} onclick={onClear}>Clear point</button>{/if}
        </header>
        <div class="plot" role="group" aria-label="Elevation profile" bind:this={plotElement}
          onpointerdown={startScrub} onpointermove={moveScrub} onpointerup={endScrub}
          onpointercancel={endScrub} onlostpointercapture={endScrub}>
          <p class="profile-hint">
            <span class="pin-hint">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path fill="var(--color-route)" d="M10 18s5-5.2 5-9a5 5 0 0 0-10 0c0 3.8 5 9 5 9Z" /><circle cx="10" cy="9" r="1.4" />
              </svg>
              <span><strong>Click the marked point</strong> to pin the popup</span>
            </span>
            <span class="wheel-hint">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="5" y="2" width="10" height="16" rx="5" /><path d="M10 5.5v3" />
              </svg>
              <span><strong>Scroll the chart</strong> to move along the route</span>
            </span>
            <span class="swipe-hint">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10h16M6 6l-4 4 4 4m8-8 4 4-4 4" /></svg>
              <span><strong>Swipe left or right</strong> to follow the route</span>
            </span>
          </p>
          <div class="chart">
            <svg viewBox="0 0 312 84" role="img" aria-label="Elevation over the surrounding route">
              <defs><clipPath id={id}><rect x={plot.left} y="0" width={plot.right - plot.left} height={plot.bottom + 1} /></clipPath></defs>
              {#each chart.ticks as tick, index}
                <text x="39" y={chart.y(tick) + 3} text-anchor="end">{number.format(Math.round(tick))}{index === 0 ? ' m' : ''}</text>
                <path class="grid" d="M{plot.left} {chart.y(tick)}H{plot.right}" />
              {/each}
              {#each distanceTicks as tick (tick)}
                {@const x = chart.x(tick)}
                {@const opacity = Math.max(0, Math.min(1, (x - plot.left) / 22, (plot.right - x) / 22))}
                <path class="grid distance-grid" d="M{x} {plot.top}V{plot.bottom}" style:opacity />
                <text class="distance-tick" {x} y="79" text-anchor="middle" style:opacity>{axisNumber.format(tick / 1000)}</text>
              {/each}
              <g clip-path="url(#{id})">
                <g class="profile-trace" transform={chart.transform}>
                  {#each trace as { line, fill }}
                    <path class="terrain" d={fill} />
                    <path class="elevation" d={line} vector-effect="non-scaling-stroke" />
                  {/each}
                </g>
              </g>
              <path class="axis" d="M{plot.left} {plot.bottom}H{plot.right}" />
              <text x="39" y="79" text-anchor="end">Trip km</text>
              {#if !chart.ticks.length}
                <text x={(plot.left + plot.right) / 2} y="36" text-anchor="middle">No elevation recorded</text>
              {/if}
              <path class="cursor" d="M{chart.x(distance)} 5V{plot.bottom}" />
              {#if elevation !== null}
                <circle class="chart-point" cx={chart.x(distance)} cy={chart.y(elevation)} r="4.3" />
              {/if}
            </svg>
            {#if pinned}
              <span id="{id}-keys" hidden>Use the arrow keys to move along the route.</span>
              <input type="range" min={window.start} max={window.end} step="any" value={distance} bind:this={slider}
                aria-label="Point on the elevation profile" aria-valuetext={description}
                aria-describedby="{id}-keys"
                onkeydown={scrubWithKey}
                oninput={(event) => scrubTo(event.currentTarget.valueAsNumber)} />
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  .ride-overlay { position: absolute; inset: 0; z-index: 1; pointer-events: none; color: var(--color-ink); }
  .leader { position: absolute; inset: 0; width: 100%; height: 100%; fill: none; }
  .map-point {
    position: absolute; width: 19px; height: 19px; transform: translate(-50%, -50%);
    border: 2px solid var(--color-ink); border-radius: 50%; outline: 3px solid var(--color-paper); background: var(--color-route);
  }
  .map-point::after { content: ''; position: absolute; inset: 5px; background: var(--color-ink); border-radius: 50%; }
  .ride-popup {
    --clear-point-height: 1.55rem;
    position: absolute; width: min(21rem, calc(100% - 16px)); max-height: calc(100% - 16px);
    overflow-y: auto; background: var(--color-paper); font-variant-numeric: tabular-nums;
  }
  .ride-popup.pinned { pointer-events: auto; }
  .ride-heading {
    display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; padding: .45rem .75rem;
    background: var(--color-route); border-bottom: 1px solid var(--color-ink); font-size: .8rem;
  }
  .ride-heading strong { font-weight: 800; }
  .ride-heading span { font-size: .72rem; font-weight: 700; white-space: nowrap; }
  .readings, .missing {
    --reading-value-size: 2.06rem;
    --reading-value-line: calc(var(--reading-value-size) * .98);
    --reading-label-line: .82rem;
    --reading-gap: .2rem;
    box-sizing: content-box;
    min-block-size: calc(var(--reading-value-line) + var(--reading-label-line) + var(--reading-gap));
    margin: 0; padding: .58rem .75rem .65rem;
  }
  .missing { display: grid; align-content: center; }
  .readings { display: grid; grid-template-columns: 1.1fr 1fr .78fr; column-gap: .5rem; }
  .readings:not(:has(> :nth-child(3))) { grid-template-columns: repeat(var(--reading-count), minmax(0, 1fr)); }
  .readings > div { display: flex; flex-direction: column-reverse; gap: var(--reading-gap); }
  dt, .missing { font-size: .69rem; font-weight: 670; line-height: var(--reading-label-line); }
  dd { margin: 0; white-space: nowrap; font: 800 var(--reading-value-size)/var(--reading-value-line) var(--font-display); }
  dd small { margin-left: .18rem; font: 690 .71rem/1 var(--font-ui); }
  .scaled-value {
    display: inline-block;
    transform: scale(var(--reading-scale));
    transform-origin: center;
  }
  .scaled-value + small { margin-inline-start: .36rem; }
  .wide-value + small { margin-inline-start: .46rem; }
  @media (prefers-reduced-motion: reduce) {
    .scaled-value { transform: none; }
  }
  .profile { margin-inline: .75rem; padding-bottom: .34rem; border-top: 1px solid var(--color-rule); }
  .profile header { display: flex; align-items: center; justify-content: space-between; gap: .5rem; min-height: var(--clear-point-height); font-size: .72rem; }
  .profile strong { font-weight: 780; }
  button {
    border: 0; background: none; color: inherit; margin: 0; padding: .2rem 0; min-height: var(--clear-point-height);
    font-size: .72rem; font-weight: 710; text-decoration: underline; text-underline-offset: .12em; cursor: pointer;
  }
  button:hover { color: #62496b; }
  button:focus-visible { outline-offset: 2px; }
  .chart { position: relative; }
  .chart svg { display: block; width: 100%; height: auto; }
  .profile text { fill: currentColor; font-size: 10.5px; font-weight: 690; }
  .grid { fill: none; stroke: var(--color-rule); stroke-dasharray: 2 4; }
  .distance-grid { stroke-width: .75; }
  .terrain { fill: var(--color-map-water); fill-opacity: .55; }
  .elevation { fill: none; stroke: var(--color-unread); stroke-width: 1.8; stroke-linejoin: round; }
  .axis, .cursor { fill: none; stroke: currentColor; }
  .chart-point { fill: var(--color-route); stroke: currentColor; stroke-width: 1.5; }
  .chart input {
    position: absolute; inset: 0 2% 18% 13%; width: 85%; height: 82%; opacity: 0; margin: 0;
    pointer-events: none;
  }
  .plot:has(input) { touch-action: pan-y pinch-zoom; user-select: none; }
  .plot:has(input:focus-visible) { outline: 2px solid currentColor; outline-offset: 1px; }
  .profile-hint {
    display: grid;
    margin-bottom: .23rem;
    padding: .3rem .4rem;
    background: color-mix(in srgb, var(--color-map-water) 35%, var(--color-paper));
    font-size: .75rem;
    line-height: 1.35;
  }
  /* Both hints size the same row so wrapping cannot move the chart when pinning. */
  .profile-hint > span { grid-area: 1 / 1; display: flex; align-items: center; gap: .35rem; }
  .ride-popup:not(.pinned) .profile-hint > :not(.pin-hint),
  .pinned .profile-hint > .pin-hint { visibility: hidden; }
  .profile-hint svg { flex: none; width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .profile-hint > .swipe-hint { display: none; }

  @media (hover: none) and (pointer: coarse) {
    .profile-hint > .wheel-hint { display: none; }
    .profile-hint > .swipe-hint { display: flex; }
  }

  @media (max-width: 639px) {
    .ride-popup { --clear-point-height: 2rem; width: min(19.25rem, calc(100% - 16px)); }
    .readings, .missing { --reading-value-size: clamp(1.52rem, 7vw, 1.87rem); padding-inline: .65rem; }
    .readings { column-gap: .35rem; }
  }
</style>
