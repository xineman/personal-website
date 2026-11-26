import { env } from 'cloudflare:workers';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  return { articleHidden: (await env.FLAGS?.getBooleanValue('hide-article', false)) ?? false };
};
