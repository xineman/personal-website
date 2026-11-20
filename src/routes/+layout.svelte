<script lang="ts">
	import '../style.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href="/assets/compass.svg" type="image/svg+xml" />
</svelte:head>

{@render children()}
