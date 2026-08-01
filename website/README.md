# Pump SDK Website

> **Purpose:** SDK documentation and marketing site. Reads the repository's own
> markdown docs in the browser, with search, syntax highlighting, and deep links.

Deployed to [sdk.pumpk.it](https://sdk.pumpk.it). This is one of two web
directories in the repository:

| Directory | Purpose |
|-----------|--------|
| **`website/`** (this) | SDK documentation & marketing site |
| [`pumpfun-site/`](../pumpfun-site/) | pump.fun UI design template (mock data, no blockchain) |

## Structure

```
website/
├── index.html      # Single-page app: home, docs, sdk, tools, ecosystem
├── styles.css      # PumpFun-inspired dark theme + documentation reader
├── app.js          # Router, doc reader, search, code tabs
├── vendor/         # marked, DOMPurify, highlight.js (see vendor/README.md)
├── vercel.json     # Static-host fallback config (SPA rewrite + headers)
└── README.md       # This file
```

## Pages

- **Home** - Hero, stats, featured features, doc card grid, on-chain programs, quick start code
- **Docs** - Card index, sidebar, full-text search, and the in-site markdown reader
- **SDK** - Architecture diagram, key types, import map, common pitfalls
- **Tools** - MCP server, live dashboards, vanity generators, bots, PumpOS
- **Ecosystem** - Project structure tree, performance metrics, security, links

## How the documentation reader works

Every card, sidebar entry, and search hit opens the actual markdown from
[`docs/`](../docs/) inside the site. Nothing is duplicated: the doc list in
`app.js` (`DOCS`) points at real filenames, and the page you read is the file in
the repository.

1. `scripts/build-site.mjs` copies `docs/*.md` and `docs/assets/` into
   `dist-site/docs/`, next to the site.
2. `app.js` fetches `docs/<file>.md`, parses it with `marked`, sanitizes the HTML
   with `DOMPurify`, and highlights code blocks with `highlight.js`.
3. If the bundled copy is missing (or the host answered with its SPA fallback
   HTML), the reader retries against
   `raw.githubusercontent.com/nirholas/pump-fun-sdk/main/docs/`, so a link is
   never a dead end. If both fail, the page renders an error state with a retry
   button and a GitHub link.

Post-processing gives each document a table of contents, anchored headings,
copy-to-clipboard code blocks, horizontally scrollable tables, and previous/next
navigation. Relative `.md` links between docs are rewritten to in-site routes;
everything else points at GitHub.

### Routes

| Hash | Shows |
|------|-------|
| `#home`, `#sdk`, `#tools`, `#ecosystem` | Top-level pages |
| `#docs` | Documentation card index |
| `#docs/getting-started.md` | A single document |
| `#docs/getting-started.md~install` | A document scrolled to a heading |
| `#getting-started` | Shorthand for the document with that filename |

### Keyboard

| Key | Action |
|-----|--------|
| `/` | Jump to the docs page and focus search |
| `Esc` | Clear the search box, or return from a document to the index |

## Development

The site works standalone, but the bundled markdown only exists after a build,
so serve the assembled bundle when you touch the docs reader:

```bash
node scripts/build-site.mjs   # from the repository root
npx serve dist-site
```

Serving `website/` directly also works: `docs/` is missing there, so the reader
falls back to the copies on GitHub.

```bash
cd website && npx serve .
```

## Deployment

Cloudflare Workers static assets, configured by
[`wrangler.jsonc`](../wrangler.jsonc) at the repository root:

```bash
node scripts/build-site.mjs
npx wrangler deploy          # one-time: npx wrangler login
```

`vercel.json` stays for any static host that needs an explicit SPA rewrite.

## Design

- Dark theme matching PumpFun aesthetic (#0a0a0f background, #00ff88 green accents)
- Token card pattern for documentation entries (emoji icons, tickers, categories)
- Green/cyan/purple gradient accents, syntax colors matched to the same palette
- Responsive: three columns at desktop, sidebar plus article under 1180px, single column under 900px
- Designed loading, empty, and error states for every fetch the reader makes
- No build step for the site itself: pure HTML/CSS/JS plus vendored libraries
