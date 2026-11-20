<script lang="ts">
  import basemap from '../../content/basemap.svg?raw';
  import type { RouteMapData } from '#lib/server/route.js';

  interface Props {
    map: RouteMapData;
    chapters: { title: string; labelSide: string; pin: string; number: string }[];
    activeId: string | null;
  }

  let { map, chapters, activeId }: Props = $props();
  let hoveredId = $state<string | null>(null);

  function highlight(event: PointerEvent, id: string) {
    if (event.pointerType === 'mouse') hoveredId = id;
  }
</script>

<svg class="atlas-map" viewBox="0 0 490 565" role="group" aria-label="Interactive GPX route, from Rovereto to North Cape">
  <g class="map-land" aria-hidden="true">{@html basemap}</g>
  <g aria-hidden="true">
    <path class="map-grid" d={map.grid} />
    <path class="map-arctic" d={`M0,${map.arcticY.toFixed(1)}H490`} />
    <text class="map-region" x="19" y={(map.arcticY - 7).toFixed(1)}>ARCTIC CIRCLE</text>
    {#each map.ferries as path}
      <path class="route-ferry" d={path} />
    {/each}
    {#each map.chapters as chapter (chapter.id)}
      {#each chapter.lines as line}
        <path
          class="route-line"
          class:route-line--official={line.official}
          class:is-current={activeId === chapter.id}
          class:is-hovered={hoveredId === chapter.id}
          d={line.path}
        />
      {/each}
    {/each}
  </g>

  <g aria-hidden="true">
    {#each map.chapters as chapter, index (chapter.id)}
      {#each chapter.lines as line}
        <a
          class="route-hit"
          href={'#' + chapter.id}
          tabindex="-1"
          aria-label={chapters[index].title}
          onpointerenter={(event) => highlight(event, chapter.id)}
          onpointerleave={() => hoveredId = null}
        ><path d={line.path} /></a>
      {/each}
    {/each}
  </g>

  <g>
    {#each map.chapters as { id, x, y }, index (id)}
      {@const chapter = chapters[index]}
      {@const left = chapter.labelSide === 'left'}
      <g transform={`translate(${x} ${y})`}>
        <a
          class="map-pin"
          class:is-current={activeId === id}
          href={'#' + id}
          aria-label={`Chapter ${index + 1}, ${chapter.title} via ${chapter.pin}`}
          aria-current={activeId === id ? 'location' : undefined}
          onpointerenter={(event) => highlight(event, id)}
          onpointerleave={() => hoveredId = null}
        >
          <circle class="map-pin__target" r="22" />
          <circle class="map-pin__halo" r="17" />
          <circle class="map-pin__disc" r="11" />
          <text class="map-pin__number" text-anchor="middle" y="0.4" dominant-baseline="middle" aria-hidden="true">{chapter.number}</text>
          <text class="map-pin__label" x={left ? -19 : 19} y="4" text-anchor={left ? 'end' : 'start'} aria-hidden="true">{chapter.pin}</text>
        </a>
      </g>
    {/each}
  </g>
</svg>
