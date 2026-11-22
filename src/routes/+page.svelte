<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { asset } from '$app/paths';
  import RouteAtlas from '#lib/map/RouteAtlas.svelte';
  import type { ReadingPosition } from '#lib/map/route-progress.js';
  import type { MapFraming, ScreenPoint } from '#lib/map/route-data.js';
  import article from '../../content/article.json';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  type PhotoPlacement = { after: number; images: string[] };
  type Photo = (typeof article.images)[keyof typeof article.images];

  const photosByKey: Readonly<Record<string, Photo | undefined>> = article.images;
  const day = (number: number) => String(number).padStart(2, '0');
  const chapters = article.chapters.map((chapter, index) => ({ ...chapter, number: day(index + 1) }));
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  // With the flag on there is no reading position, so the atlas shows the completed route.
  const completeRide: ReadingPosition = { chapter: chapters.length, fraction: 1, percent: 100 };

  const articleHidden = $derived(data.articleHidden);
  let position = $state<ReadingPosition>({ chapter: -1, fraction: 0, percent: 0 });
  let framing = $state<MapFraming>();
  let scrollPosition = $state(0);
  let exploring = $state(false);
  let paperHidden = $state(false);
  let positioningPaper = $state(false);
  let paperDockInset = $state(0);
  let paperOffset = $state<string>();
  let cover: HTMLElement;
  let coverPaper: HTMLDivElement;
  let intro = $state<HTMLElement>();
  let journal = $state<HTMLElement>();
  let afterword = $state<HTMLElement>();
  let atlas = $state<HTMLElement>();
  let toggle = $state<HTMLButtonElement>();
  let sections: HTMLElement[] = [];
  let frame: number | undefined;
  let readingScroll = 0;
  let exploreSequence = 0;
  let returnOffset: ScreenPoint | undefined;
  let docked: MediaQueryList;
  let alternating: MediaQueryList;
  let reducedMotion: MediaQueryList;

  const atlasPosition = $derived(articleHidden ? completeRide : position);

  function getPhoto(key: string) {
    const photo = photosByKey[key];
    if (!photo) throw new Error(`Unknown journal photo: ${key}`);
    return photo;
  }

  function updateReading() {
    frame = undefined;
    if (articleHidden || exploring || !atlas || !journal || !intro || !afterword || !sections.length) return;
    scrollPosition = window.scrollY;
    const page = document.documentElement;
    const maxScroll = page.scrollHeight - page.clientHeight;
    const started = maxScroll > 0 && scrollPosition > 0;
    const finished = started && scrollPosition >= maxScroll;
    const line = docked.matches
      ? Math.max(0, Math.min(atlas.getBoundingClientRect().bottom, atlas.offsetHeight)) + 32
      : Math.min(145, window.innerHeight * 0.2);
    const tops = sections.map((section) => section.getBoundingClientRect().top);
    const current = tops.findLastIndex((top) => top <= line);
    const chapter = finished ? sections.length : started ? Math.max(0, current) : -1;
    const percent = finished ? 100 : started ? Math.max(1, Math.min(99, Math.round(100 * scrollPosition / maxScroll))) : 0;
    let fraction = Number(finished);
    if (started && !finished) {
      // Keep the chapter transitions at the reading line and extend the first and last legs to the page edges.
      const start = chapter === 0 ? -scrollPosition : tops[chapter] - line;
      const nextTop = tops[chapter + 1];
      const end = nextTop === undefined ? maxScroll - scrollPosition : nextTop - line;
      fraction = clamp(-start / (end - start));
    }
    if (chapter !== position.chapter || fraction !== position.fraction || percent !== position.percent) {
      position = { chapter, fraction, percent };
    }

    if (docked.matches) {
      if (framing) framing = undefined;
      return;
    }
    const width = journal.clientWidth;
    const coverRight = cover.getBoundingClientRect().right;
    const introRect = intro.getBoundingClientRect();
    const next = sections[current + 1] ?? afterword;
    const nextTop = tops[current + 1] ?? afterword.getBoundingClientRect().top;
    const blend = clamp((window.innerHeight * .85 - nextTop) / (window.innerHeight * .65));
    const side = (element: HTMLElement | undefined) =>
      Number(alternating.matches && !!element?.classList.contains('story-panel--right'));
    const ratio = reducedMotion.matches ? Number(blend === 1) : blend;
    const currentSide = side(sections[current]);
    const readingSide = currentSide + (side(next) - currentSide) * ratio;
    const introBlend = clamp((window.innerHeight - introRect.top) / (window.innerHeight * .45));
    const leftPanelRight = current < 0 ? coverRight + (introRect.right - coverRight) * introBlend : introRect.right;
    const rightEdge = width - 104;
    const leftLaneEnd = sections[1].getBoundingClientRect().left - 22;
    const rightLaneStart = leftPanelRight + 22;
    const rightCenter = (rightLaneStart + rightEdge) / 2;
    const leftCenter = (24 + leftLaneEnd) / 2;
    const lane = alternating.matches ? Math.min(rightEdge - rightLaneStart, leftLaneEnd - 24) : rightEdge - rightLaneStart;
    const center = Math.round(rightCenter + (leftCenter - rightCenter) * readingSide);
    const available = Math.max(100, Math.floor(lane - 72));
    if (framing?.center !== center || framing.width !== available) framing = { center, width: available };
  }

  function scheduleReading() {
    frame ??= requestAnimationFrame(updateReading);
  }

  function slideOffset(direction?: ScreenPoint) {
    if (!direction) return;
    const distance = Math.hypot(direction.x, direction.y);
    if (distance < 1) return;
    const scale = (docked.matches ? 12 : 24) / distance;
    return `${direction.x * scale}px ${direction.y * scale}px`;
  }

  async function setExploring(open: boolean, drag?: ScreenPoint) {
    if (open === exploring) return;
    const sequence = ++exploreSequence;
    returnOffset = undefined;
    if (open) {
      readingScroll = window.scrollY;
      paperDockInset = docked.matches && atlas
        ? Math.max(0, atlas.getBoundingClientRect().bottom - (journal?.getBoundingClientRect().top ?? 0))
        : 0;
      positioningPaper = false;
      paperOffset = slideOffset(drag);
      paperHidden = true;
    }
    exploring = open;
    document.documentElement.classList.toggle('is-map-exploring', open);
    await tick();
    if (sequence !== exploreSequence) return;
    if (!open) {
      if (window.scrollY !== readingScroll) window.scrollTo(0, readingScroll);
      const offset = slideOffset(returnOffset);
      if (!reducedMotion.matches && offset !== paperOffset && getComputedStyle(coverPaper).visibility === 'hidden') {
        positioningPaper = true;
        paperOffset = offset;
        await tick();
        if (sequence !== exploreSequence) return;
        // Commit the new starting position while the paper is still invisible.
        getComputedStyle(coverPaper).translate;
        positioningPaper = false;
      }
      paperHidden = false;
    }
    toggle?.focus({ preventScroll: true });
    scheduleReading();
  }

  async function jumpToChapter(id: string) {
    if (exploring) await setExploring(false);
    const heading = document.getElementById(id);
    if (!heading) return;
    if (window.location.hash !== '#' + id) window.location.hash = id;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView();
    scheduleReading();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && exploring) {
      event.preventDefault();
      void setExploring(false);
    }
  }

  onMount(() => {
    docked = matchMedia('(max-width: 1060px)');
    alternating = matchMedia('(min-width: 1181px)');
    reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    sections = journal ? Array.from(journal.querySelectorAll<HTMLElement>('[data-chapter]')) : [];
    const resize = new ResizeObserver(scheduleReading);
    if (journal) resize.observe(journal);
    resize.observe(document.body);
    scheduleReading();
    return () => {
      resize.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.documentElement.classList.remove('is-map-exploring');
    };
  });
</script>

<svelte:head>
  <title>NorthCape 4000 — The long way north</title>
  <meta name="description" content="A firsthand account of the 2022 NorthCape 4000, from Rovereto to North Cape, with an interactive route and photos from the ride.">
  <meta name="theme-color" content="#ffdf32">
  <link rel="preload" href={asset('assets/barlow-condensed-800.woff2')} as="font" type="font/woff2" crossorigin="anonymous">
</svelte:head>

<svelte:window onscroll={scheduleReading} onresize={scheduleReading} onpageshow={scheduleReading} onkeydown={onKeydown} />

{#snippet prose(paragraphs: string[], photos: PhotoPlacement[] = [])}
  {@const placements = new Map(photos.map(({ after, images }) => [after, images]))}
  {#each paragraphs as paragraph, index}
    {@const keys = placements.get(index + 1)}
    <p class="prose">{paragraph}</p>
    {#if keys}
      <div class={`photo-strip photo-strip--${keys.length}`}>
        {#each keys as key (key)}
          {@const photo = getPhoto(key)}
          <figure class={photo.height > photo.width ? 'photo--portrait' : 'photo--landscape'}>
            <img src={asset(`assets/${key as keyof typeof article.images}.webp`)} alt={photo.alt} width={photo.width} height={photo.height} loading="lazy" decoding="async">
            <figcaption>{photo.caption}<span>{photo.date}</span></figcaption>
          </figure>
        {/each}
      </div>
    {/if}
  {/each}
{/snippet}

{#if !articleHidden}
  <a class="skip-link" href="#story" inert={exploring}>Skip to the story</a>
{/if}
<header class="masthead" inert={exploring}>
  <a class="masthead__title" href="#top" aria-label="NorthCape 4000, top of page">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 1v22M1 12h22M12 4.5l4 7.5-4 7.5-4-7.5Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M12 4.5 16 12h-4V4.5Z" fill="currentColor"/></svg>
    NorthCape 4000
  </a>
</header>

<main class="journey" class:is-map-only={articleHidden} class:is-paper-hidden={paperHidden} class:is-positioning-paper={positioningPaper} style:--paper-offset={paperOffset}>
  <section class="cover" aria-labelledby="cover-title" inert={exploring} bind:this={cover}>
    <div class="paper-surface" bind:this={coverPaper}>
      <div class="paper-content">
        <h1 id="cover-title">The long<br> way north</h1>
        <p>From the Italian Alps to the edge of Europe by bicycle.</p>
        <p class="ride-facts">≈3,825 km <span></span> 22 days <span></span> 2022</p>
        {#if !articleHidden}
          <a class="cover__action" href="#story">
            Read the story
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v15m-5-5 5 5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>
        {/if}
      </div>
    </div>
  </section>

  <RouteAtlas {chapters} position={atlasPosition} {framing} {scrollPosition} {exploring} mapOnly={articleHidden} onExplore={setExploring}
    onReturnCamera={(offset) => { returnOffset = offset; }} onChapter={jumpToChapter} bind:element={atlas} bind:toggle />

  {#if !articleHidden}
  <article class="journal" aria-labelledby="story" inert={exploring} bind:this={journal} style:--paper-dock-inset={`${paperDockInset}px`}>
    <section class="story-panel" aria-labelledby="story" bind:this={intro}>
      <div class="paper-surface">
        <div class="paper-content">
          <header class="chapter-head">
            <h2 id="story" tabindex="-1">Rovereto to North Cape</h2>
          </header>
          <p class="reading-hint">Scroll the story to trace the ride. Choose a map stop to jump to its chapter.</p>
          {@render prose(article.intro)}
        </div>
      </div>
    </section>
    {#each chapters as chapter, index (chapter.id)}
      <section class="story-panel" class:story-panel--right={index % 2 === 1} aria-labelledby={chapter.id} data-chapter>
        <div class="paper-surface">
          <div class="paper-content">
            <header class="chapter-head">
              <h2 id={chapter.id} tabindex="-1">{chapter.title}</h2>
              <p class="chapter-meta">Days {day(chapter.days[0])}–{day(chapter.days[1])} · {chapter.location}</p>
            </header>
            {@render prose(chapter.paragraphs, chapter.photos)}
          </div>
        </div>
      </section>
    {/each}
    <section class="story-panel story-panel--right" aria-labelledby="afterword" bind:this={afterword}>
      <div class="paper-surface">
        <div class="paper-content">
          <header class="chapter-head"><h2 id="afterword" tabindex="-1">The way home</h2></header>
          {@render prose(article.afterword, article.afterwordPhotos)}
        </div>
      </div>
    </section>
  </article>
  {/if}
</main>

{#if !articleHidden}
  <footer class="journal__footer" inert={exploring}>
    <nav id="chapters" aria-label="Chapter stops">
      <ul>
        {#each chapters as chapter (chapter.id)}
          <li><a href={'#' + chapter.id} title={chapter.title}>{chapter.pin}</a></li>
        {/each}
      </ul>
    </nav>
    <a href="#top">Back to the start</a>
  </footer>
{/if}
