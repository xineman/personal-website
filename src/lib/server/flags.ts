import { env as workerEnv } from 'cloudflare:workers';

export const hideArticleFlag = 'hide-article';

let warned = false;

/**
 * Evaluate the hide-article flag inside the Worker.
 *
 * `cloudflare:workers` is the reliable source: @sveltejs/adapter-cloudflare never
 * passes a `platform` object to the server, so `platform.env` is undefined in
 * deployed Workers, including Previews. It does exist in `vite dev`, so it stays
 * as a fallback for local tooling.
 *
 * Flagship returns the default variation when an evaluation fails, so this
 * try/catch only covers a missing binding.
 */
export async function isArticleHidden(platform: App.Platform | undefined): Promise<boolean> {
  try {
    const flags = platform?.env?.FLAGS ?? workerEnv.FLAGS;
    if (!flags) return false;
    return (await flags.getBooleanValue(hideArticleFlag, false)) ?? false;
  } catch (error) {
    if (!warned) {
      warned = true;
      console.error(`Could not evaluate the ${hideArticleFlag} flag.`, error);
    }
    return false;
  }
}
