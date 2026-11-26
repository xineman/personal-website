<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { fade } from 'svelte/transition';
  import type { ScreenPoint } from './route-data.js';
  import { desktopPhotos, interpolatePhotoFlight, mapSpace, photoFlightEasing, photoLayout, photoLeader, photoMarkerSize,
    photoPosition, placePhotoStacks, projectPhotoStack, visiblePhotoFlight, type PhotoFlightBox,
    samePhotoPlacements, samePhotoStop, visiblePhotoPoint, type PhotoBox, type PhotoLayout, type PhotoPlacement,
    type PhotoPosition, type PhotoStack, type PhotoViewport, type ProjectedPhoto, type RoutePhoto } from './route-photo-layout.js';

  interface Props {
    points: ProjectedPhoto[];
    viewport: PhotoViewport;
    cameraMoving: boolean;
    overlapsRoute: (box: PhotoBox) => boolean;
    onFocus: (photo?: RoutePhoto, layout?: PhotoLayout) => void;
    onMapWheel: (event: WheelEvent) => void;
  }
  let { points, viewport, cameraMoving, overlapsRoute, onFocus, onMapWheel }: Props = $props();

  let selection = $state.raw<{ members: RoutePhoto[]; index: number }>();
  let layout = $state<PhotoLayout>();
  let closing = $state(false);
  let updatingReturnPlacement = $state(false);
  let layer: HTMLDivElement;
  let dialog = $state<HTMLDialogElement>();
  let photoPrint = $state<HTMLDivElement>();
  let closeButton = $state<HTMLButtonElement>();
  let imageBox = $state.raw<PhotoBox>();
  type PhotoOrigin = { button: HTMLButtonElement; id: string; point: ScreenPoint; box: PhotoBox; cover: boolean };
  type PhotoFlight = { photo: RoutePhoto; from: PhotoFlightBox; base: PhotoFlightBox; destination: () => PhotoFlightBox };
  let origin: PhotoOrigin | undefined;
  let browseTimer: ReturnType<typeof setTimeout> | undefined;
  let requestedIndex: number | undefined;
  let departing = $state.raw<{ photo: RoutePhoto; box: PhotoBox; direction: number }>();
  let flight = $state.raw<PhotoFlight>();
  const flightProgress = new Tween(1, { easing: photoFlightEasing });
  let frame: number | undefined;
  let measureUntil = 0;
  let swipeStart: { pointer: number; x: number; y: number } | undefined;
  let selectionVersion = 0;
  let placements = $state.raw<PhotoPlacement[]>([]);
  let previousPositions = $state.raw(new Map<string, PhotoPosition>());
  const placementProgress = new Tween(1, { duration: 200 });

  const current = $derived(selection?.members[selection.index]);
  const tallestRatio = $derived(selection?.members.reduce((ratio, photo) =>
    Math.min(ratio, photo.width / photo.height), Infinity) ?? 1);
  const currentPoint = $derived(points.find(({ photo }) => photo.id === current?.id)?.point);
  const photoPositions = $derived(new Map(placements.map((placement) => [
    placement.photo.id, photoPosition(placement, previousPositions.get(placement.photo.id), placementProgress.current)
  ])));
  const stacks = $derived.by(() => {
    const projected = new Map(points.map(({ photo, point }) => [photo.id, point]));
    const groups = placements.flatMap((placement) => {
      const point = projected.get(placement.photo.id);
      return point && visiblePhotoPoint(point, viewport)
        ? [projectPhotoStack(placement, point, photoPositions.get(placement.photo.id)!)] : [];
    });
    if (!selection || closing) return groups;
    if (layout === 'fullscreen') return [];
    const shared = mapSpace(viewport);
    const width = layout === 'side' ? shared.width : viewport.width;
    const height = layout === 'below' ? shared.height : viewport.height;
    const selected = new Set(selection.members.map(({ id }) => id));
    return groups.filter(({ members, point }) => !members.some(({ id }) => selected.has(id)) &&
      point.x <= width - 23 && point.y <= height - 23)
      .map((group) => ({ ...group, box: undefined, print: undefined, printScale: undefined, marker: undefined }));
  });
  const returnStack = $derived(closing && origin
    ? stacks.find(({ members }) => members.some(({ id }) => id === origin?.id)) : undefined);
  const connectorPoint = $derived(closing
    ? returnStack?.point ?? points.find(({ photo }) => photo.id === origin?.id)?.point : currentPoint);
  // The photo and its connector are rendered from the same animation frame and camera projection.
  const flightFrame = $derived(flight && interpolatePhotoFlight(flight.from, flight.destination(), flightProgress.current));
  const connector = $derived.by(() => {
    const box = flightFrame ? visiblePhotoFlight(flightFrame) : closing ? undefined : imageBox;
    if (!box || !layout || (!closing && layout === 'fullscreen') || !connectorPoint ||
      connectorPoint.x < 0 || connectorPoint.x > viewport.width || connectorPoint.y < 0 || connectorPoint.y > viewport.height) return '';
    return photoLeader(connectorPoint, box, closing ? 'side' : layout);
  });
  const viewportStyle = $derived(`--map-height:${Math.max(viewport.height * .45, 250)}px`);

  $effect(() => {
    const projected = points;
    const size = viewport;
    const keepPositions = (!!selection && !closing) || (cameraMoving && !updatingReturnPlacement);
    const animatePlacement = !updatingReturnPlacement;
    untrack(() => {
      if (keepPositions && placements.length) return;
      const next = placePhotoStacks(projected, size, overlapsRoute, placements);
      if (samePhotoPlacements(placements, next)) return;
      const animate = animatePlacement && placements.length && !matchMedia('(prefers-reduced-motion: reduce)').matches;
      previousPositions = animate ? photoPositions : new Map();
      placements = next;
      if (animate) {
        void placementProgress.set(0, { duration: 0 });
        void placementProgress.set(1);
      } else void placementProgress.set(1, { duration: 0 });
    });
  });

  $effect(() => {
    if (updatingReturnPlacement && !closing && !cameraMoving) updatingReturnPlacement = false;
  });

  function fadeStack(node: Element) {
    const still = selection || matchMedia('(prefers-reduced-motion: reduce)').matches;
    return fade(node, { duration: still ? 0 : 140 });
  }

  function revealStackImage(image: HTMLImageElement) {
    void image.decode().then(() => image.classList.add('is-ready'), () => {
      // Keep the print's camera placeholder when the image cannot load.
    });
  }

  function stackLeader(stack: PhotoStack) {
    if (stack.print) {
      const { point: { x, y }, print } = stack;
      if (x < print.x || x > print.x + print.width) return photoLeader(stack.point, print);
      return `M${x},${y} V${Math.max(print.y, Math.min(y, print.y + print.height))}`;
    }
    if (stack.marker) return `M${stack.point.x},${stack.point.y} L${stack.marker.x},${stack.marker.y}`;
    return '';
  }

  function photoTitle(photo: RoutePhoto) {
    return [photo.day !== undefined && 'Day ' + photo.day, photo.date, photo.time].filter(Boolean).join(' · ');
  }

  function fittedBox(rect: PhotoBox, photo: RoutePhoto, cover = false): PhotoFlightBox {
    const ratio = photo.width / photo.height;
    const width = (cover ? Math.max : Math.min)(rect.width, rect.height * ratio);
    const height = width / ratio;
    return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height,
      cropX: cover && width ? Math.max(0, (1 - rect.width / width) / 2) : 0,
      cropY: cover && height ? Math.max(0, (1 - rect.height / height) / 2) : 0 };
  }

  function containedBox(element: Element, photo: RoutePhoto) {
    return fittedBox(localBox(element.getBoundingClientRect()), photo);
  }

  function localBox(box: PhotoBox): PhotoBox {
    const bounds = layer.getBoundingClientRect();
    return { x: box.x - bounds.left, y: box.y - bounds.top, width: box.width, height: box.height };
  }

  function sampleFrame(until: number) {
    measureUntil = Math.max(measureUntil, until);
    if (frame !== undefined) cancelAnimationFrame(frame);
    const measure = () => {
      if (!closing && current && photoPrint) imageBox = containedBox(photoPrint, current);
      if (performance.now() < measureUntil) frame = requestAnimationFrame(measure);
      else frame = undefined;
    };
    measure();
  }

  function trackPrint(print: HTMLDivElement) {
    const observer = new ResizeObserver(() => sampleFrame(performance.now()));
    observer.observe(print);
    return { destroy: () => observer.disconnect() };
  }

  function revealCurrentThumbnail() {
    const thumbnail = layer.querySelector('.photo-rail [aria-current="true"]');
    const rail = thumbnail?.closest('ol');
    if (!thumbnail || !rail) return;
    const item = thumbnail.getBoundingClientRect();
    const view = rail.getBoundingClientRect();
    rail.scrollBy({
      left: Math.min(0, item.left - view.left) || Math.max(0, item.right - view.right),
      top: Math.min(0, item.top - view.top) || Math.max(0, item.bottom - view.bottom)
    });
  }

  function trackThumbnails(list: HTMLOListElement) {
    const observer = new ResizeObserver(revealCurrentThumbnail);
    observer.observe(list);
    return { destroy: () => observer.disconnect() };
  }

  function thumbnailPin() {
    const pin = layer.querySelector<HTMLElement>('.traveling-dot');
    const rail = pin?.closest('ol');
    if (!pin || !rail) return;
    const { x, y, width, height } = pin.getBoundingClientRect();
    // Use the rendered position so a quick second selection continues from the moving dot.
    return { pin, x: x + width / 2 + rail.scrollLeft, y: y + height / 2 + rail.scrollTop };
  }

  function cancelFlight() {
    flight = undefined;
    void flightProgress.set(1, { duration: 0 });
  }

  function movePrint(photo: RoutePhoto, from: PhotoFlightBox, destination: () => PhotoFlightBox,
    duration: number, done: () => void = () => {}) {
    const to = destination();
    if (!from.width || !to.width || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done();
      return;
    }
    const base = from.width >= to.width ? from : to;
    const nextFlight = { photo, from, base, destination };
    void flightProgress.set(0, { duration: 0 });
    flight = nextFlight;
    void flightProgress.set(1, { duration }).then(() => {
      if (flight !== nextFlight) return;
      cancelFlight();
      done();
      if (selection) sampleFrame(performance.now());
    });
  }

  async function openStack(stack: PhotoStack, target: HTMLButtonElement) {
    const photo = stack.photo;
    const version = ++selectionVersion;
    requestedIndex = undefined;
    departing = undefined;
    clearTimeout(browseTimer);
    cancelFlight();
    const thumbnail = target.querySelector('.stack-face img');
    const box = localBox((thumbnail ?? target).getBoundingClientRect());
    origin = { button: target, id: photo.id, point: stack.point, box, cover: !!thumbnail };
    closing = false;
    updatingReturnPlacement = false;
    selection = { members: stack.members, index: stack.members.indexOf(photo) };
    layout = photoLayout(photo, viewport);
    onFocus(photo, layout);
    await tick();
    if (version !== selectionVersion || !photoPrint) return;
    if (dialog && !dialog.open) dialog.show();
    closeButton?.focus({ preventScroll: true });
    const destination = containedBox(photoPrint, photo);
    movePrint(photo, fittedBox(box, photo, !!thumbnail), () => destination, 375);
    sampleFrame(performance.now() + 390);
  }

  export async function close() {
    if (!current || closing) return;
    const photo = current;
    const openedFrom = origin;
    const from = flightFrame ?? (photoPrint && containedBox(photoPrint, photo));
    closing = true;
    requestedIndex = undefined;
    departing = undefined;
    updatingReturnPlacement = true;
    const version = ++selectionVersion;
    clearTimeout(browseTimer);
    cancelFlight();
    if (dialog?.open) dialog.close();
    onFocus();
    await tick();
    if (version !== selectionVersion || !layer.isConnected) return;
    const sourceButton = () => openedFrom && layer.querySelector<HTMLButtonElement>(
      `[data-photo-id="${CSS.escape(returnStack?.photo.id ?? openedFrom.id)}"]`);
    if (document.activeElement === document.body || layer.contains(document.activeElement)) {
      (sourceButton() ?? (openedFrom?.button.isConnected ? openedFrom.button : layer.closest('.map-sheet')?.querySelector('canvas')))
        ?.focus({ preventScroll: true });
    }
    const finish = () => {
      selection = undefined;
      layout = undefined;
      closing = false;
      imageBox = undefined;
      origin = undefined;
    };
    if (!from || !openedFrom) {
      finish();
      return;
    }
    const destination = () => {
      if (returnStack) {
        const point = returnStack.marker ?? returnStack.point;
        const box = returnStack.print ?? { x: point.x - photoMarkerSize / 2, y: point.y - photoMarkerSize / 2,
          width: photoMarkerSize, height: photoMarkerSize };
        return fittedBox(box, photo, !!returnStack.print);
      }
      // The thumbnail can leave the viewport while the map is moving.
      const point = points.find(({ photo }) => photo.id === openedFrom.id)?.point ?? openedFrom.point;
      const { box } = openedFrom;
      return fittedBox({ ...box, x: box.x + point.x - openedFrom.point.x,
        y: box.y + point.y - openedFrom.point.y }, photo, openedFrom.cover);
    };
    movePrint(photo, from, destination, 280, finish);
  }

  async function changePhoto(index: number) {
    if (!selection || !current || closing || index === requestedIndex || !selection.members[index]) return;
    if (index === selection.index && requestedIndex === undefined) return;
    const version = ++selectionVersion;
    requestedIndex = undefined;
    if (index === selection.index) return;

    const photo = selection.members[index];
    requestedIndex = index;
    const incoming = new Image();
    incoming.src = photo.src;
    await incoming.decode().catch(() => {});
    if (version !== selectionVersion || !selection || !current) return;
    requestedIndex = undefined;

    clearTimeout(browseTimer);
    cancelFlight();
    const stage = photoPrint?.parentElement;
    if (photoPrint && stage) {
      const { x, y, width, height } = photoPrint.getBoundingClientRect();
      const bounds = stage.getBoundingClientRect();
      departing = { photo: current, box: { x: x - bounds.x, y: y - bounds.y, width, height },
        direction: Math.sign(index - selection.index) };
    }
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fromPin = reducedMotion ? undefined : thumbnailPin();
    selection = { ...selection, index };
    const nextLayout = photoLayout(photo, viewport, layout);
    const apply = async () => {
      layout = nextLayout;
      onFocus(photo, nextLayout);
      await tick();
      sampleFrame(performance.now() + 365);
    };
    if (nextLayout === layout || reducedMotion) await apply();
    else {
      onFocus(photo, layout);
      browseTimer = setTimeout(() => void apply(), 280);
      await tick();
      sampleFrame(performance.now());
    }
    if (version === selectionVersion) {
      revealCurrentThumbnail();
      const toPin = fromPin && thumbnailPin();
      if (fromPin && toPin) {
        toPin.pin.animate([
          { transform: `translate(${fromPin.x - toPin.x}px, ${fromPin.y - toPin.y}px)` },
          { transform: 'none' }
        ], { duration: 200, easing: 'cubic-bezier(.3,.75,.25,1)' });
      }
    }
  }

  function stepPhoto(direction: number) {
    if (selection) void changePhoto((requestedIndex ?? selection.index) + direction);
  }

  function watchViewerWheel(viewer: HTMLDivElement) {
    let lastWheel = -Infinity;
    let travel = 0;
    let turnDirection = 0;
    let tailMagnitude = Infinity;
    function wheel(event: WheelEvent) {
      if (!selection || closing || event.ctrlKey || !(event.target instanceof Element)) return;
      if (selection.members.length === 1) {
        if (layout !== 'fullscreen' && photoPrint?.contains(event.target)) onMapWheel(event);
        return;
      }

      const { deltaMode, deltaX, deltaY, timeStamp } = event;
      const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
      const delta = horizontal ? deltaX : deltaY;
      if (!delta) return;
      const scroller = event.target.closest('.photo-rail ol, .photo-caption');
      if (scroller && (horizontal ? scroller.scrollWidth > scroller.clientWidth :
        scroller.scrollHeight > scroller.clientHeight)) return;

      event.preventDefault();
      event.stopPropagation();
      const distance = delta * (deltaMode === 1 ? 24 : deltaMode === 2 ? viewer.clientHeight : 1);
      if (timeStamp - lastWheel > 140) {
        travel = 0;
        turnDirection = 0;
      }
      lastWheel = timeStamp;

      if (turnDirection) {
        if (requestedIndex !== undefined || departing) return;
        // Wheel events carry no momentum flag. Look for a new push against the decaying tail.
        const magnitude = Math.abs(distance);
        const freshPush = magnitude >= 4 && (Math.sign(distance) !== turnDirection || magnitude >= tailMagnitude * 2.5);
        if (!freshPush) {
          tailMagnitude = Math.min(tailMagnitude, magnitude);
          travel = 0;
          return;
        }
      }

      travel += distance;
      if (Math.abs(travel) < 20) return;
      turnDirection = Math.sign(travel);
      travel = 0;
      tailMagnitude = Infinity;
      stepPhoto(turnDirection);
    }
    viewer.addEventListener('wheel', wheel, { passive: false });
    return { destroy: () => viewer.removeEventListener('wheel', wheel) };
  }

  function viewerKeys(event: KeyboardEvent) {
    if (!selection || closing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void close();
    } else if (layer.contains(document.activeElement) &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stepPhoto(event.key === 'ArrowRight' ? 1 : -1);
    }
  }

  function finishSwipe(event: PointerEvent) {
    if (!selection || swipeStart?.pointer !== event.pointerId) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = undefined;
    if (Math.abs(dx) > Math.max(46, Math.abs(dy) * 1.45)) stepPhoto(-Math.sign(dx));
  }

  $effect(() => {
    if (!selection || closing || !layout || desktopPhotos(viewport) === (layout !== 'fullscreen')) return;
    const photo = selection.members[selection.index];
    cancelFlight();
    departing = undefined;
    clearTimeout(browseTimer);
    if (dialog?.open) dialog.close();
    layout = photoLayout(photo, viewport);
    onFocus(photo, layout);
    const version = selectionVersion;
    void tick().then(() => {
      if (closing || version !== selectionVersion) return;
      if (dialog && !dialog.open) dialog.show();
      closeButton?.focus({ preventScroll: true });
      sampleFrame(performance.now());
    });
  });

  onDestroy(() => {
    ++selectionVersion;
    clearTimeout(browseTimer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    void placementProgress.set(1, { duration: 0 });
    cancelFlight();
  });
</script>

<svelte:window onkeydowncapture={viewerKeys} />

{#snippet cameraIcon()}
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.5h3.5l1.25-2h4.5l1.25 2H17v9H3z"/><circle cx="10" cy="11" r="2.3"/></svg>
{/snippet}

{#snippet leader(path: string)}
  <path d={path} class="leader-casing" /><path d={path} class="leader" />
{/snippet}

{#snippet viewer(photo: RoutePhoto)}
  <div class="photo-frame" class:closing class:has-strip={selection && selection.members.length > 1} use:watchViewerWheel
    style:--photo-ratio={photo.width / photo.height} style:--tallest-ratio={tallestRatio}>
    <div class="photo-view">
      <div class="photo-stage" style:--browse-direction={departing?.direction ?? 1}>
        <div class="photo-print" class:flying={flight} bind:this={photoPrint} use:trackPrint>
          {#key photo.id}
            <img class="expanded-photo" class:arriving={departing} src={photo.src} alt={photo.alt}
              width={photo.width} height={photo.height} onpointerdown={(event) => {
                if (event.pointerType === 'touch') swipeStart = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
              }} onpointerup={finishSwipe} onpointercancel={() => { swipeStart = undefined; }} />
          {/key}
        </div>
        {#if departing}
          {#key departing}
            {@const { photo: previous, box } = departing}
            <img class="departing-print" src={previous.src} alt="" aria-hidden="true"
              style:left={`${box.x}px`} style:top={`${box.y}px`} style:width={`${box.width}px`} style:height={`${box.height}px`}
              onanimationend={() => { departing = undefined; }} />
          {/key}
        {/if}
        <button class="close-photo" type="button" aria-label="Close photo" bind:this={closeButton} onclick={close}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>
        </button>
      </div>
      <div class="photo-details">
        <div class="photo-caption" aria-live="polite">
          <h2 id="route-photo-title">{photo.caption}</h2>
          {#if photoTitle(photo)}<p>{photoTitle(photo)}</p>{/if}
          {#if photo.note}<p>{photo.note}</p>{/if}
        </div>
        {#if selection && selection.members.length > 1}
          <div class="photo-steps" role="group" aria-label="Photos in this group">
            <button type="button" aria-label="Previous photo" onclick={() => stepPhoto(-1)} disabled={selection.index === 0}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg>
            </button>
            <span>{selection.index + 1} / {selection.members.length}</span>
            <button type="button" aria-label="Next photo" onclick={() => stepPhoto(1)} disabled={selection.index === selection.members.length - 1}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg>
            </button>
          </div>
        {/if}
      </div>
    </div>
    {#if selection && selection.members.length > 1}
      <section class="photo-rail" class:rail-changing={departing}
        aria-label={samePhotoStop(selection.members) ? 'Photos at this stop' : 'Photos along this stretch'}>
        <ol role="list" use:trackThumbnails>
          {#each selection.members as member, index (member.id)}
            <li>
              {#if index === selection.index}<span class="traveling-dot" aria-hidden="true"></span>{/if}
              <button type="button" aria-label={'Show ' + member.caption}
                aria-current={index === selection.index ? 'true' : undefined}
                onclick={() => changePhoto(index)}>
                <span class="thumbnail-print">
                  <img src={member.src} alt="" loading="lazy" decoding="async" />
                  <span class="thumbnail-time">{member.time ?? member.date ?? 'Photo ' + (index + 1)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  </div>
{/snippet}

<div class="route-photos ph-no-capture" bind:this={layer} style={viewportStyle} style:--photo-marker-size={`${photoMarkerSize}px`}>
  <div class="photo-stacks">
    <svg class="print-leaders" aria-hidden="true" viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
      {#each stacks as stack (stack.photo.id)}
        {#if (stack.print || stack.marker) && stack.photo.id !== returnStack?.photo.id}
          <g>
            {@render leader(stackLeader(stack))}
            <circle class="stack-point-casing" cx={stack.point.x} cy={stack.point.y} r="5.5" />
            <circle class="stack-point" cx={stack.point.x} cy={stack.point.y} r="4" />
          </g>
        {/if}
      {/each}
    </svg>

    {#each stacks as stack (stack.photo.id)}
      {@const scale = stack.printScale ?? 1}
      <button type="button" class="map-photo" class:has-print={stack.print} class:stacked={stack.members.length > 1}
        transition:fadeStack
        class:returning={stack.photo.id === returnStack?.photo.id}
        data-photo-id={stack.photo.id}
        aria-label={stack.members.length > 1 ? `Open ${stack.members.length} photos` : 'Open ' + stack.photo.caption}
        aria-haspopup={desktopPhotos(viewport) ? undefined : 'dialog'}
        style:left={(stack.box?.x ?? stack.marker?.x ?? stack.point.x) + 'px'}
        style:top={(stack.box?.y ?? stack.marker?.y ?? stack.point.y) + 'px'}
        style:width={stack.box && stack.box.width / scale + 'px'} style:scale={stack.printScale}
        onclick={(event) => openStack(stack, event.currentTarget)}
        onwheel={onMapWheel}>
        {#if stack.print}
          {#each stack.members.filter((photo) => photo !== stack.photo).slice(0, 2) as other (other.id)}
            <span class="stack-back" aria-hidden="true" style:height={stack.print.height / scale + 'px'}>
              <img src={other.src} alt="" fetchpriority="low" decoding="async" use:revealStackImage />
            </span>
          {/each}
          <span class="stack-face">
            <span class="stack-image" style:height={stack.print.height / scale + 'px'}>
              {@render cameraIcon()}
              <img src={stack.photo.src} alt="" decoding="async" use:revealStackImage />
            </span>
            {#if stack.members.length > 1}<span class="print-label">{stack.members.length} photos</span>
            {:else}<span class="print-label single">{stack.photo.caption}</span>{/if}
          </span>
        {:else if stack.members.length > 1}
          {stack.members.length}
        {:else}
          {@render cameraIcon()}
        {/if}
      </button>
    {/each}
  </div>

  {#if current && layout === 'fullscreen'}
    <dialog class="full-photo" bind:this={dialog} aria-labelledby="route-photo-title"
      oncancel={(event) => { event.preventDefault(); void close(); }}>
      {@render viewer(current)}
    </dialog>
  {:else if current && layout}
    <section class="split-photo" class:below={layout === 'below'} aria-labelledby="route-photo-title">
      {@render viewer(current)}
    </section>
  {/if}
  {#if connector}
    <svg class="active-leader" aria-hidden="true" viewBox={`0 0 ${viewport.width} ${viewport.height}`}>
      {@render leader(connector)}
      <circle cx={connectorPoint!.x} cy={connectorPoint!.y} r="6" class="selected-point" />
    </svg>
  {/if}
  {#if flight && flightFrame}
    {@const { x, y, width, cropX, cropY } = flightFrame}
    <img class="flying-photo" src={flight.photo.src} alt="" aria-hidden="true"
      style:width={`${flight.base.width}px`} style:height={`${flight.base.height}px`}
      style:transform={`translate(${x}px, ${y}px) scale(${width / flight.base.width})`}
      style:clip-path={`inset(${cropY * 100}% ${cropX * 100}%)`} />
  {/if}
</div>

<style>
  .route-photos { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
  .photo-stacks { position: absolute; inset: 0; animation: photo-stacks-in 200ms ease-out; }
  @keyframes photo-stacks-in { from { opacity: .35; } }
  .print-leaders,.active-leader { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .active-leader { z-index: 4; }
  .flying-photo { position: absolute; z-index: 10; top: 0; left: 0; max-width: none; transform-origin: top left; pointer-events: none; }
  .leader,.leader-casing { fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .leader { stroke: var(--color-ink); stroke-width: 1.35; }
  .leader-casing { stroke: var(--color-paper); stroke-width: 4; }
  circle { fill: var(--color-paper); stroke: var(--color-ink); stroke-width: 1.5; }
  .stack-point-casing { stroke: var(--color-paper); }
  .stack-point,.selected-point { fill: var(--color-route); }
  button { cursor: pointer; }
  .map-photo {
    position: absolute; pointer-events: auto; display: grid; place-items: center; translate: -50% -50%;
    width: var(--photo-marker-size); height: var(--photo-marker-size); padding: 0; border: 1.5px solid var(--color-ink); border-radius: 50%;
    background: var(--color-paper); color: var(--color-ink); font-size: .75rem; font-weight: 750;
  }
  .map-photo:not(.has-print)::before { content: ''; position: absolute; inset: -5px; border-radius: 50%; }
  .map-photo:hover { background: var(--color-route); }
  .map-photo svg,.photo-view button svg { width: 20px; height: 20px; fill: none; stroke: currentColor;
    stroke-width: 1.55; stroke-linecap: round; stroke-linejoin: round; }
  .map-photo.has-print {
    grid-template-columns: minmax(0, 1fr); place-items: stretch; translate: none; height: auto;
    transform-origin: top left; border: 0; border-radius: 0; text-align: left; background: transparent; isolation: isolate;
  }
  .map-photo.has-print:focus-visible { outline: none; }
  .map-photo:not(.returning):focus-visible .stack-face { outline: 2px solid var(--color-ink); outline-offset: -2px; }
  .stack-face,.stack-back { display: block; background: var(--color-paper); box-shadow: 0 3px 10px #2d234139; }
  .stack-back { position: absolute; top: 0; left: 0; width: calc(100% - 8px); border: 2px solid var(--color-paper);
    transform: translate(6px,-3px) rotate(6deg); transform-origin: 50% 80%; }
  .stack-back:nth-of-type(2) { transform: translate(9px,-4px) rotate(10deg); }
  .stack-face { position: relative; min-width: 0; }
  .stack-image,.stack-back { background: color-mix(in srgb, var(--color-map-water) 32%, var(--color-paper)); }
  .stack-image { display: grid; place-items: center; }
  .stack-image > :is(img,svg) { grid-area: 1 / 1; }
  .stack-image > :is(img,svg),.stack-back img { transition: opacity 180ms ease-out; }
  .stack-image svg { opacity: .65; }
  .stack-image:has(img:global(.is-ready)) svg { opacity: 0; }
  .stack-image img,.stack-back img {
    width: 100%; height: 100%; min-height: 0; object-fit: cover; opacity: 0;
  }
  :is(.stack-image,.stack-back) img:global(.is-ready) { opacity: 1; }
  .print-label { display: block; padding: 4px 5px; overflow: hidden; white-space: nowrap;
    text-overflow: ellipsis; font: 720 .67rem/1.2 var(--font-ui); }
  .map-photo:hover .print-label,.map-photo:focus-visible .print-label { background: var(--color-route); }
  .map-photo.returning { pointer-events: none; }
  .returning .stack-face img { visibility: hidden; }

  .split-photo,.full-photo {
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    overflow: clip;
    pointer-events: none;
    padding: clamp(.5rem, 1.2vw, 1rem);
  }
  .split-photo {
    position: absolute; z-index: 3; inset: 0 0 0 53%;
    transition: left 340ms cubic-bezier(.16,1,.3,1), top 340ms cubic-bezier(.16,1,.3,1);
  }
  .split-photo.below { inset: var(--map-height) 0 0; }
  .full-photo {
    position: fixed; z-index: 3; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none;
    margin: 0; border: 0; background: transparent; color: var(--color-ink);
    padding: max(.5rem, env(safe-area-inset-top)) max(.5rem, env(safe-area-inset-right))
      max(.5rem, env(safe-area-inset-bottom)) max(.5rem, env(safe-area-inset-left));
  }
  .full-photo:not([open]) { display: none; }

  .photo-frame {
    --strip-width: 0rem;
    --photo-mat: color-mix(in srgb, var(--color-map-water) 28%, var(--color-paper));
    display: grid;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--color-ink);
    background: var(--color-paper);
    pointer-events: auto;
  }
  .photo-frame.has-strip {
    --strip-width: clamp(7.5rem, 10vw, 10rem);
    grid-template-columns: minmax(0, 1fr) var(--strip-width);
  }
  .below .photo-frame {
    justify-self: center;
    width: min(100%, 75rem, max(30rem, calc((100dvh - var(--map-height) - 5rem) * var(--photo-ratio) + var(--strip-width))));
  }
  .photo-frame.closing,.photo-print.flying { visibility: hidden; }
  .photo-view {
    display: grid;
    grid-template: minmax(0, 1fr) auto / minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }
  .photo-stage {
    --browse-x: 0%;
    --browse-y: calc(1% * var(--browse-direction));
    position: relative;
    display: grid;
    place-items: center;
    container-type: size;
    overflow: clip;
    padding: .3rem;
    background: var(--photo-mat);
  }
  .photo-print {
    width: min(100cqw, calc(100cqh * var(--photo-ratio)));
    aspect-ratio: var(--photo-ratio);
  }
  .expanded-photo,.departing-print {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    outline: 1px solid var(--color-ink);
    outline-offset: -1px;
  }
  .expanded-photo { touch-action: pan-y; }
  .expanded-photo.arriving { animation: print-settle 245ms cubic-bezier(.16,1,.3,1) both; }
  .departing-print {
    position: absolute;
    pointer-events: none;
    animation: print-lift 245ms cubic-bezier(.33,.1,.55,1) both;
  }
  @keyframes print-settle {
    from { transform: translate(calc(3 * var(--browse-x)), calc(3 * var(--browse-y))) rotate(calc(-1.2deg * var(--browse-direction))); }
    to { transform: none; }
  }
  @keyframes print-lift {
    42% { opacity: 1; }
    72% { opacity: 0; }
    to {
      transform: translate(calc(-17 * var(--browse-x)), calc(-17 * var(--browse-y))) rotate(calc(4deg * var(--browse-direction)));
      opacity: 0;
    }
  }
  @keyframes print-dissolve { to { opacity: 0; } }
  .close-photo,.photo-steps button {
    display: grid; place-items: center; width: 44px; height: 44px; padding: 0;
    border: 0; background: transparent; color: inherit;
  }
  .close-photo {
    position: absolute; z-index: 1; top: .55rem; right: .55rem;
    border: 1px solid var(--color-ink); background: var(--color-paper); color: var(--color-ink);
  }
  .close-photo:hover,.photo-steps button:hover:enabled { background: var(--color-route); color: var(--color-ink); }
  .photo-steps button:disabled { opacity: .42; cursor: default; }
  .photo-view button:focus-visible { outline: 2px solid var(--color-ink); outline-offset: -4px; }
  .photo-details {
    display: flex; align-items: stretch; justify-content: space-between;
    border-top: 1px solid var(--color-ink);
  }
  .photo-caption {
    min-width: 0; max-height: clamp(3.25rem, 22dvh, 8rem); overflow: auto; padding: .5rem .7rem;
    scrollbar-width: thin;
  }
  .photo-caption h2 { font: 800 clamp(1.15rem, 2.4vw, 1.75rem)/1 var(--font-display); overflow-wrap: anywhere; }
  .photo-caption p { margin-top: .2rem; font-size: .72rem; font-weight: 650; font-variant-numeric: tabular-nums; }
  .photo-steps {
    display: flex; align-items: center; flex: none; border-left: 1px solid var(--color-ink);
    font-size: .72rem; font-weight: 730; font-variant-numeric: tabular-nums;
  }
  .photo-steps span { min-width: 2rem; text-align: center; }

  .photo-rail {
    --thumbnail-settle-delay: 90ms;
    display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    min-width: 0; min-height: 0;
    border-left: 1px solid var(--color-ink);
    background: var(--photo-mat);
  }
  .photo-rail ol {
    display: flex; flex-direction: column; margin: 0; padding: .4rem .6rem .4rem .85rem;
    list-style: none; overflow: auto; overscroll-behavior: contain;
    scrollbar-width: thin; scrollbar-color: var(--color-unread) var(--photo-mat);
  }
  .photo-rail li {
    --stagger: 0rem;
    position: relative; flex: none; padding: .3rem 0 .3rem calc(.65rem + var(--stagger));
    border-left: 1px dashed var(--color-unread);
  }
  .photo-rail li:nth-child(even) { --stagger: .55rem; }
  .photo-rail li::before,.photo-rail li::after { content: ''; position: absolute; top: 50%; }
  .photo-rail li::before {
    left: 0; width: calc(.65rem + var(--stagger)); height: .5rem;
    background: var(--color-unread); clip-path: polygon(0 0, 45% 0, 75% 75%, 100% 75%, 100% 100%, 70% 100%, 40% 25%, 0 25%);
  }
  .photo-rail li::after {
    left: 0; width: 7px; height: 7px; translate: -50% -50%;
    border: 1px solid var(--color-ink); border-radius: 50%; background: var(--color-paper);
  }
  .photo-rail li:has([aria-current])::before { background: var(--color-ink); }
  .rail-changing li:has([aria-current])::before {
    transform-origin: var(--connector-origin, left);
    animation: draw-photo-connector 140ms ease-out var(--thumbnail-settle-delay) backwards;
  }
  @keyframes draw-photo-connector { from { scale: var(--connector-start, 0 1); } }
  .traveling-dot {
    position: absolute; top: 50%; left: 0; z-index: 1;
    width: 11px; height: 11px; translate: -50% -50%;
    border: 1px solid var(--color-ink); border-radius: 50%;
    background: var(--color-route); pointer-events: none;
  }
  .photo-rail button {
    display: grid; width: 100%; min-height: 44px; padding: 0;
    border: 0; background: transparent; color: var(--color-ink); text-align: left;
  }
  .photo-rail button:focus-visible { outline-offset: 2px; }
  .thumbnail-print {
    display: grid; padding: 3px 3px 0;
    border: 1px solid var(--color-unread); background: var(--color-paper);
    transition: translate 150ms ease-out, background-color 150ms ease-out;
  }
  .photo-rail button:hover .thumbnail-print { border-color: var(--color-ink); }
  .photo-rail button[aria-current] .thumbnail-print {
    translate: var(--print-selection-shift, -3px 0);
    border-color: var(--color-ink); background: var(--color-route);
  }
  .rail-changing button[aria-current] .thumbnail-print {
    animation: settle-thumbnail 145ms cubic-bezier(.2,.8,.2,1) var(--thumbnail-settle-delay) backwards;
  }
  @keyframes settle-thumbnail {
    from { translate: 0 0; rotate: -1.5deg; background-color: var(--color-paper); }
  }
  .photo-rail img { width: 100%; height: clamp(42px, 9dvh, 84px); object-fit: cover; background: var(--color-map-water); }
  .thumbnail-time {
    padding: .26rem .18rem .28rem; font-size: .7rem; font-weight: 750;
    font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
  }

  @media (max-width: 599px), (min-height: 520px) and (max-width: 899px) {
    .full-photo .photo-stage { --browse-x: calc(1% * var(--browse-direction)); --browse-y: 0%; }
    .full-photo .photo-frame {
      align-self: center;
      height: min(100%, calc((100vw - 1.75rem) / var(--tallest-ratio) + 4.75rem));
    }
    .full-photo .photo-frame.has-strip {
      grid-template: minmax(0, 1fr) auto / minmax(0, 1fr);
      height: min(100%, calc((100vw - 1.75rem) / var(--tallest-ratio) + 11.25rem));
    }
    .full-photo .photo-rail {
      --connector-origin: top;
      --connector-start: 1 0;
      --print-selection-shift: 0 -3px;
      border-left: 0; border-top: 1px solid var(--color-ink);
    }
    .full-photo .photo-rail ol { flex-direction: row; padding: .65rem .4rem .35rem; }
    .full-photo .photo-rail li {
      width: clamp(72px, 23vw, 106px); padding: calc(.5rem + var(--stagger)) .25rem .25rem;
      border-left: 0; border-top: 1px dashed var(--color-unread);
    }
    .full-photo .photo-rail li:nth-child(even) { --stagger: .3rem; }
    .full-photo .photo-rail li::before {
      top: 0; left: 50%; width: 1px; height: calc(.5rem + var(--stagger)); clip-path: none;
    }
    .full-photo .photo-rail li::after { top: 0; left: 50%; }
    .full-photo .traveling-dot { top: 0; left: 50%; }
    .full-photo .photo-rail img { height: clamp(36px, 6dvh, 62px); }
  }
  @media (max-width: 699px) { .print-label.single { display: none; } }
  @media (prefers-reduced-motion: reduce) {
    .photo-stacks,.expanded-photo.arriving { animation: none; }
    .departing-print { animation: print-dissolve 130ms ease-out both; }
    .stack-image > :is(img,svg),.stack-back img,.split-photo { transition: none; }
    .rail-changing li:has([aria-current])::before,
    .rail-changing button[aria-current] .thumbnail-print { animation: none; }
    .thumbnail-print { transition: none; }
  }
</style>
