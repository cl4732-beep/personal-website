# AGENTS.md

## Cursor Cloud specific instructions

This is an **Astro 5 personal website** (single service, no monorepo). All commands are in `package.json`.

### Running the dev server

```
npm run dev          # starts at localhost:4321
```

### Building

```
npm run build        # static build + Vercel serverless functions → dist/
```

### Key caveats

- **No linter or test suite configured.** There are no ESLint, Prettier, or test scripts in this project. The primary validation is `npm run build`.
- **External APIs degrade gracefully.** Strava, Notion, YouTube, Spotify, Supabase, and Buttondown APIs all produce non-fatal warnings when credentials are missing. The site builds and runs without them.
- **No Node.js version pinned.** The project works on Node 18+. The environment ships Node 22, which is compatible.
- **Static output with Vercel adapter.** `astro.config.mjs` sets `output: 'static'` with `@astrojs/vercel` adapter. API routes under `src/pages/api/` become serverless functions on deploy but work in dev mode locally.
- **Blog content is MDX.** Writings live in `src/data/writings/*.mdx`.
