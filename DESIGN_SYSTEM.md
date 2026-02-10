# Design System

This document catalogs the design tokens, patterns, and component conventions used across the site. All tokens are defined as CSS custom properties in `src/styles/global.css` and applied through `src/styles/typography.css` and `src/styles/prose.css`.

---

## Color Palette

The site uses **light mode only** (no dark mode). The accent color is **Forest Green**, chosen for an intellectual, literary tone.

| Token | Value | Purpose |
| :--- | :--- | :--- |
| `--color-bg` | `#F8F7F4` | Page background — warm off-white |
| `--color-surface` | `#F0EFEB` | Elevated surface (cards, hover states) |
| `--color-text` | `#1A1A1A` | Primary body text |
| `--color-text-muted` | `#6B7280` | Secondary text, labels, dates |
| `--color-accent` | `#2D5F3F` | Forest Green — primary accent, links, focus rings |
| `--color-accent-hover` | `#1B4332` | Darker green for hover states |
| `--color-border` | `#D1CFC7` | Dividers, card borders |
| `--color-code-bg` | `#EEECEA` | Inline code and code block backgrounds |
| `--color-link` | `#2D5F3F` | Link text (matches accent) |
| `--color-link-hover` | `#1A1A1A` | Link hover text (shifts to primary text color) |

### Additional Colors (component-specific)

| Usage | Value | Where |
| :--- | :--- | :--- |
| "Currently" line | `#5B8FB9` | Homepage hero — light blue for the status line |
| Callout warning | `#d97706` | MDX Callout component (warning variant) |
| Callout tip | `#059669` | MDX Callout component (tip variant) |

---

## Typography

### Font Stacks

| Token | Fonts | Usage |
| :--- | :--- | :--- |
| `--font-serif` | Iowan Old Style, Apple Garamond, Baskerville, Times New Roman, Droid Serif, Times, Source Serif Pro, serif | Body text, headings — primary typeface |
| `--font-mono` | Berkeley Mono, JetBrains Mono, Menlo, Consolas, Monaco, Liberation Mono, Lucida Console, monospace | Code blocks, inline code |

### Type Scale

| Token | Value | Approx px (at 16px base) |
| :--- | :--- | :--- |
| `--text-xs` | `0.75rem` | 12px |
| `--text-sm` | `0.875rem` | 14px |
| `--text-base` | `1.05rem` | 16.8px |
| `--text-lg` | `1.25rem` | 20px |
| `--text-xl` | `1.5rem` | 24px |
| `--text-2xl` | `2rem` | 32px |
| `--text-3xl` | `2.75rem` | 44px |
| `--text-4xl` | `3.5rem` | 56px |
| `--text-5xl` | `4.5rem` | 72px |

### Heading Sizes

| Element | Mobile | Desktop (640px+) |
| :--- | :--- | :--- |
| `h1` | `--text-3xl` (2.75rem) | `--text-4xl` (3.5rem) |
| `h2` | `--text-xl` (1.5rem) | `--text-2xl` (2rem) |
| `h3` | `--text-lg` (1.25rem) | `--text-xl` (1.5rem) |
| `h4` | `--text-base` (1.05rem) | `--text-base` (1.05rem) |

### Line Heights

| Token | Value | Usage |
| :--- | :--- | :--- |
| `--leading-body` | `1.75` | Body text, paragraphs |
| `--leading-tight` | `1.1` | Headings |
| `--leading-snug` | `1.4` | Subheadings (h2, h3, h4) |

### Letter Spacing

| Token | Value | Usage |
| :--- | :--- | :--- |
| `--tracking-body` | `0.015em` | Body text |
| `--tracking-heading` | `-0.03em` | Headings (tighter) |
| `--tracking-wide` | `0.14em` | Labels, small-caps text, tags |

---

## Spacing Scale

| Token | Value | Approx px |
| :--- | :--- | :--- |
| `--space-xs` | `0.25rem` | 4px |
| `--space-sm` | `0.5rem` | 8px |
| `--space-md` | `1rem` | 16px |
| `--space-lg` | `1.5rem` | 24px |
| `--space-xl` | `2rem` | 32px |
| `--space-2xl` | `3rem` | 48px |
| `--space-3xl` | `4rem` | 64px |
| `--space-4xl` | `6rem` | 96px |
| `--space-5xl` | `8rem` | 128px |

---

## Layout

The site uses an **asymmetric, left-aligned layout**. Content starts from the left side with generous padding but does not stretch to fill the full viewport width. This creates intentional empty space on the right side of wider screens.

| Token | Value | Purpose |
| :--- | :--- | :--- |
| `--content-max-width` | `42rem` | Maximum width for text content (writings, hero text, post lists) |
| `--content-padding-left` | `clamp(2rem, 8vw, 10rem)` | Left padding — scales with viewport, generous on wide screens |
| `--content-padding-right` | `clamp(1.5rem, 4vw, 4rem)` | Right padding — smaller than left to create asymmetry |

### Container

The `.container` utility class applies the left/right padding:

```css
.container {
  padding-left: var(--content-padding-left);
  padding-right: var(--content-padding-right);
}
```

This is applied to `<main>` in `PageLayout.astro`. Individual content sections (hero text, post lists, writings page) further constrain width with `max-width: var(--content-max-width)`.

### Responsive Breakpoints

| Breakpoint | Usage |
| :--- | :--- |
| `640px` | Typography size increase (h1-h3), hero padding increase |
| `480px` | Books grid — 2 columns |
| `900px` | Books grid — 3 columns |
| `1100px` | Strava two-column layout, Macintosh 128K visible on homepage |

---

## Transitions

| Token | Value | Usage |
| :--- | :--- | :--- |
| `--transition-base` | `200ms ease` | Hover states, link underlines, color changes |
| `--transition-slow` | `400ms ease` | Larger-scale transitions |

---

## Accessibility

### Focus States

All interactive elements use `:focus-visible` for keyboard-only focus rings:

```css
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

:focus:not(:focus-visible) {
  outline: none;
}
```

Component-specific focus styles add `border-radius: 2px` for links and `outline-offset: 3px`/`4px` for buttons and navigation.

### Reduced Motion

All animations and transitions are disabled when the user's operating system requests reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### Semantic HTML

- Pages use proper heading hierarchy (`h1` > `h2` > `h3`)
- Navigation links use `<nav>` with descriptive link text
- Interactive elements use `<button>` with `aria-label` and `aria-pressed` where appropriate
- The books page year toggles use `aria-selected` for state

---

## Syntax Highlighting

Code blocks use Shiki with the `css-variables` theme. Token colors are defined in `global.css`:

| Token | Color | What it highlights |
| :--- | :--- | :--- |
| `--astro-code-color-text` | `#1A1A1A` | Default code text |
| `--astro-code-color-background` | `#EEECEA` | Code block background |
| `--astro-code-token-constant` | `#2D5F3F` | Constants (Forest Green) |
| `--astro-code-token-string` | `#059669` | Strings (emerald) |
| `--astro-code-token-comment` | `#9CA3AF` | Comments (muted gray) |
| `--astro-code-token-keyword` | `#7c3aed` | Keywords (purple) |
| `--astro-code-token-function` | `#2D3748` | Function names (dark slate) |
| `--astro-code-token-punctuation` | `#6B7280` | Punctuation (gray) |

---

## Interactive Patterns

### Link Underline Animation

Links use an animated underline that expands from left to right on hover, built with `background-image`:

```css
a {
  background-image: linear-gradient(currentColor, currentColor);
  background-size: 0% 1px;
  background-position: left bottom;
  transition: background-size var(--transition-base);
}
a:hover {
  background-size: 100% 1px;
}
```

### Navigation Active State

Navigation links in the header use an `::after` pseudo-element for an animated underline. The active page link displays `width: 100%` with `background-color: var(--color-accent)`.

### Hover States

Common hover patterns across the site:
- **Cards and list items**: `background-color: var(--color-surface)` with subtle `translateY(-1px)` lift
- **Buttons/toggles**: `transform: scale(1.05)` on hover, `scale(0.95)` on active
- **Tags**: `color: var(--color-accent)` with `background-color: var(--color-border)`
- **Social links**: `translateY(-1px)` lift

### Labels

The `.label` utility creates small-caps uppercase labels used for section headers ("Welcome", "Recent Writings"):

```css
.label {
  font-variant: small-caps;
  letter-spacing: var(--tracking-wide);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  text-transform: lowercase;
}
```

---

## Component Catalog

### Layout Components

| Component | File | Description |
| :--- | :--- | :--- |
| BaseLayout | `src/layouts/BaseLayout.astro` | Root HTML shell — `<head>`, meta tags, global CSS imports, View Transitions |
| PageLayout | `src/layouts/PageLayout.astro` | Wraps pages with Header, `.container` main, and Footer |
| PostLayout | `src/layouts/PostLayout.astro` | Individual writing post — title, date, tags, prose content |

### Site Components

| Component | File | Description |
| :--- | :--- | :--- |
| Header | `src/components/Header.astro` | "CL" initials (serif, Forest Green) top-left, navigation links top-right. Nav links have animated underlines and active state indicators. |
| Footer | `src/components/Footer.astro` | "Clemente Lacerda" name with copyright year, social links. |
| SocialLinks | `src/components/SocialLinks.astro` | Row of social media icon links with hover lift effect. |
| PostCard | `src/components/PostCard.astro` | Writing post summary with title, date, and description. Border-bottom divider between items. |
| RetroTV (Macintosh) | `src/components/RetroTV.astro` | CSS-art Apple Macintosh 128K. Beige body, dark CRT screen bezel, Apple logo, "Macintosh" label, floppy disk slot, power button. Embeds a YouTube video (first 2:03 of "Ways of Seeing" by John Berger). Starts powered off with a dark screen; clicking the power button triggers a CRT power-on animation (white line expanding to fill screen) and plays the video. Scanline overlay for retro effect. Auto-powers off when the clip ends. Desktop-only (visible at 1100px+). |

### Strava Components

| Component | File | Description |
| :--- | :--- | :--- |
| StravaDashboard | `src/components/strava/StravaDashboard.astro` | Orchestrates Strava data fetching (60 recent activities, athlete stats). Two-column grid at 1100px+ (stats/charts left, activities right). |
| WeeklyStats | `src/components/strava/WeeklyStats.astro` | Running stats cards with accent-colored left border, hover lift. Shows recent and YTD distance, time, pace, and activity count. |
| ActivityChart | `src/components/strava/ActivityChart.astro` | Chart.js visualizations — "Running weekly distance (km)" bar chart and "Activity breakdown (last 60)" doughnut chart. Green color palette. |
| ActivityList | `src/components/strava/ActivityList.astro` | Scrollable list of recent activities with name, type, distance, duration, and pace. Hover highlights row. |

### MDX Components

| Component | File | Description |
| :--- | :--- | :--- |
| Callout | `src/components/mdx/Callout.astro` | Callout/admonition box with accent-colored left border. Variants: default (Forest Green), warning (amber), tip (emerald). |
| Table | `src/components/mdx/Table.astro` | Responsive table wrapper with horizontal scroll on small screens. |

---

## File Organization

Style definitions are split across three files:

| File | Responsibility |
| :--- | :--- |
| `src/styles/global.css` | Design tokens (`:root` custom properties), CSS reset, utility classes (`.container`, `.visually-hidden`), focus-visible baseline, reduced motion |
| `src/styles/typography.css` | Base element styles for headings, paragraphs, links, lists, blockquotes, code, horizontal rules, and the `.label` utility |
| `src/styles/prose.css` | Scoped styles for `.prose` wrapper — vertical rhythm for MDX-rendered content, tables, images, lists, and code blocks |

Component-specific styles are co-located within each `.astro` file using `<style>` blocks with Astro's automatic scoping.
