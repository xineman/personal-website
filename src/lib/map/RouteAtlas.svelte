<script lang="ts">
  import RouteMap from './RouteMap.svelte';
  import type { RouteChapter } from './route-data.js';

  interface Props {
    chapters: RouteChapter[];
    activeId: string | null;
    element: HTMLElement | undefined;
    heading: HTMLHeadingElement | undefined;
  }

  // The story page uses the atlas bounds and moves focus to its heading.
  let { chapters, activeId, element = $bindable(), heading = $bindable() }: Props = $props();
  const current = $derived(chapters.find((chapter) => chapter.id === activeId));
</script>

<aside class="atlas" id="route" aria-labelledby="route-title" tabindex="-1" bind:this={element}>
  <div class="atlas__sticky">
    <header class="atlas__header">
      <div>
        <h2 id="route-title" tabindex="-1" bind:this={heading}>Follow the route</h2>
        <p><span class="atlas__drag">Drag to explore.</span><span class="atlas__touch">Explore with two fingers.</span> Pick a stop or route segment to read its chapter.</p>
      </div>
      <svg class="atlas__north" viewBox="0 0 28 42" width="22" height="34" fill="none" aria-hidden="true"><path d="M14 16 5 37l9-4.3 9 4.3L14 16Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M14 16 5 37l9-4.3V16Z" fill="currentColor"/><path d="M10.5 11V3l7 8V3" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
    </header>
    <RouteMap {chapters} {activeId} />
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
      <p class="atlas__current" aria-hidden="true">{current ? `Chapter ${current.number} · ${current.title}` : 'Rovereto to North Cape'}</p>
    </div>
  </div>
</aside>

<style>
  .atlas {
    grid-area: atlas;
    position: relative;
    min-width: 0;
    border-inline-start: 1px solid var(--color-border);
    background: var(--color-ink);
    color: var(--color-white);
  }
  .atlas__sticky {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
  }
  .atlas__header, .atlas__footer { padding-inline: clamp(1.5rem, 3vw, 3.25rem); }
  .atlas__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 1.55rem;
    padding-bottom: .85rem;
  }
  .atlas__header h2 {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 2.25rem;
    line-height: 1;
    letter-spacing: -.015em;
  }
  .atlas__header p {
    margin-top: .5rem;
    max-width: 52ch;
    color: var(--color-muted);
    font-size: .875rem;
    line-height: 1.45;
  }
  .atlas__north { flex: none; color: var(--color-route); margin-top: .2rem; }
  .atlas__footer {
    display: grid;
    gap: .7rem;
    border-top: 1px solid var(--color-border);
    padding-block: .85rem 1.1rem;
  }
  .atlas__legend, .atlas__current {
    color: var(--color-muted);
    font-size: .76rem;
    font-weight: 550;
    line-height: 1.35;
  }
  .atlas__legend, .atlas__legend span { display: flex; align-items: center; gap: .6rem; }
  .atlas__legend { flex-wrap: wrap; gap: .6rem 1.15rem; }
  .atlas__legend i { width: 1.25rem; border-top: 2px solid var(--color-route); }
  .atlas__legend span:nth-child(2) i { border-top-style: dashed; }
  .atlas__legend span:nth-child(3) i { border-top-style: dashed; border-color: var(--color-muted); }
  .atlas__index { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: .35rem; }
  .atlas__index a {
    display: grid;
    min-height: 2.75rem;
    place-items: center;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    color: var(--color-white);
    font-size: .83rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
  }
  .atlas__index a:hover { border-color: var(--color-route); }
  .atlas__index a.is-current {
    background: var(--color-route);
    border-color: var(--color-route);
    color: var(--color-ink);
  }
  .atlas__index a:focus-visible { outline-color: var(--color-white); }
  .atlas__current {
    min-height: 1.2em;
    color: var(--color-white);
  }

  @media (max-width: 960px) {
    .atlas { border: 0; }
    .atlas__sticky { position: relative; }
    .atlas__header, .atlas__footer { padding-inline: clamp(1.25rem, 6.5vw, 4.5rem); }
  }

  @media (max-height: 32rem) {
    .atlas__sticky { position: relative; }
  }

  @media (max-width: 480px) {
    .atlas__header h2 { font-size: 2rem; }
    .atlas__header p { max-width: 30ch; }
    .atlas__footer { gap: .63rem; }
  }

  .atlas__touch { display: none; }

  @media (hover: none), (pointer: coarse) {
    .atlas__drag { display: none; }
    .atlas__touch { display: inline; }
  }

  @media print {
    .atlas { display: none; }
  }
</style>
