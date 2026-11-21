<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { asset } from '$app/paths';
  import RouteAtlas from '#lib/map/RouteAtlas.svelte';
  import type { ReadingPosition } from '#lib/map/route-progress.js';
  import type { MapFraming } from '#lib/map/route-data.js';
  import article from '../../content/article.json';

  type PhotoPlacement = { after: number; images: string[] };
  type Photo = (typeof article.images)[keyof typeof article.images];

  const photosByKey: Readonly<Record<string, Photo | undefined>> = article.images;
  const day = (number: number) => String(number).padStart(2, '0');
  const chapters = article.chapters.map((chapter, index) => ({ ...chapter, number: day(index + 1) }));
  const clamp = (value: number) => Math.max(0, Math.min(1, value));

  let position = $state<ReadingPosition>({ chapter: -1, fraction: 0, percent: 0 });
  let framing = $state<MapFraming>();
  let scrollPosition = $state(0);
  let exploring = $state(false);
  let cover: HTMLElement;
  let intro: HTMLElement;
  let journal: HTMLElement;
  let afterword: HTMLElement;
  let atlas = $state<HTMLElement>();
  let toggle = $state<HTMLButtonElement>();
  let sections: HTMLElement[] = [];
  let frame: number | undefined;
  let readingScroll = 0;
  let docked: MediaQueryList;
  let alternating: MediaQueryList;
  let reducedMotion: MediaQueryList;

  function getPhoto(key: string) {
    const photo = photosByKey[key];
    if (!photo) throw new Error(`Unknown journal photo: ${key}`);
    return photo;
  }

  function updateReading() {
    frame = undefined;
    if (exploring || !atlas || !sections.length) return;
    scrollPosition = window.scrollY;
    const line = docked.matches
      ? Math.max(0, Math.min(atlas.getBoundingClientRect().bottom, atlas.offsetHeight)) + 32
      : Math.min(145, window.innerHeight * 0.2);
    const tops = sections.map((section) => section.getBoundingClientRect().top);
    const end = afterword.getBoundingClientRect().top;
    const current = tops.findLastIndex((top) => top <= line);
    const finished = end <= line;
    const chapter = finished ? chapters.length : current;
    const fraction = finished ? 1 : current < 0 ? 0
      : Math.round(clamp((line - tops[current]) / ((tops[current + 1] ?? end) - tops[current])) * 400) / 400;
    const percent = finished ? 100 : Math.min(99, Math.round(100 * clamp((line - tops[0]) / (end - tops[0]))));
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
    const blend = clamp((window.innerHeight * .85 - (tops[current + 1] ?? end)) / (window.innerHeight * .65));
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

  async function setExploring(open: boolean) {
    if (open === exploring) return;
    if (open) readingScroll = window.scrollY;
    exploring = open;
    document.documentElement.classList.toggle('is-map-exploring', open);
    await tick();
    if (exploring !== open) return;
    if (!open && window.scrollY !== readingScroll) window.scrollTo(0, readingScroll);
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
    sections = Array.from(journal.querySelectorAll<HTMLElement>('[data-chapter]'));
    const resize = new ResizeObserver(scheduleReading);
    resize.observe(journal);
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

<a class="skip-link" href="#story" inert={exploring}>Skip to the story</a>
<header class="masthead" inert={exploring}>
  <a class="masthead__title" href="#top" aria-label="NorthCape 4000, top of page">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 1v22M1 12h22M12 4.5l4 7.5-4 7.5-4-7.5Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M12 4.5 16 12h-4V4.5Z" fill="currentColor"/></svg>
    NorthCape 4000
  </a>
</header>

<main class="journey" class:is-exploring={exploring}>
  <section class="cover" aria-labelledby="cover-title" inert={exploring} bind:this={cover}>
    <h1 id="cover-title">The long<br> way north</h1>
    <p>From the Italian Alps to the edge of Europe by bicycle.</p>
    <p class="ride-facts">4,000 km <span></span> 22 days <span></span> 2022</p>
    <a class="cover__action" href="#story">
      Read the story
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v15m-5-5 5 5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </a>
  </section>

  <RouteAtlas {chapters} {position} {framing} {scrollPosition} {exploring} onToggle={() => setExploring(!exploring)} onChapter={jumpToChapter} bind:element={atlas} bind:toggle />

  <article class="journal" aria-labelledby="story" inert={exploring} bind:this={journal}>
    <section class="story-panel" aria-labelledby="story" bind:this={intro}>
      <header class="chapter-head">
        <h2 id="story" tabindex="-1">Rovereto to North Cape</h2>
      </header>
      <p class="reading-hint">Scroll the story to trace the ride. Choose a map stop to jump to its chapter.</p>
      {@render prose(article.intro)}
    </section>
    {#each chapters as chapter, index (chapter.id)}
      <section class="story-panel" class:story-panel--right={index % 2 === 1} aria-labelledby={chapter.id} data-chapter>
        <header class="chapter-head">
          <h2 id={chapter.id} tabindex="-1">{chapter.title}</h2>
          <p class="chapter-meta">Days {day(chapter.days[0])}–{day(chapter.days[1])} · {chapter.location}</p>
        </header>
        {@render prose(chapter.paragraphs, chapter.photos)}
      </section>
    {/each}
    <section class="story-panel story-panel--right" aria-labelledby="afterword" bind:this={afterword}>
      <header class="chapter-head"><h2 id="afterword" tabindex="-1">The way home</h2></header>
      {@render prose(article.afterword, article.afterwordPhotos)}
    </section>
  </article>
</main>

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
