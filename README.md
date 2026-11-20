# NorthCape 4000

A cycling journal and interactive GPX atlas for the 2022 NorthCape 4000. The site uses SvelteKit's minimal TypeScript scaffold and static adapter.

## Development

Run these commands from the project root with Node.js 24 and pnpm 12.21.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm check` to type-check the application. Run `pnpm build` to prerender the site into `build/`, then use `pnpm preview` to preview the production build.

The journal and basemap live in `content/`. The route is built from the GPX tracks in `data/northcape-4000/gpx/`, and the published photos and fonts live in `static/assets/`.
