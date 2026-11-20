import { buildRoute, type RouteMapData } from '#lib/server/route.js';
import type { PageServerLoad } from './$types';

export const prerender = true;

let route: Promise<RouteMapData> | undefined;

export const load = (async () => {
  route ??= buildRoute();
  return { map: await route };
}) satisfies PageServerLoad;
