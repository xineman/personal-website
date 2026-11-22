export const hideArticleFlag = 'hide-article';

let warned = false;

/**
 * Evaluate the hide-article flag in the Worker.
 *
 * Flagship returns the default when an evaluation fails, so the try/catch only
 * covers a missing binding (for example in a build without the Flagship app).
 */
export async function isArticleHidden(platform: App.Platform | undefined): Promise<boolean> {
  try {
    return (await platform?.env.FLAGS.getBooleanValue(hideArticleFlag, false)) ?? false;
  } catch (error) {
    if (!warned) {
      warned = true;
      console.error(`Could not evaluate the ${hideArticleFlag} flag.`, error);
    }
    return false;
  }
}
