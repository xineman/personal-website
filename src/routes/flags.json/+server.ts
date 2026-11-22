import type { ArticleVisibility } from '#lib/flags.js';
import { isArticleHidden } from '#lib/server/flags.js';
import type { RequestHandler } from './$types';

// The journal stays prerendered; this endpoint only reports the Flagship flag.
export const prerender = false;

export const GET: RequestHandler = async ({ platform }) => {
  const visibility: ArticleVisibility = { hidden: await isArticleHidden(platform) };
  return Response.json(visibility, {
    headers: { 'cache-control': 'no-store' }
  });
};
