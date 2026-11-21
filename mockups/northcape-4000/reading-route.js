(() => {
  const journey = document.querySelector('.journey');
  const stage = document.querySelector('.map-stage');
  const mapSheet = document.querySelector('.map-sheet');
  const map = document.querySelector('#journey-map');
  const explore = document.querySelector('.explore');
  const storyRegions = document.querySelectorAll('.skip, .masthead, .journey-cover, .journey-story, .journey-footer');
  const progress = document.querySelector('.reading-value');
  const place = document.querySelector('.reading-place');
  const dot = map.querySelector('.position-dot');
  const pins = Array.from(map.querySelectorAll('.map-pin'));
  const panels = Array.from(document.querySelectorAll('.journey-story [data-chapter]'));
  const end = document.querySelector('#afterword');
  const docked = matchMedia('(max-width: 1060px)');
  const wide = matchMedia('(min-width: 1181px)');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const intro = document.querySelector('#story');
  const rightPanel = document.querySelector('.reading-panel--right');
  const trackBounds = Array.from(map.querySelectorAll('defs > path'), (path) => path.getBBox());
  const west = Math.min(...trackBounds.map(({ x }) => x));
  const east = Math.max(...trackBounds.map(({ x, width }) => x + width));

  const chapterTracks = new Map(panels.map(({ id }) => [id, { segments: [], length: 0 }]));
  for (const trace of map.querySelectorAll('.trace-mask')) {
    const chapter = chapterTracks.get(trace.dataset.chapter);
    const length = trace.getTotalLength();
    chapter.segments.push({ trace, length, start: chapter.length });
    chapter.length += length;
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let lastProgress = -1;
  let lastChapter = -1;
  let lastFraction = -1;
  let queued = false;

  function updateTrace(chapterIndex, fraction) {
    let head;
    for (const [index, panel] of panels.entries()) {
      const chapter = chapterTracks.get(panel.id);
      const completed = index < chapterIndex ? chapter.length : index === chapterIndex ? fraction * chapter.length : 0;
      for (const { trace, length, start } of chapter.segments) {
        const read = clamp(completed - start, 0, length);
        const dash = (length ? read / length : 0) + ' 1';
        if (trace.getAttribute('stroke-dasharray') !== dash) trace.setAttribute('stroke-dasharray', dash);
        if (!head || completed > start) head = { trace, read };
      }
    }
    if (!head) return;
    const tip = head.trace.getPointAtLength(head.read);
    dot.setAttribute('cx', tip.x);
    dot.setAttribute('cy', tip.y);
  }

  function updateReading() {
    queued = false;
    if (readingCamera) return;
    const line = docked.matches
      ? clamp(stage.getBoundingClientRect().bottom, 0, stage.offsetHeight) + 32
      : Math.min(145, innerHeight * 0.2);
    const tops = panels.map((panel) => panel.getBoundingClientRect().top);
    const last = end.getBoundingClientRect().top;
    const index = tops.findLastIndex((top) => top <= line);
    const finished = last <= line;
    const fraction = index < 0 ? 0 : clamp((line - tops[index]) / ((tops[index + 1] ?? last) - tops[index]), 0, 1);
    const percent = Math.round(100 * clamp((line - tops[0]) / (last - tops[0]), 0, 1));

    alignMap(index);

    if (percent !== lastProgress) {
      progress.setAttribute('aria-valuenow', percent);
      progress.firstElementChild.textContent = percent + '%';
      lastProgress = percent;
    }
    const chapter = finished ? panels.length : index;
    if (chapter !== lastChapter) {
      const section = finished ? end : panels[index];
      journey.dataset.readingSide = section?.classList.contains('reading-panel--right') ? 'right' : 'left';
      place.textContent = finished ? 'North Cape reached' : index < 0
        ? 'Rovereto to North Cape'
        : panels[index].querySelector('h2').textContent;
      for (const [pinIndex, pin] of pins.entries()) {
        if (pinIndex === index) pin.setAttribute('aria-current', 'location');
        else pin.removeAttribute('aria-current');
      }
    }
    // Avoid setting SVG attributes when the route tip has barely moved.
    const step = Math.round(fraction * 600);
    if (chapter !== lastChapter || step !== lastFraction) {
      updateTrace(chapter, step / 600);
      lastChapter = chapter;
      lastFraction = step;
    }
  }

  function scheduleReading() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(updateReading);
  }

  const camera = { x: 30, y: 695, zoom: 1, followsStory: true };
  let activePanel = -1;
  let readingCamera;
  let readingScroll;
  let mapFrame;
  let cameraTransition;

  function measureMap() {
    const { left, width, height } = map.getBoundingClientRect();
    if (!width || !height) return;
    let overviewHeight = Math.max(1540, 620 * height / width);
    let leftPanelCenter = width / 2;
    let rightPanelCenter = width / 2;

    if (!docked.matches && !readingCamera) {
      const rightOfText = intro.getBoundingClientRect().right - left + 22;
      const leftOfControls = width - 112;
      const availableOnRight = leftOfControls - rightOfText;
      const leftOfText = rightPanel.getBoundingClientRect().left - left - 22;
      const availableOnLeft = leftOfText - 24;
      const availableWidth = wide.matches ? Math.min(availableOnLeft, availableOnRight) : availableOnRight;
      // Reserve space for the route labels in the narrower of the two lanes.
      overviewHeight = Math.max(overviewHeight, (east - west) * height / Math.max(availableWidth - 72, 1));
      leftPanelCenter = (rightOfText + leftOfControls) / 2;
      rightPanelCenter = (24 + leftOfText) / 2;
    }

    const worldPerPixel = overviewHeight / height;
    const routeCenter = (west + east) / 2;
    mapFrame = {
      width,
      height,
      overviewHeight,
      besideLeft: routeCenter + (width / 2 - leftPanelCenter) * worldPerPixel,
      besideRight: routeCenter + (width / 2 - rightPanelCenter) * worldPerPixel,
    };
  }

  function framedMapX(index) {
    let x = mapFrame.besideLeft;
    if (wide.matches && !readingCamera) {
      const current = panels[index] ?? intro;
      const next = panels[index + 1] ?? end;
      const startsOnRight = current.classList.contains('reading-panel--right');
      const movesRight = next.classList.contains('reading-panel--right');
      const blend = clamp((innerHeight * 0.85 - next.getBoundingClientRect().top) / (innerHeight * 0.65), 0, 1);
      const switchAt = reduceMotion.matches ? Number(blend >= 1) : blend;
      const position = Number(startsOnRight) + (Number(movesRight) - Number(startsOnRight)) * switchAt;
      x += (mapFrame.besideRight - mapFrame.besideLeft) * position;
    }
    return x;
  }

  function alignMap(index) {
    activePanel = index;
    if (cameraTransition || !camera.followsStory || !mapFrame) return;
    const x = framedMapX(index);
    if (x === camera.x) return;
    camera.x = x;
    renderMap();
  }
  let dimensions = { width: 0, height: 0 };
  const zoomOut = document.querySelector('[data-map="out"]');
  const zoomIn = document.querySelector('[data-map="in"]');
  const minZoom = 0.7;
  const maxZoom = 5;

  function renderMap() {
    if (!mapFrame) return;
    const height = mapFrame.overviewHeight / camera.zoom;
    const width = height * mapFrame.width / mapFrame.height;
    dimensions = { width, height };
    const minX = camera.x - width / 2;
    const minY = camera.y - height / 2;
    map.setAttribute('viewBox', [minX, minY, width, height].join(' '));
    map.style.setProperty('--map-scale', height / mapFrame.height);
    zoomOut.disabled = camera.zoom <= minZoom;
    zoomIn.disabled = camera.zoom >= maxZoom;
    for (const pin of pins) {
      const { x, y } = pin.dataset;
      const visible = x >= minX && x <= minX + width && y >= minY && y <= minY + height;
      pin.setAttribute('tabindex', visible ? '0' : '-1');
    }
  }

  function zoom(factor, screenX, screenY) {
    const next = clamp(camera.zoom * factor, minZoom, maxZoom);
    if (next === camera.zoom) return;
    stopCameraTransition();
    if (screenX !== undefined) {
      const rect = map.getBoundingClientRect();
      const x = ((screenX - rect.left) / rect.width - 0.5) * dimensions.width;
      const y = ((screenY - rect.top) / rect.height - 0.5) * dimensions.height;
      camera.x += x * (1 - camera.zoom / next);
      camera.y += y * (1 - camera.zoom / next);
    }
    camera.zoom = next;
    camera.followsStory = false;
    renderMap();
  }

  function pan(x, y) {
    stopCameraTransition();
    camera.followsStory = false;
    const ratio = dimensions.height / map.clientHeight;
    camera.x = clamp(camera.x + x * ratio, -1450, 1850);
    camera.y = clamp(camera.y + y * ratio, -400, 1970);
    renderMap();
  }

  function resetMap() {
    stopCameraTransition();
    Object.assign(camera, { y: 695, zoom: 1, followsStory: true });
    alignMap(activePanel);
    renderMap();
  }

  function stopCameraTransition() {
    if (!cameraTransition) return;
    const { frame, destination } = cameraTransition;
    cancelAnimationFrame(frame);
    cameraTransition = undefined;
    return destination;
  }

  function moveCamera(destination, previousScale, animate) {
    const targetX = () => destination.followsStory ? framedMapX(activePanel) : destination.x;
    if (!animate || reduceMotion.matches) {
      Object.assign(camera, destination, { x: targetX() });
      renderMap();
      return;
    }

    // Keep the same map scale when the phone viewport changes size so the
    // camera can ease into the new framing without a jump in zoom.
    const start = { ...camera, zoom: mapFrame.overviewHeight / mapFrame.height / previousScale };
    camera.zoom = start.zoom;
    renderMap();

    const startTime = performance.now();
    const duration = 280;
    cameraTransition = { destination, frame: requestAnimationFrame(tick) };

    function tick(now) {
      const fraction = clamp((now - startTime) / duration, 0, 1);
      if (fraction === 1 || reduceMotion.matches) {
        cameraTransition = undefined;
        Object.assign(camera, destination, { x: targetX() });
        renderMap();
        return;
      }

      const eased = 1 - (1 - fraction) ** 3;
      camera.x = start.x + (targetX() - start.x) * eased;
      camera.y = start.y + (destination.y - start.y) * eased;
      camera.zoom = start.zoom * (destination.zoom / start.zoom) ** eased;
      renderMap();
      cameraTransition.frame = requestAnimationFrame(tick);
    }
  }

  function setExploring(open, animate = false) {
    if (open === Boolean(readingCamera)) return;
    const interrupted = stopCameraTransition();
    const destination = open ? interrupted ?? { ...camera } : readingCamera;
    const previousScale = dimensions.height / mapFrame.height;
    if (open) readingScroll = window.scrollY;
    readingCamera = open ? destination : undefined;
    document.documentElement.classList.toggle('is-map-exploring', open);
    journey.classList.toggle('is-exploring', open);
    for (const region of storyRegions) region.inert = open;
    if (open) {
      mapSheet.setAttribute('role', 'dialog');
      mapSheet.setAttribute('aria-modal', 'true');
      mapSheet.setAttribute('aria-describedby', 'map-gesture');
      explore.focus({ preventScroll: true });
    } else {
      mapSheet.removeAttribute('role');
      mapSheet.removeAttribute('aria-modal');
      mapSheet.removeAttribute('aria-describedby');
      if (window.scrollY !== readingScroll) window.scrollTo(0, readingScroll);
      scheduleReading();
    }
    explore.setAttribute('aria-expanded', String(open));
    explore.textContent = open ? 'Back to story' : 'Explore map';
    measureMap();
    moveCamera(destination, previousScale, animate);
  }

  explore.addEventListener('click', () => setExploring(!readingCamera, true));
  for (const link of document.querySelectorAll('a[href="#story"], a[href="#top"]')) {
    link.addEventListener('click', () => setExploring(false));
  }
  zoomIn.addEventListener('click', () => zoom(1.34));
  zoomOut.addEventListener('click', () => zoom(1 / 1.34));
  document.querySelector('[data-map="fit"]').addEventListener('click', resetMap);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || explore.getAttribute('aria-expanded') !== 'true') return;
    setExploring(false, true);
    explore.focus({ preventScroll: true });
  });

  mapSheet.addEventListener('wheel', (event) => {
    if (!readingCamera) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? map.clientHeight : 1;
    const delta = clamp(event.deltaY * unit, -380, 380);
    if (delta) zoom(Math.exp(-delta / 500), event.clientX, event.clientY);
  }, { passive: false });

  map.addEventListener('keydown', (event) => {
    if (event.target !== map) return;
    const offsets = { ArrowUp: [0, -45], ArrowDown: [0, 45], ArrowLeft: [-45, 0], ArrowRight: [45, 0] };
    if (offsets[event.key]) pan(...offsets[event.key]);
    else if (event.key === '+' || event.key === '=') zoom(1.34);
    else if (event.key === '-') zoom(1 / 1.34);
    else if (event.key === 'Home') resetMap();
    else return;
    event.preventDefault();
  });

  const pointers = new Map();
  let dragged = false;
  const midpoint = (a, b) => [(a.x + b.x) / 2, (a.y + b.y) / 2];
  const separation = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  map.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.pointerType === 'touch' && docked.matches && !journey.classList.contains('is-exploring'))) return;
    if (pointers.size === 0) dragged = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });

  window.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    const second = [...pointers.entries()].find(([key]) => key !== event.pointerId);
    if (!dragged && !second && separation(previous, point) < 4) return;
    dragged = true;
    map.classList.add('is-dragging');
    pointers.set(event.pointerId, point);
    if (second) {
      const other = second[1];
      const before = midpoint(previous, other);
      const after = midpoint(point, other);
      const distance = separation(previous, other);
      if (distance) zoom(separation(point, other) / distance, ...before);
      pan(before[0] - after[0], before[1] - after[1]);
    } else {
      pan(previous.x - point.x, previous.y - point.y);
    }
  });

  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (!pointers.size) map.classList.remove('is-dragging');
  }

  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  map.addEventListener('click', (event) => {
    if (dragged && event.detail > 0) {
      event.preventDefault();
      dragged = false;
      return;
    }
    if (event.target.closest('a')) setExploring(false);
  });

  const resize = new ResizeObserver(() => {
    measureMap();
    renderMap();
    scheduleReading();
  });
  resize.observe(map);
  resize.observe(document.querySelector('.journey-story'));
  window.addEventListener('scroll', scheduleReading, { passive: true });
  window.addEventListener('pageshow', scheduleReading);
  measureMap();
  renderMap();
  scheduleReading();
})();
