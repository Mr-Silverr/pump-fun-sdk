# Pump SDK Website

> **Purpose:** SDK documentation and marketing site. Reads the repository's own
> markdown docs and tutorials in the browser, with search, syntax highlighting,
> and deep links.

Deployed to [sdk.pumpk.it](https://sdk.pumpk.it). This is one of two web
directories in the repository:

| Directory | Purpose |
|-----------|--------|
| **`website/`** (this) | SDK documentation & marketing site |
| [`pumpfun-site/`](../pumpfun-site/) | pump.fun UI design template (mock data, no blockchain) |

## Structure

```
website/
├── index.html      # Single-page app: home, docs, tutorials, sdk, tools, ecosystem
├── styles.css      # PumpFun-inspired dark theme + reader
├── app.js          # Router, markdown reader, search, code tabs
├── data/
│   └── manifest.json  # Generated: tutorial index, extra docs, live stats
├── vendor/         # marked, DOMPurify, highlight.js (see vendor/README.md)
├── vercel.json     # Static-host fallback config (SPA rewrite + headers)
└── README.md       # This file
```

## Pages

- **Home** - Hero, live stats, featured features, doc card grid, on-chain programs, quick start code
- **Docs** - Card index, sidebar, full-text search, and the in-site markdown reader
- **Tutorials** - All numbered tutorials from `tutorials/`, in order, in the same reader
- **SDK** - Architecture diagram, key types, import map, common pitfalls
- **Tools** - MCP server, live dashboards, vanity generators, bots, PumpOS
- **Ecosystem** - Project structure tree, performance metrics, security, links

## How the reader works

Every card, sidebar entry, and search hit opens the actual markdown from
[`docs/`](../docs/) or [`tutorials/`](../tutorials/) inside the site. Nothing is
duplicated: the page you read is the file in the repository.

1. `scripts/build-site.mjs` copies `docs/*.md`, `tutorials/*.md`, and
   `docs/assets/` into `dist-site/`, next to the site.
2. `app.js` fetches `docs/<file>.md`, parses it with `marked`, sanitizes the HTML
   with `DOMPurify`, and highlights code blocks with `highlight.js`.
3. If the bundled copy is missing (or the host answered with its SPA fallback
   HTML), the reader retries against
   `raw.githubusercontent.com/nirholas/pump-fun-sdk/main/docs/`, so a link is
   never a dead end. If both fail, the page renders an error state with a retry
   button and a GitHub link.

### What comes from the repository, not from this directory

`scripts/build-manifest.mjs` (run automatically by `build-site.mjs`) writes
`data/manifest.json` from the filesystem: every tutorial with its title, summary,
and reading time; every documentation page; and the counts behind the home page
stats bar (documentation pages, tutorials, MCP tools, on-chain programs). A new
tutorial or doc therefore appears on the site as soon as it lands, and the stats
cannot drift from the repository.

The curated list in `app.js` (`DOCS`) only supplies editorial extras for the main
documentation set: emoji, ticker, category, and a one-line description. Any
`docs/*.md` file missing from it is listed automatically under **Project**.

Post-processing gives each document a table of contents, anchored headings,
copy-to-clipboard code blocks, horizontally scrollable tables, and previous/next
navigation. Relative `.md` links between docs are rewritten to in-site routes;
everything else points at GitHub.

### Routes

| Hash | Shows |
|------|-------|
| `#home`, `#sdk`, `#tools`, `#ecosystem` | Top-level pages |
| `#docs`, `#tutorials` | Card index for that collection |
| `#docs/getting-started.md` | A single document |
| `#tutorials/01-create-token.md` | A single tutorial |
| `#docs/getting-started.md~install` | A document scrolled to a heading |
| `#getting-started` | Shorthand for the document with that filename |

### Keyboard

| Key | Action |
|-----|--------|
| `/` | Focus the search box on the current collection (docs if elsewhere) |
| `Esc` | Clear the search box, or return from a document to the index |

## Development

The site works standalone, but the bundled markdown only exists after a build,
so serve the assembled bundle when you touch the docs reader:

```bash
node scripts/build-site.mjs   # from the repository root; regenerates the manifest
npx serve dist-site
```

Serving `website/` directly also works: the markdown is missing there, so the
reader falls back to the copies on GitHub. `data/manifest.json` is committed, so
the tutorial index still loads.

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
