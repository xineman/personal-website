<script lang="ts">
  import { onMount } from 'svelte';
  import RouteMap from '#lib/RouteMap.svelte';
  import article from '../../content/article.json';
  import type { PageProps } from './$types';

  type PhotoPlacement = { after: number; images: string[] };
  type Photo = (typeof article.images)[keyof typeof article.images];

  let { data }: PageProps = $props();
  let activeId = $state<string | null>(null);
  let pastAtlas = $state(false);
  let atlas: HTMLElement;
  let routeHeading: HTMLHeadingElement;
  let sections: HTMLElement[] = [];
  let frame: number | undefined;

  const photosByKey: Readonly<Record<string, Photo | undefined>> = article.images;
  const number = (value: number) => String(value).padStart(2, '0');
  const chapters = article.chapters.map((chapter, index) => ({ ...chapter, number: number(index + 1) }));
  const current = $derived(chapters.find((chapter) => chapter.id === activeId));

  function getPhoto(key: string) {
    const photo = photosByKey[key];
    if (!photo) throw new Error(`Unknown journal photo: ${key}`);
    return photo;
  }

  function updateReadingPosition() {
    const line = Math.min(window.innerHeight * 0.25, 150);
    activeId = sections.findLast((section) => section.getBoundingClientRect().top <= line)?.dataset.chapter ?? null;
    pastAtlas = atlas.getBoundingClientRect().bottom < 0;
    frame = undefined;
  }

  function scheduleUpdate() {
    frame ??= requestAnimationFrame(updateReadingPosition);
  }

  function focusRoute(event: MouseEvent) {
    if (event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    requestAnimationFrame(() => routeHeading.focus({ preventScroll: true }));
  }

  onMount(() => {
    sections = [...document.querySelectorAll<HTMLElement>('[data-chapter]')];
    scheduleUpdate();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  });
</script>

<svelte:head>
  <title>NorthCape 4000 — The long way north</title>
  <meta name="description" content="A firsthand account of the 2022 NorthCape 4000, from Rovereto to North Cape, with an interactive route and photos from the ride.">
  <meta name="theme-color" content="#11182b">
  <link rel="preload" href="/assets/barlow-condensed-800.woff2" as="font" type="font/woff2" crossorigin="anonymous">
</svelte:head>

<svelte:window onscroll={scheduleUpdate} onresize={scheduleUpdate} onpageshow={scheduleUpdate} />

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
            <img src={'/assets/' + key + '.webp'} alt={photo.alt} width={photo.width} height={photo.height} loading="lazy" decoding="async">
            <figcaption>{photo.caption}<span>{photo.date}</span></figcaption>
          </figure>
        {/each}
      </div>
    {/if}
  {/each}
{/snippet}

<a class="skip-link" href="#story">Skip to the story</a>
<header class="masthead">
  <a class="masthead__title" href="#top" aria-label="NorthCape 4000, top of page">
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 1v22M1 12h22M12 4.5l4 7.5-4 7.5-4-7.5 4-7.5Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M12 4.5 16 12h-4V4.5Z" fill="currentColor"/></svg>
    NorthCape 4000
  </a>
  <nav class="masthead__nav" aria-label="Page">
    <a href="#story">Story</a>
    <a href="#route" onclick={focusRoute}>Route</a>
  </nav>
</header>

<main class="spread">
  <section class="cover" aria-labelledby="cover-title">
    <picture class="cover__picture">
      <source media="(max-width: 700px)" srcset="/assets/norway-rainbow-small.webp">
      <img src="/assets/norway-rainbow.webp" alt="A rainbow over open hills and a fjord in northern Norway" width="1680" height="1260" fetchpriority="high">
    </picture>
    <div class="cover__content">
      <h1 id="cover-title">NorthCape<br>4000<span>.</span></h1>
      <p>From the Italian Alps to the edge of Europe by bicycle.</p>
      <a class="cover__action" href="#story">Read the story</a>
    </div>
    <p class="cover__credit">Northern Norway <span></span> 11 Aug 2022</p>
  </section>

  <aside class="atlas" id="route" aria-labelledby="route-title" tabindex="-1" bind:this={atlas}>
    <div class="atlas__sticky" class:has-current={current}>
      <header class="atlas__header">
        <div>
          <h2 id="route-title" tabindex="-1" bind:this={routeHeading}>Follow the route</h2>
          <p>Pick a stop or route segment to jump to its chapter.</p>
        </div>
        <svg class="atlas__north" viewBox="0 0 28 42" width="22" height="34" fill="none" aria-hidden="true"><path d="M14 16 5 37l9-4.3 9 4.3L14 16Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M14 16 5 37l9-4.3V16Z" fill="currentColor"/><path d="M10.5 11V3l7 8V3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </header>
      <div class="atlas__canvas">
        <RouteMap map={data.map} {chapters} {activeId} />
      </div>
      <div class="atlas__footer">
        <p class="atlas__legend"><span><i></i>GPX track</span><span><i></i>Official course</span><span><i></i>Ferry crossing</span></p>
        <nav class="atlas__index" aria-label="Jump to chapter">
          {#each chapters as chapter, index (chapter.id)}
            <a
              href={'#' + chapter.id}
              title={chapter.title}
              aria-label={`Chapter ${index + 1}, ${chapter.title}`}
              aria-current={activeId === chapter.id ? 'location' : undefined}
              class:is-current={activeId === chapter.id}
            >{chapter.number}</a>
          {/each}
        </nav>
        <p class="atlas__current" aria-hidden="true">{current ? `Chapter ${current.number} · ${current.title}` : 'Six chapters · Italy to Norway'}</p>
      </div>
    </div>
  </aside>

  <article class="journal" aria-labelledby="story">
    <dl class="ride-facts">
      <div><dt>Course</dt><dd>4,000 km</dd></div>
      <div><dt>Time on the road</dt><dd>22 days</dd></div>
      <div><dt>Year</dt><dd>2022</dd></div>
    </dl>
    <div class="journal__content">
      <section class="story-intro" aria-labelledby="story">
        <h2 id="story" tabindex="-1">The long way north</h2>
        {@render prose(article.intro)}
      </section>
      {#each chapters as chapter (chapter.id)}
        <section class="story-chapter" aria-labelledby={chapter.id} data-chapter={chapter.id}>
          <header class="chapter-head">
            <span class="chapter-index" aria-hidden="true">{chapter.number}</span>
            <div>
              <h2 id={chapter.id} tabindex="-1">{chapter.title}</h2>
              <p class="chapter-meta">Days {number(chapter.days[0])}–{number(chapter.days[1])} <span></span> {chapter.location}</p>
            </div>
          </header>
          {@render prose(chapter.paragraphs, chapter.photos)}
        </section>
      {/each}
      <section class="story-chapter afterword" data-chapter="north-cape" aria-labelledby="afterword">
        <header class="chapter-head">
          <h2 id="afterword">The way home</h2>
        </header>
        {@render prose(article.afterword, article.afterwordPhotos)}
      </section>
      <footer class="journal__footer">
        <a href="#top">Back to the start</a>
        <p>Map geography from <a href="https://www.naturalearthdata.com/">Natural Earth</a>.</p>
      </footer>
    </div>
  </article>
</main>
<a class="mobile-route" class:is-visible={pastAtlas} href="#route" onclick={focusRoute}>
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 15 4-5 3 1 3-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5" cy="15" r="2" fill="#11182b" stroke="currentColor" stroke-width="1.5"/><circle cx="15" cy="5" r="2" fill="#11182b" stroke="currentColor" stroke-width="1.5"/></svg>
  <span>{current ? `Route · ${current.number}` : 'Route'}</span>
</a>
