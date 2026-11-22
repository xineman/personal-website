<script lang="ts">
  import RouteMap from './RouteMap.svelte';
  import type { MapFraming, RouteChapter, ScreenPoint } from './route-data.js';
  import type { ReadingPosition } from './route-progress.js';

  interface Props {
    chapters: RouteChapter[];
    position: ReadingPosition;
    framing: MapFraming | undefined;
    scrollPosition: number;
    exploring: boolean;
    articleHidden: boolean;
    onExplore: (open: boolean, drag?: ScreenPoint) => void;
    onReturnCamera: (offset: ScreenPoint) => void;
    onChapter: (id: string) => void;
    element?: HTMLElement;
    toggle?: HTMLButtonElement;
  }

  let { chapters, position, framing, scrollPosition, exploring, articleHidden, onExplore, onReturnCamera, onChapter, element = $bindable(), toggle = $bindable() }: Props = $props();
  const active = $derived(chapters[Math.min(position.chapter, chapters.length - 1)]);
  const place = $derived(position.percent === 100 ? 'North Cape reached' : active?.title ?? 'Rovereto to North Cape');
  const onRight = $derived(!articleHidden && (position.chapter % 2 === 1 || position.chapter >= chapters.length));
  const returnLabel = $derived(articleHidden ? 'Back to overview' : 'Back to story');
  let ready = $state(false);
</script>

<aside class="atlas" class:exploring class:article-hidden={articleHidden} class:panel-right={onRight} id="route" tabindex="-1" aria-label="Route" bind:this={element}>
  <section class="map-sheet" role={exploring ? 'dialog' : undefined} aria-modal={exploring ? true : undefined}
    aria-label="Interactive map of the ride" aria-describedby={exploring ? 'map-gesture' : undefined}>
    <RouteMap {chapters} {position} {framing} {scrollPosition} {exploring} {articleHidden} {onExplore} {onReturnCamera} {onChapter} bind:ready />

    {#if ready}
      {#if !articleHidden}
        <div class="reading-status">
          <div class="reading-value" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={position.percent}>
            <span>{position.percent}%</span> read
          </div>
          <p>{place}</p>
        </div>
      {/if}
      <div class="map-compass" aria-label="North is up">
        <span>N</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4 6 20l6-4 6 4-6-16Zm0 1v11" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      </div>
      <button class="explore" type="button" onclick={() => onExplore(!exploring)} aria-expanded={exploring} bind:this={toggle}>
        {exploring ? returnLabel : 'Explore map'}
      </button>
      {#if exploring}
        <p id="map-gesture" class="map-gesture">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m3 19 4-8 4 1m5-3 5-4" />
            <circle cx="13.5" cy="11" r="3" fill="var(--color-route)" />
          </svg>
          <span class="mouse"><strong>Click the route line</strong> to pin ride data</span>
          <span class="touch"><strong>Tap the route line</strong> to pin ride data</span>
        </p>
      {/if}
      <p class="map-key" aria-label="Route legend">
        <span><i></i>{articleHidden ? 'Route' : 'Read'}</span>
        {#if !articleHidden}<span><i></i>Ahead</span>{/if}
        <span class="ferry"><i></i>Ferry</span><span class="official"><i></i>Official course</span>
      </p>
    {/if}
  </section>
</aside>

<style>
  .atlas {
    position: sticky;
    top: 0;
    grid-area: 1 / 1 / 3;
    align-self: start;
    height: 100svh;
    min-height: 24rem;
  }
  .atlas.exploring { z-index: 4; }
  .map-sheet { position: absolute; inset: 0; overflow: hidden; }
  .exploring .map-sheet { position: fixed; inset: 0 0 auto; height: 100dvh; }
  .reading-status, .map-key, .map-gesture {
    position: absolute;
    background: var(--color-paper);
    font-size: .75rem;
    font-weight: 650;
    pointer-events: none;
  }
  .reading-status { top: 1.35rem; right: .85rem; width: 8.2rem; padding: .65rem .85rem .7rem; }
  .reading-status p { margin-top: .25rem; font-size: .81rem; line-height: 1.38; }
  .reading-value { display: flex; align-items: baseline; gap: .4rem; font-size: .87rem; font-weight: 750; }
  .reading-value span { font: 800 2rem/.95 var(--font-display); font-variant-numeric: tabular-nums; }
  .map-compass {
    position: absolute;
    top: 8.4rem;
    right: 1.25rem;
    display: grid;
    justify-items: center;
    font-size: .7rem;
    font-weight: 800;
    pointer-events: none;
  }
  .explore {
    position: absolute;
    right: 1.25rem;
    bottom: 2.25rem;
    min-height: 2.75rem;
    padding: .45rem .75rem;
    border: 1px solid var(--color-ink);
    background: var(--color-paper);
    color: var(--color-ink);
    font-size: .85rem;
    font-weight: 730;
    cursor: pointer;
  }
  .explore:hover { background: var(--color-route); }
  .explore:focus-visible { outline-offset: -4px; }
  .map-key { display: flex; flex-wrap: wrap; gap: .35rem .8rem; right: 10rem; bottom: 2.25rem; padding: .35rem .65rem; }
  .map-key span { display: inline-flex; align-items: center; gap: .33rem; }
  .map-key i { width: .9rem; border-top: 2px solid var(--color-unread); }
  .map-key span:first-child i { border-top: 3px solid #a27800; }
  .ferry i { border-top-style: dotted; }
  .official i { border-top-style: dashed; }
  .map-gesture {
    top: 1.35rem;
    left: var(--edge);
    display: flex;
    align-items: center;
    gap: .45rem;
    max-width: calc(100% - 1.1rem);
    padding: .45rem .65rem;
    font-size: .8rem;
    font-weight: 550;
    line-height: 1.35;
  }
  .map-gesture svg { flex: none; }
  .map-gesture strong { font-weight: 780; }
  .touch { display: none; }

  @media (hover: none) and (pointer: coarse) {
    .mouse { display: none; }
    .touch { display: inline; }
  }
  @media (min-width: 1061px) {
    .atlas, .map-sheet { pointer-events: none; }
    .explore { pointer-events: auto; }
    .article-hidden .map-compass { top: 1.35rem; }
  }
  @media (min-width: 1181px) {
    .panel-right:not(.exploring) .map-key { right: auto; left: var(--edge); }
  }
  @media (max-width: 1060px) {
    .atlas { z-index: 2; height: var(--dock-height); min-height: 0; border-block: 1px solid var(--color-ink); }
    .atlas.article-hidden { flex: 1 0 auto; align-self: stretch; min-height: 20rem; }
    .reading-status { top: .55rem; right: auto; left: .55rem; width: max-content; max-width: 32%; padding: .4rem .5rem; }
    .reading-status p { font-size: .665rem; }
    .reading-value { gap: .28rem; font-size: .72rem; }
    .reading-value span { font-size: 1.55rem; }
    .map-compass { top: .5rem; right: .75rem; }
    .explore { right: .55rem; bottom: 1.85rem; font-size: .76rem; }
    .map-key { display: none; }
    .exploring .map-key { display: flex; inset: 9.25rem auto auto .55rem; max-width: 10rem; }
    .map-gesture { inset: 6.7rem auto auto .55rem; }
  }
  @media print {
    .atlas { display: none; }
  }
</style>
