import { isArticleHidden } from '#lib/server/flags.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform, setHeaders }) => {
  // The markup depends on the flag, so a shared cache entry would be wrong.
  setHeaders({ 'cache-control': 'no-store' });

  return { articleHidden: await isArticleHidden(platform) };
};
