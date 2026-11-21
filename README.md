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

The journal lives in `content/`. The checked-in `static/route.geojson` lets the dev server serve the route immediately. Run `bun run generate:route` after changing the GPX tracks in `data/northcape-4000/gpx/` or the day ranges in `content/article.json`, and commit the updated GeoJSON alongside those changes. The production build regenerates it automatically.

MapLibre loads `/route.geojson` when the atlas approaches the viewport and fetches the basemap tiles and map glyphs from OpenFreeMap. The published photos and article fonts live in `static/assets/`.
