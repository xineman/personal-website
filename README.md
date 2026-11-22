# NorthCape 4000

A cycling journal and interactive GPX atlas for the 2022 NorthCape 4000. SvelteKit renders the journal on Cloudflare Workers and serves the route as a static GeoJSON file.

## Development

Run these commands from the project root with Node.js 24 and Bun.

```sh
bun install --frozen-lockfile
bun run dev
```

Run `bun run check` to type-check the application. Run `bun run build` to build the site, then use `bun run preview` to preview the production build locally.

Run `bun run cf-typegen` after changing Wrangler bindings or compatibility settings, and commit the updated `worker-configuration.d.ts`.

The Worker and Cloudflare branch previews read the `hide-article` flag from the existing Flagship app on each request. When the flag is on, the cover and interactive route remain visible. Wrangler uses a local flag store for development and defaults to showing the journal when the flag has no value.

The journal lives in `content/`. Development and production builds generate `static/route.geojson` and the on-demand ride readings in `static/route-telemetry/`. Run `bun run generate:route` to refresh them after changing the GPX tracks in `data/northcape-4000/gpx/` or the day ranges in `content/article.json`. Commit the updated GeoJSON alongside those changes.

MapLibre loads `/route.geojson` when the atlas approaches the viewport and fetches the basemap tiles and map glyphs from OpenFreeMap. The published photos and article fonts live in `static/assets/`.

## PostHog

For local analytics, copy `.env.example` to `.env` and set `PUBLIC_POSTHOG_KEY` to the project's browser token. The app runs with analytics disabled when either public value is missing.

Set `PUBLIC_POSTHOG_KEY` and `PUBLIC_POSTHOG_HOST` as [Cloudflare Workers Builds variables](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) for production and any preview that should send analytics. SvelteKit reads them at build time.

To enable browser source-map uploads, add `POSTHOG_CLI_API_KEY` as a secret build variable with Error Tracking Write and Organization Read access. Add `POSTHOG_CLI_PROJECT_ID` with the destination project ID and set `POSTHOG_CLI_HOST=https://eu.posthog.com` for the EU project. `bun run build` then uploads the maps to PostHog and removes them from the Cloudflare assets before deployment.
