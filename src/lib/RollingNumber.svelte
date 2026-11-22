<script lang="ts">
  interface Props {
    value: number;
    formatter?: Intl.NumberFormat;
    maxAnimatedDelta?: number;
  }

  const defaultFormatter = new Intl.NumberFormat('en');
  let { value, formatter = defaultFormatter, maxAnimatedDelta = Infinity }: Props = $props();
  let reels = $state<HTMLElement>();
  const text = $derived(formatter.format(value));
  const characters = $derived(Array.from(text));
  const digit = /\p{Decimal_Number}/u;
  const timing = { duration: 120, easing: 'cubic-bezier(.16, 1, .3, 1)' };
  let previous: { value: number; characters: string[] } | undefined;

  function clearReel(reel: Element) {
    reel.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    reel.querySelector('[data-outgoing]')?.remove();
  }

  $effect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    function settle() {
      if (reels) Array.from(reels.children).forEach(clearReel);
    }
    motion.addEventListener('change', settle);
    return () => {
      motion.removeEventListener('change', settle);
      settle();
    };
  });

  $effect(() => {
    const last = previous;
    previous = { value, characters };
    if (!reels || !last) return;

    const delta = value - last.value;
    const slots = Array.from(reels.children);
    if (!Number.isFinite(delta) || Math.abs(delta) > maxAnimatedDelta ||
      matchMedia('(prefers-reduced-motion: reduce)').matches) {
      slots.forEach(clearReel);
      return;
    }
    if (delta === 0) return;

    const direction = Math.sign(delta);
    const offset = last.characters.length - characters.length;
    for (const [index, reel] of slots.entries()) {
      const before = last.characters[index + offset];
      const after = characters[index];
      if (before === after) continue;

      const incoming = reel.firstElementChild as HTMLElement;
      // When interrupted, let the previous target exit from its current position.
      const currentStyle = incoming.getAnimations().length ? getComputedStyle(incoming) : undefined;
      const from = { transform: currentStyle?.transform ?? 'translateY(0)', opacity: currentStyle?.opacity ?? '1' };
      clearReel(reel);
      if (!digit.test(after)) continue;

      if (before && digit.test(before)) {
        const outgoing = incoming.cloneNode() as HTMLElement;
        outgoing.dataset.outgoing = '';
        outgoing.dataset.character = before;
        reel.appendChild(outgoing);
        outgoing.animate([from, { transform: `translateY(${-direction * 75}%)`, opacity: 0 }], timing)
          .onfinish = () => outgoing.remove();
      }
      incoming.animate([
        { transform: `translateY(${direction * 75}%)`, opacity: .35 },
        { transform: 'translateY(0)', opacity: 1 }
      ], timing);
    }
  });
</script>

<span class="number">
  <span class="reels" aria-hidden="true" bind:this={reels}>
    {#each characters as character, index (characters.length - index)}
      <span class="reel" class:digit={digit.test(character)}><span class="glyph" data-character={character}></span></span>
    {/each}
  </span>
  <span class="formatted-value">{text}</span>
</span>

<style>
  .number { position: relative; display: inline-block; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .reels { display: inline-flex; -webkit-user-select: none; user-select: none; }
  .reel { position: relative; display: inline-grid; clip-path: inset(0 -.06em); text-align: center; }
  .digit::before {
    /* Reserve the widest digit even when the font lacks tabular figures. */
    content: '0\A 1\A 2\A 3\A 4\A 5\A 6\A 7\A 8\A 9';
    grid-area: 1 / 1;
    block-size: 0;
    overflow: clip;
    visibility: hidden;
    white-space: pre;
  }
  .glyph { grid-area: 1 / 1; display: block; }
  .glyph::before { content: attr(data-character); }
  .glyph:global([data-outgoing]) { position: absolute; inset: 0; }
  .formatted-value {
    /* Overlay the full string so it can be selected where the digits are shown. */
    position: absolute; inset: 0; color: transparent; forced-color-adjust: none;
  }
</style>
