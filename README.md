# Personal Website — Clemente Lacerda

A personal website for writings, books, and a live Strava training dashboard. Built with Astro and deployed on Vercel.

**Live:** [lacerda.cl](https://lacerda.cl)

## Tech Stack

- **Framework:** [Astro 5](https://astro.build) (static output with serverless API routes)
- **Content:** MDX via `@astrojs/mdx`
- **Hosting:** [Vercel](https://vercel.com) via `@astrojs/vercel`, auto-deploys on push to `main`
- **Charts:** [Chart.js](https://www.chartjs.org) for Strava data visualizations
- **Books data:** [Notion API](https://developers.notion.com) — reads from a Notion database
- **Training data:** [Strava API](https://developers.strava.com) — athlete stats and recent activities
- **RSS:** `@astrojs/rss` at `/rss.xml`

## Project Structure

```
src/
├── components/
│   ├── Header.astro           # "CL" initials logo + navigation
│   ├── Footer.astro           # Name, copyright, social links
│   ├── PostCard.astro          # Writing post summary card
│   ├── RetroTV.astro           # CSS-art Macintosh 128K with YouTube video
│   ├── SocialLinks.astro       # Social media icon links
│   ├── ThemeToggle.astro       # Theme toggle (currently unused — light mode only)
│   ├── mdx/
│   │   ├── Callout.astro       # Callout/admonition box for MDX
│   │   └── Table.astro         # Responsive table wrapper for MDX
│   └── strava/
│       ├── StravaDashboard.astro  # Orchestrates data fetching and layout
│       ├── WeeklyStats.astro      # Running stats summary cards
│       ├── ActivityChart.astro    # Chart.js visualizations (weekly distance, activity breakdown)
│       └── ActivityList.astro     # Recent activities list
├── data/
│   └── writings/               # MDX blog posts
│       ├── hello-world.mdx
│       ├── costco-and-framing.mdx
│       ├── ramp-developing-the-ess-business-model.mdx
│       ├── paris.mdx
│       └── questions.mdx
├── layouts/
│   ├── BaseLayout.astro        # Root HTML shell (head, meta, global styles)
│   ├── PageLayout.astro        # Header + main container + Footer
│   └── PostLayout.astro        # Individual writing post layout with tags
├── lib/
│   ├── date.ts                 # Duration, distance, pace, and relative date formatters
│   ├── notion.ts               # Notion API client — fetches books, groups by year
│   └── strava.ts               # Strava API client — OAuth token refresh, stats, activities
├── pages/
│   ├── index.astro             # Homepage: hero, Macintosh 128K, recent writings
│   ├── books.astro             # Books page: Notion-powered, year toggle, 3-column grid
│   ├── strava.astro            # Strava page: two-column dashboard with charts
│   ├── rss.xml.ts              # RSS feed generator
│   ├── api/strava/callback.ts  # Strava OAuth callback handler
│   └── writings/
│       ├── index.astro         # Writings listing page
│       └── [...slug].astro     # Individual writing post (dynamic route)
└── styles/
    ├── global.css              # Design tokens (colors, typography, spacing, layout) + CSS reset
    ├── typography.css           # Base typography rules for headings, links, lists, code
    └── prose.css               # Styles for MDX-rendered content
```

## Pages

| Route | Description |
| :--- | :--- |
| `/` | Homepage — hero section with intro, "Currently" status line, recent writings list, and a CSS-art Macintosh 128K that plays the first 2:03 of John Berger's "Ways of Seeing" (desktop only) |
| `/writings` | Chronological list of all published writings |
| `/writings/[slug]` | Individual writing post rendered from MDX |
| `/books` | Books read and currently reading, powered by Notion. Organized by year with toggle buttons and a 3-column responsive grid |
| `/strava` | Live training dashboard — two-column layout with running stats, weekly distance chart, activity breakdown doughnut, and recent activities list |
| `/rss.xml` | RSS feed of all writings |

## External Integrations

### Strava

Fetches athlete stats and recent activities via the Strava API. Uses OAuth refresh tokens for authentication. The dashboard shows:
- Recent (4-week) and year-to-date running stats
- Running weekly distance bar chart
- Activity breakdown doughnut chart (last 60 activities)
- Scrollable recent activities list

An OAuth callback endpoint exists at `/api/strava/callback` for the initial token exchange.

### Notion

Reads a books database from Notion. Each book entry has a title, author, status (Read/Reading), and date finished. Books are grouped by year with separate "Currently Reading" and "Read" sections.

## Environment Variables

Create a `.env` file at the project root (see `.env.example`):

| Variable | Description |
| :--- | :--- |
| `STRAVA_CLIENT_ID` | Strava API application client ID |
| `STRAVA_CLIENT_SECRET` | Strava API application client secret |
| `STRAVA_REFRESH_TOKEN` | Strava OAuth refresh token for the athlete |
| `STRAVA_ATHLETE_ID` | Strava athlete numeric ID |
| `NOTION_TOKEN` | Notion internal integration token |
| `NOTION_BOOKS_DATABASE_ID` | Notion database ID for the books collection |

## Commands

All commands are run from the project root:

| Command | Action |
| :--- | :--- |
| `npm install` | Install dependencies |
| `npm run dev` | Start local dev server at `localhost:4321` |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview production build locally |

## Adding New Writings

1. Create a new `.mdx` file in `src/data/writings/`
2. Add the required frontmatter:

```yaml
---
title: "Your Post Title"
description: "A brief summary of the post."
date: 2026-02-09
tags: ["tag1", "tag2"]
draft: false
---
```

3. Write your content below the frontmatter using standard Markdown and MDX components
4. Available MDX components: `Callout` (with variants: default, warning, tip) and `Table` (responsive wrapper)
5. Set `draft: true` to hide a post from listings and feeds

## Deployment

The site auto-deploys to Vercel on every push to the `main` branch. The Astro adapter (`@astrojs/vercel`) handles static pre-rendering for most pages and serverless functions for API routes.

## Design

See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the complete design token reference, color palette, typography scale, layout system, and component catalog.
