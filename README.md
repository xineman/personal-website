# NorthCape 4000

A cycling journal and interactive GPX atlas for the 2022 NorthCape 4000. SvelteKit prerenders the journal and serves the route as a static GeoJSON file.

## Development

Run these commands from the project root with Node.js 24 and Bun.

```sh
bun install --frozen-lockfile
bun run dev
```

Run `bun run check` to type-check the application. Run `bun run build` to build and prerender the site, then use `bun run preview` to preview the production build.

Run `bun run cf-typegen` after changing Wrangler bindings or compatibility settings, and commit the updated `worker-configuration.d.ts`.

## Feature flags

The `personal-website` Flagship app holds the `hide-article` boolean flag. With the flag on, the page becomes an interactive route map: the journal, its reading progress and the chapter stops are hidden, while the cover heading and every map control remain. The journal stays prerendered; the browser asks `/flags.json` for the flag on load and hides the journal when it is on.

Local development evaluates flags against the Flagship local store. Pull the app's flags once, then choose the variation before starting the dev server:

```sh
bunx wrangler flagship flags pull 92434a89-72bc-40cd-af9d-223277baf956
bunx wrangler flagship flags set 92434a89-72bc-40cd-af9d-223277baf956 hide-article --variation on --local
```

Use `--variation off --local` to bring the journal back. Local Flagship commands are unavailable while a dev session for the same Worker is running, so set the variation before `bun run dev` or stop the dev session first. Deployed Workers evaluate the flag from the Flagship app itself.

The journal lives in `content/`. Development and production builds generate `static/route.geojson` and the on-demand ride readings in `static/route-telemetry/`. Run `bun run generate:route` to refresh them after changing the GPX tracks in `data/northcape-4000/gpx/` or the day ranges in `content/article.json`. Commit the updated GeoJSON alongside those changes.

MapLibre loads `/route.geojson` when the atlas approaches the viewport and fetches the basemap tiles and map glyphs from OpenFreeMap. The published photos and article fonts live in `static/assets/`.
