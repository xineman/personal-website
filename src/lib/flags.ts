export interface ArticleVisibility {
  hidden: boolean;
}

/**
 * Read the Cloudflare Flagship flag that hides the journal.
 *
 * The page is prerendered, so the browser asks the Worker for the flag after load.
 * A failed request leaves the journal in place, matching the flag's own default.
 */
export async function readArticleVisibility(signal?: AbortSignal): Promise<ArticleVisibility> {
  try {
    const response = await fetch('/flags.json', {
      signal,
      headers: { accept: 'application/json' }
    });
    if (!response.ok) return { hidden: false };
    const body: Partial<ArticleVisibility> = await response.json();
    return { hidden: body.hidden === true };
  } catch {
    return { hidden: false };
  }
}
