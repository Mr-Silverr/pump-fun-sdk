/* ========================================================
   Pump SDK Website — Application Logic
   ======================================================== */

// ==================== Documentation Data ====================
const DOCS = [
  // Getting Started
  { title: "Getting Started", ticker: "GUIDE", emoji: "🚀", category: "getting-started", desc: "Prerequisites, installation, peer dependencies, and your first SDK call.", file: "getting-started.md" },
  { title: "End-to-End Workflow", ticker: "FLOW", emoji: "🔄", category: "getting-started", desc: "Complete token lifecycle — create, buy, sell, migrate, claim fees.", file: "end-to-end-workflow.md" },
  { title: "Examples", ticker: "CODE", emoji: "💡", category: "getting-started", desc: "Practical code examples for common SDK operations.", file: "examples.md" },
  { title: "CLI Guide", ticker: "CLI", emoji: "⌨️", category: "getting-started", desc: "Command-line tools and Bash wrappers for production use.", file: "cli-guide.md" },
  { title: "FAQ", ticker: "FAQ", emoji: "❓", category: "getting-started", desc: "Frequently asked questions and quick answers.", file: "faq.md" },

  // Core Concepts
  { title: "Architecture", ticker: "ARCH", emoji: "🏗️", category: "core", desc: "PumpSdk vs OnlinePumpSdk, offline-first design, program layout.", file: "architecture.md" },
  { title: "Bonding Curve Math", ticker: "MATH", emoji: "📐", category: "core", desc: "Virtual/real reserves, buy/sell formulas, price calculations with BN.js.", file: "bonding-curve-math.md" },
  { title: "AMM Trading", ticker: "AMM", emoji: "🏊", category: "core", desc: "PumpSwap constant-product pools — swap, deposit, withdraw post-graduation.", file: "amm-trading.md" },
  { title: "Fee Tiers", ticker: "TIER", emoji: "📊", category: "core", desc: "Dynamic fee tiers based on market cap thresholds.", file: "fee-tiers.md" },
  { title: "Fee Sharing", ticker: "SHARE", emoji: "💰", category: "core", desc: "Creator fee sharing configs — shareholders, BPS, claiming.", file: "fee-sharing.md" },
  { title: "Token Incentives", ticker: "EARN", emoji: "🎁", category: "core", desc: "Volume-based cashback rewards and token incentive programs.", file: "token-incentives.md" },
  { title: "Analytics", ticker: "DATA", emoji: "📈", category: "core", desc: "Price impact, graduation progress, token price, market analytics.", file: "analytics.md" },

  // Advanced
  { title: "Mayhem Mode", ticker: "CHAOS", emoji: "🔥", category: "advanced", desc: "Mayhem mode tokens with special bonding curve behavior.", file: "mayhem-mode.md" },
  { title: "Social Fees", ticker: "SOCIAL", emoji: "🤝", category: "advanced", desc: "Social referral fees and community-driven fee distribution.", file: "social-fees.md" },
  { title: "Cashback Rewards", ticker: "CASH", emoji: "💸", category: "advanced", desc: "UserVolumeAccumulator PDA and cashback reward mechanics.", file: "cashback.md" },
  { title: "DeFi Agents", ticker: "AGENT", emoji: "🤖", category: "advanced", desc: "AI agent integration patterns with MCP server and DeFi tools.", file: "defi-agents.md" },
  { title: "Admin Operations", ticker: "ADMIN", emoji: "🔧", category: "advanced", desc: "Protocol admin operations — global config, authority management.", file: "admin-operations.md" },
  { title: "Governance", ticker: "GOV", emoji: "🏛️", category: "advanced", desc: "Protocol governance and upgrade mechanisms.", file: "governance.md" },
  { title: "Performance", ticker: "PERF", emoji: "⚡", category: "advanced", desc: "Benchmarks, CU optimization, RPC batching strategies.", file: "performance.md" },

  // Reference
  { title: "API Reference", ticker: "API", emoji: "📖", category: "reference", desc: "Complete SDK method reference with parameter types.", file: "api-reference.md" },
  { title: "Events Reference", ticker: "EVENT", emoji: "📡", category: "reference", desc: "On-chain event types — CreateEvent, BuyEvent, SellEvent, MigrateEvent.", file: "events-reference.md" },
  { title: "Error Codes", ticker: "ERR", emoji: "🚨", category: "reference", desc: "Common errors, causes, and solutions.", file: "errors.md" },
  { title: "Glossary", ticker: "GLOSS", emoji: "📝", category: "reference", desc: "Key terms — bonding curve, graduation, AMM, slippage, PDA, BPS.", file: "glossary.md" },
  { title: "Security", ticker: "SEC", emoji: "🔐", category: "reference", desc: "Security practices, audit checklist, key management.", file: "security.md" },
  { title: "Testing", ticker: "TEST", emoji: "🧪", category: "reference", desc: "Test patterns, fixtures, Jest config, coverage.", file: "testing.md" },
  { title: "RPC Best Practices", ticker: "RPC", emoji: "🌐", category: "reference", desc: "Connection management, batching, rate limiting, error handling.", file: "rpc-best-practices.md" },
  { title: "Migration Guide", ticker: "MIGRATE", emoji: "📦", category: "reference", desc: "Upgrading from v1 to v2 — breaking changes and migration steps.", file: "MIGRATION.md" },
  { title: "Troubleshooting", ticker: "FIX", emoji: "🔍", category: "reference", desc: "Common issues and debugging strategies.", file: "TROUBLESHOOTING.md" },
  { title: "Deployment", ticker: "DEPLOY", emoji: "🚢", category: "reference", desc: "Deploying bots, servers, and dashboards to production.", file: "deployment.md" },
];

const CATEGORIES = [
  { key: "getting-started", label: "Getting Started" },
  { key: "core", label: "Core Concepts" },
  { key: "advanced", label: "Advanced" },
  { key: "reference", label: "Reference" },
];

// ==================== Sources ====================
// Markdown is bundled next to the site by scripts/build-site.mjs. If a file is
// missing from the bundle (or the SPA host answers with index.html), the reader
// falls back to the canonical copy on GitHub so no link is ever a dead end.
const REPO_URL = 'https://github.com/nirholas/pump-fun-sdk';
const RAW_ROOT = 'https://raw.githubusercontent.com/nirholas/pump-fun-sdk/main/';
const BLOB_ROOT = REPO_URL + '/blob/main/';
// Resolved against app.js itself, so bundled files are found even when the SPA
// fallback serves the site from a deeper path such as /docs/.
const SITE_ROOT = new URL('.', document.currentScript ? document.currentScript.src : window.location.href).href;

// Two readable collections, same reader, separate pages.
const COLLECTIONS = {
  docs: {
    dir: 'docs/',
    label: 'Docs',
    view: { content: 'docsContent', article: 'docArticle', toc: 'docsToc', sidebar: 'docsSidebar', search: 'docSearch' },
  },
  tutorials: {
    dir: 'tutorials/',
    label: 'Tutorials',
    view: { content: 'tutorialsContent', article: 'tutorialArticle', toc: 'tutorialsToc', sidebar: 'tutorialsSidebar', search: 'tutorialSearch' },
  },
};
const PAGES = ['home', 'docs', 'tutorials', 'sdk', 'tools', 'ecosystem'];
const DOC_FILE_RE = /^[A-Za-z0-9][\w.-]*\.md$/;
// Two upstream mirrors in docs/ are an order of magnitude larger than the rest.
// They stay listed and readable, but full-text search matches them by title so
// one keystroke does not pull a megabyte.
const SEARCH_WORD_LIMIT = 10000;

const fileCache = new Map();
let manifestPromise = null;
let hljsPromise = null;
let tocObserver = null;
let currentPage = 'home';

const state = {
  docs: { entries: [], file: null, query: '', token: 0, index: null, indexPromise: null },
  tutorials: { entries: [], file: null, query: '', token: 0, index: null, indexPromise: null },
};

const byId = (id) => document.getElementById(id);
const viewOf = (collection) => COLLECTIONS[collection].view;
const localUrl = (collection, file) => SITE_ROOT + COLLECTIONS[collection].dir + file;
const rawUrl = (collection, file) => RAW_ROOT + COLLECTIONS[collection].dir + file;
const blobUrl = (collection, file) => BLOB_ROOT + COLLECTIONS[collection].dir + file;
const docSlug = (file) => file.replace(/\.md$/i, '').toLowerCase();
const entryOf = (collection, file) => state[collection].entries.find((e) => e.file === file) || null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function trackKey(number) {
  return `track-${Math.floor((number - 1) / 10)}`;
}

function categoryLabel(collection, key, entries) {
  if (collection === 'tutorials') {
    const group = entries || state.tutorials.entries.filter((e) => e.category === key);
    const numbers = group.map((e) => e.number).filter(Boolean);
    if (!numbers.length) return 'Tutorials';
    const first = Math.min(...numbers);
    const last = Math.max(...numbers);
    return first === last ? `Tutorial ${first}` : `Tutorials ${first}-${last}`;
  }
  if (key === 'project') return 'Project';
  const match = CATEGORIES.find((c) => c.key === key);
  return match ? match.label : 'Reference';
}

// Accepts "getting-started.md", "./getting-started.md", "docs/getting-started.md"
// and the bare "getting-started" slug. Returns null for anything else.
function normalizeFile(collection, value) {
  if (!value) return null;
  const clean = value.trim().replace(/^\.?\//, '').replace(/^(docs|tutorials)\//i, '');
  if (clean.includes('..') || clean.includes('/')) return null;
  if (DOC_FILE_RE.test(clean)) return clean;
  const bySlug = state[collection].entries.find((e) => docSlug(e.file) === clean.toLowerCase());
  return bySlug ? bySlug.file : null;
}

async function fetchText(url) {
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return null;
  const text = await res.text().catch(() => null);
  return text || null;
}

// A single-page-app host serves index.html for unknown paths with a 200.
const looksLikeHtml = (text) => /^\s*<(!doctype|html)/i.test(text);

async function loadFile(collection, file) {
  const key = `${collection}/${file}`;
  if (fileCache.has(key)) return fileCache.get(key);

  const local = await fetchText(localUrl(collection, file));
  const bundled = local && !looksLikeHtml(local) ? local : null;
  const text = bundled || (await fetchText(rawUrl(collection, file)));
  if (!text) throw new Error(`${file} could not be loaded from this site or from GitHub.`);

  fileCache.set(key, text);
  return text;
}

// ==================== Manifest ====================
// scripts/build-manifest.mjs derives it from the repository, so tutorials, extra
// documentation pages, and the stats bar stay true without a second edit here.
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const local = await fetchText(SITE_ROOT + 'data/manifest.json');
      const text = local && !looksLikeHtml(local)
        ? local
        : await fetchText(RAW_ROOT + 'website/data/manifest.json');
      if (!text) throw new Error('The site manifest could not be loaded.');
      return JSON.parse(text);
    })();
  }
  return manifestPromise;
}

function curatedEntries() {
  return DOCS.map((doc) => ({
    file: doc.file,
    title: doc.title,
    summary: doc.desc,
    category: doc.category,
    emoji: doc.emoji,
    ticker: doc.ticker,
  }));
}

function applyManifest(manifest) {
  const curated = curatedEntries();
  const extra = manifest.docs
    .filter((doc) => !curated.some((c) => c.file === doc.file))
    .map((doc) => ({
      file: doc.file,
      title: doc.title,
      summary: doc.summary,
      category: 'project',
      emoji: '📄',
      minutes: doc.minutes,
      words: doc.words,
    }));
  state.docs.entries = [...curated, ...extra];

  state.tutorials.entries = manifest.tutorials.map((item) => ({
    file: item.file,
    title: item.title.replace(/^Tutorial\s+\d+:\s*/i, ''),
    summary: item.summary,
    category: trackKey(item.number || 1),
    number: item.number || null,
    minutes: item.minutes,
    words: item.words,
  }));

  renderStats(manifest.stats);
}

function renderStats(stats) {
  document.querySelectorAll('[data-stat]').forEach((el) => {
    const value = stats[el.dataset.stat];
    if (typeof value === 'number') el.textContent = String(value);
  });
}

// ==================== Router ====================
function parseRoute() {
  const raw = decodeURIComponent((window.location.hash || '').replace(/^#/, '')).trim();
  if (!raw || raw === 'home') return { page: 'home' };

  const [head, ...rest] = raw.split('/');
  if (COLLECTIONS[head]) {
    const [file, anchor] = rest.join('/').split('~');
    return { page: head, collection: head, file: normalizeFile(head, file), anchor: anchor || null };
  }
  if (PAGES.includes(head)) return { page: head };

  // Bare slugs (#getting-started, #api-reference) open the matching document.
  const file = normalizeFile('docs', head);
  return file ? { page: 'docs', collection: 'docs', file } : { page: 'home' };
}

function setRoute(hash) {
  const next = '#' + hash;
  if (window.location.hash === next) {
    applyRoute();
    return;
  }
  window.location.hash = next;
}

function navigateTo(page) {
  setRoute(PAGES.includes(page) ? page : 'home');
}

function openDoc(file, anchor) {
  setRoute('docs/' + file + (anchor ? '~' + anchor : ''));
}

function openTutorial(file, anchor) {
  setRoute('tutorials/' + file + (anchor ? '~' + anchor : ''));
}

function toggleMobileMenu() {
  byId('navLinks').classList.toggle('open');
}

function showPage(page) {
  const changed = currentPage !== page;
  currentPage = page;

  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('active'));

  const target = byId(`page-${page}`);
  if (target) target.classList.add('active');

  const navLink = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (navLink) navLink.classList.add('active');

  byId('navLinks').classList.remove('open');
  return changed;
}

function applyRoute() {
  const route = parseRoute();
  const pageChanged = showPage(route.page);

  if (!route.collection) {
    Object.keys(COLLECTIONS).forEach((c) => { state[c].file = null; });
    if (pageChanged) window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const collection = route.collection;
  const section = byId(`page-${collection}`);
  if (section) section.classList.toggle('reading', Boolean(route.file));

  renderSidebar(collection, route.file);

  if (route.file) {
    showArticle(collection, route.file, route.anchor);
  } else if (state[collection].query) {
    renderQuery(collection, state[collection].query);
  } else {
    showIndex(collection);
    if (pageChanged) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ==================== Cards ====================
function cardArt(collection, entry) {
  if (collection === 'tutorials') {
    return `<span class="tutorial-number">${String(entry.number || 0).padStart(2, '0')}</span>`;
  }
  return entry.emoji;
}

function cardHtml(collection, entry, snippet) {
  const meta = collection === 'tutorials'
    ? `<span>${entry.minutes} min</span><span>${escapeHtml(entry.file)}</span>`
    : `<span>${escapeHtml(categoryLabel(collection, entry.category))}</span><span>${escapeHtml(entry.file)}</span>`;

  return `
    <a class="token-card" data-category="${entry.category}" href="#${collection}/${encodeURIComponent(entry.file)}">
      <div class="token-card-header">${cardArt(collection, entry)}</div>
      <div class="token-card-body">
        <div class="token-card-title">
          ${escapeHtml(entry.title)}
          ${entry.ticker ? `<span class="token-card-ticker">$${escapeHtml(entry.ticker)}</span>` : ''}
        </div>
        <div class="token-card-desc">${escapeHtml(entry.summary || '')}</div>
        ${snippet ? `<div class="token-card-snippet">${snippet}</div>` : ''}
        <div class="token-card-meta">${meta}</div>
      </div>
    </a>
  `;
}

function renderDocGrid(filter = 'all') {
  const grid = byId('docGrid');
  if (!grid) return;

  const curated = curatedEntries();
  const filtered = filter === 'all' ? curated : curated.filter((d) => d.category === filter);
  grid.innerHTML = filtered.map((entry) => cardHtml('docs', entry)).join('');
}

function filterDocs(category) {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    const key = btn.textContent.trim().toLowerCase().replace(/\s+/g, '-');
    btn.classList.toggle('active', key === category || (category === 'all' && key === 'all'));
  });

  renderDocGrid(category);
}

// ==================== Index & sidebar ====================
function groupedEntries(collection) {
  const groups = new Map();
  state[collection].entries.forEach((entry) => {
    if (!groups.has(entry.category)) groups.set(entry.category, []);
    groups.get(entry.category).push(entry);
  });
  return [...groups.entries()];
}

function renderSidebar(collection, activeFile) {
  const sidebar = byId(viewOf(collection).sidebar);
  if (!sidebar) return;

  const groups = groupedEntries(collection);
  if (!groups.length) {
    sidebar.innerHTML = '<div class="docs-sidebar-loading">Loading…</div>';
    return;
  }

  sidebar.innerHTML = `
    <a class="docs-all-link${activeFile ? '' : ' active'}" href="#${collection}">All ${COLLECTIONS[collection].label.toLowerCase()}</a>
    ${groups.map(([key, entries]) => `
      <div class="docs-category">
        <div class="docs-category-title">${escapeHtml(categoryLabel(collection, key, entries))}</div>
        ${entries.map((entry) => `
          <a href="#${collection}/${encodeURIComponent(entry.file)}"
             class="docs-category-link${activeFile === entry.file ? ' active' : ''}"
             title="${escapeHtml(entry.summary || entry.title)}">${collection === 'tutorials'
               ? `<span class="docs-link-number">${String(entry.number || 0).padStart(2, '0')}</span>`
               : entry.emoji} ${escapeHtml(entry.title)}</a>
        `).join('')}
      </div>
    `).join('')}
  `;

  const active = sidebar.querySelector('.docs-category-link.active');
  if (active && typeof active.scrollIntoView === 'function') {
    active.scrollIntoView({ block: 'nearest' });
  }
}

function showIndex(collection, cards) {
  const view = viewOf(collection);
  const content = byId(view.content);
  const article = byId(view.article);
  const toc = byId(view.toc);
  if (!content || !article) return;

  state[collection].file = null;
  state[collection].token += 1;
  article.hidden = true;
  article.innerHTML = '';
  if (toc) {
    toc.hidden = true;
    toc.innerHTML = '';
  }

  content.hidden = false;
  if (cards) {
    content.innerHTML = cards;
    return;
  }

  const entries = state[collection].entries;
  content.innerHTML = entries.length
    ? entries.map((entry) => cardHtml(collection, entry)).join('')
    : `<div class="docs-empty"><div class="docs-empty-icon">⏳</div><h3>Loading ${escapeHtml(COLLECTIONS[collection].label.toLowerCase())}…</h3>
       <p>Reading the index generated from the repository.</p></div>`;
}

// ==================== Search ====================
// Markdown noise (fences, table pipes, heading marks) reads as garbage in a
// one-line preview, so search runs against a flattened copy of the body.
function flattenMarkdown(body) {
  return body
    .replace(/```[\w+-]*/g, ' ')
    .replace(/[`*_>|#]/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildSnippet(flat, query) {
  const at = flat.toLowerCase().indexOf(query);
  if (at < 0) return '';

  const start = Math.max(0, at - 60);
  const raw = flat.slice(start, at + query.length + 90).trim();
  const highlighted = escapeHtml(raw).replace(
    new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'),
    (hit) => `<mark>${hit}</mark>`,
  );
  return `${start > 0 ? '…' : ''}${highlighted}…`;
}

function indexableEntries(collection) {
  return state[collection].entries.filter((e) => !e.words || e.words <= SEARCH_WORD_LIMIT);
}

function skippedEntries(collection) {
  return state[collection].entries.filter((e) => e.words && e.words > SEARCH_WORD_LIMIT);
}

function ensureSearchIndex(collection) {
  const slot = state[collection];
  if (!slot.indexPromise) {
    slot.indexPromise = Promise.all(
      indexableEntries(collection).map((entry) => loadFile(collection, entry.file)
        .then((md) => [entry.file, flattenMarkdown(md)])
        .catch(() => [entry.file, ''])),
    ).then((pairs) => {
      slot.index = new Map(pairs);
      return slot.index;
    });
  }
  return slot.indexPromise;
}

function matchEntries(collection, query, index) {
  return state[collection].entries
    .map((entry) => {
      const meta = [entry.title, entry.summary, entry.ticker, entry.category, entry.file]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (meta.includes(query)) return { entry, snippet: '' };

      const body = index ? index.get(entry.file) || '' : '';
      if (body.toLowerCase().includes(query)) return { entry, snippet: buildSnippet(body, query) };
      return null;
    })
    .filter(Boolean);
}

function renderSearchResults(collection, query, results, deep) {
  const skipped = deep ? skippedEntries(collection) : [];
  const note = skipped.length
    ? `<div class="docs-search-note">Full-text search skips ${skipped.length} oversized reference
       ${skipped.length === 1 ? 'mirror' : 'mirrors'} (${skipped.map((e) => escapeHtml(e.file)).join(', ')});
       they still match by title.</div>`
    : '';

  if (!results.length) {
    showIndex(collection, `
      ${note}
      <div class="docs-empty">
        <div class="docs-empty-icon">🔍</div>
        <h3>Nothing matches “${escapeHtml(query)}”</h3>
        <p>Try a broader term, browse the list on the left, or search the full repository.</p>
        <div class="docs-empty-actions">
          <button class="btn btn-ghost btn-sm" onclick="clearSearch('${collection}')">Clear search</button>
          <a class="btn btn-ghost btn-sm" href="${REPO_URL}/search?q=${encodeURIComponent(query)}"
             target="_blank" rel="noopener">Search on GitHub ↗</a>
        </div>
      </div>
    `);
    return;
  }

  showIndex(collection, note + results.map(({ entry, snippet }) => cardHtml(collection, entry, snippet)).join(''));
}

// Metadata matches render immediately; the full-text pass lands as soon as the
// markdown index resolves, and is dropped if the query moved on.
function renderQuery(collection, query) {
  renderSearchResults(collection, query, matchEntries(collection, query, state[collection].index), Boolean(state[collection].index));
  if (query.length < 3) return;

  ensureSearchIndex(collection).then((index) => {
    const slot = state[collection];
    if (slot.query !== query || slot.file) return;
    renderSearchResults(collection, query, matchEntries(collection, query, index), true);
  });
}

function searchCollection(collection, value) {
  const query = value.trim().toLowerCase();
  const slot = state[collection];
  slot.query = query;

  if (currentPage !== collection) return;
  // Searching from inside a document returns to the index, and the route change
  // renders the results.
  if (slot.file) {
    setRoute(collection);
    return;
  }

  if (!query) {
    showIndex(collection);
    return;
  }

  renderQuery(collection, query);
}

function searchDocs(value) {
  searchCollection('docs', value);
}

function searchTutorials(value) {
  searchCollection('tutorials', value);
}

function clearSearch(collection) {
  const input = byId(viewOf(collection).search);
  if (input) input.value = '';
  state[collection].query = '';
  showIndex(collection);
}

// ==================== Markdown rendering ====================
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'section';
}

function loadHighlighter() {
  if (!hljsPromise) {
    hljsPromise = import(SITE_ROOT + 'vendor/hljs.mjs')
      .then((mod) => mod.default)
      .catch(() => null);
  }
  return hljsPromise;
}

function rewriteLink(anchor, collection, file) {
  const href = anchor.getAttribute('href') || '';

  if (href.startsWith('#')) {
    anchor.setAttribute('href', `#${collection}/${file}~${href.slice(1)}`);
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
    if (/^https?:/i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
    return;
  }

  const [path, hash] = href.split('#');
  const bare = path.replace(/^\.?\//, '');
  // A link may cross collections: ../tutorials/01-create-token.md from a doc.
  const crossed = bare.match(/^(?:\.\.\/)?(docs|tutorials)\/(.+)$/);
  const targetCollection = crossed ? crossed[1] : collection;
  const target = normalizeFile(targetCollection, crossed ? crossed[2] : bare);

  if (target) {
    anchor.setAttribute('href', `#${targetCollection}/${target}${hash ? '~' + hash : ''}`);
    return;
  }

  // Anything else in the repository (source files, scripts, sibling folders).
  const base = bare.startsWith('../') ? BLOB_ROOT : BLOB_ROOT + COLLECTIONS[collection].dir;
  anchor.setAttribute('href', base + bare.replace(/^\.\.\//, '') + (hash ? '#' + hash : ''));
  anchor.setAttribute('target', '_blank');
  anchor.setAttribute('rel', 'noopener noreferrer');
}

function hydrateArticleBody(body, collection, file) {
  body.querySelectorAll('a[href]').forEach((a) => rewriteLink(a, collection, file));

  body.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!/^https?:|^data:/i.test(src)) {
      const relative = src.replace(/^\.?\//, '');
      img.setAttribute('src', localUrl(collection, relative));
      img.dataset.fallback = rawUrl(collection, relative);
    }
    img.setAttribute('loading', 'lazy');
  });

  const used = new Set();
  const toc = [];
  body.querySelectorAll('h2, h3').forEach((heading) => {
    let id = slugify(heading.textContent);
    let n = 2;
    while (used.has(id)) id = `${slugify(heading.textContent)}-${n++}`;
    used.add(id);
    heading.id = id;

    const link = document.createElement('a');
    link.className = 'heading-anchor';
    link.href = `#${collection}/${file}~${id}`;
    link.setAttribute('aria-label', `Link to section: ${heading.textContent}`);
    link.textContent = '#';
    heading.appendChild(link);

    toc.push({ id, level: heading.tagName === 'H2' ? 2 : 3, text: heading.textContent.replace(/#$/, '') });
  });

  body.querySelectorAll('table').forEach((table) => {
    const scroller = document.createElement('div');
    scroller.className = 'doc-table-scroll';
    table.parentNode.insertBefore(scroller, table);
    scroller.appendChild(table);
  });

  body.querySelectorAll('pre > code').forEach((code) => {
    const pre = code.parentElement;
    const lang = (code.className.match(/language-([\w+-]+)/) || [, 'text'])[1];
    const block = document.createElement('figure');
    block.className = 'doc-code';
    block.dataset.lang = lang;

    const head = document.createElement('figcaption');
    head.className = 'doc-code-head';
    head.innerHTML = `<span class="doc-code-lang">${escapeHtml(lang)}</span>`;

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'doc-code-copy';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => copyCodeBlock(copy, code.textContent));
    head.appendChild(copy);

    if (lang === 'mermaid') {
      const view = document.createElement('a');
      view.className = 'doc-code-view';
      view.href = blobUrl(collection, file);
      view.target = '_blank';
      view.rel = 'noopener noreferrer';
      view.textContent = 'View rendered diagram ↗';
      head.appendChild(view);
    }

    pre.parentNode.insertBefore(block, pre);
    block.appendChild(head);
    block.appendChild(pre);
  });

  return toc;
}

function highlightArticle(body) {
  const blocks = [...body.querySelectorAll('.doc-code:not([data-lang="mermaid"]):not([data-lang="text"]) pre > code')];
  if (!blocks.length) return;

  loadHighlighter().then((hljs) => {
    if (!hljs) return;
    blocks.forEach((code) => {
      const lang = (code.className.match(/language-([\w+-]+)/) || [, ''])[1];
      if (!lang || !hljs.getLanguage(lang)) return;
      code.innerHTML = hljs.highlight(code.textContent, { language: lang }).value;
      code.classList.add('hljs');
    });
  });
}

function renderToc(collection, file, toc) {
  const rail = byId(viewOf(collection).toc);
  if (!rail) return;

  if (toc.length < 2) {
    rail.hidden = true;
    rail.innerHTML = '';
    return;
  }

  rail.hidden = false;
  rail.innerHTML = `
    <div class="docs-toc-title">On this page</div>
    <nav class="docs-toc-list">
      ${toc.map((item) => `
        <a class="docs-toc-link level-${item.level}" href="#${collection}/${file}~${item.id}" data-target="${item.id}">
          ${escapeHtml(item.text)}
        </a>
      `).join('')}
    </nav>
  `;
}

function trackTocScroll(collection, body) {
  const rail = byId(viewOf(collection).toc);
  if (!rail || rail.hidden) return;

  const links = new Map([...rail.querySelectorAll('.docs-toc-link')].map((l) => [l.dataset.target, l]));
  if (tocObserver) tocObserver.disconnect();

  tocObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((link) => link.classList.remove('active'));
      const link = links.get(entry.target.id);
      if (link) link.classList.add('active');
    });
  }, { rootMargin: '-88px 0px -70% 0px', threshold: 0 });

  body.querySelectorAll('h2, h3').forEach((h) => tocObserver.observe(h));
}

// ==================== Article ====================
function readingTime(markdown) {
  const words = markdown.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}

function fallbackEntry(collection, file, markdown) {
  const heading = markdown && markdown.match(/^#\s+(.+)$/m);
  return {
    title: heading ? heading[1].replace(/[#*`]/g, '').trim() : file.replace(/\.md$/i, ''),
    summary: collection === 'tutorials' ? 'Repository tutorial.' : 'Repository documentation.',
    category: collection === 'tutorials' ? 'track-0' : 'project',
    emoji: '📄',
    file,
  };
}

function articleArt(collection, entry) {
  return collection === 'tutorials'
    ? `<span class="tutorial-number">${String(entry.number || 0).padStart(2, '0')}</span>`
    : (entry.emoji || '📄');
}

function skeletonHtml(collection, entry, file) {
  return `
    <nav class="doc-breadcrumb"><a href="#${collection}">${COLLECTIONS[collection].label}</a><span>/</span><span>${escapeHtml(entry ? categoryLabel(collection, entry.category) : file)}</span></nav>
    <header class="doc-head">
      <div class="doc-head-icon">${entry ? articleArt(collection, entry) : '📄'}</div>
      <div class="doc-head-text">
        <h1>${escapeHtml(entry ? entry.title : file)}</h1>
        <p class="doc-head-desc">${escapeHtml(entry ? entry.summary || '' : 'Loading document…')}</p>
      </div>
    </header>
    <div class="doc-body" aria-busy="true">
      <div class="doc-skeleton line w80"></div>
      <div class="doc-skeleton line"></div>
      <div class="doc-skeleton line w60"></div>
      <div class="doc-skeleton block"></div>
      <div class="doc-skeleton line"></div>
      <div class="doc-skeleton line w40"></div>
    </div>
  `;
}

function errorHtml(collection, file, message) {
  return `
    <nav class="doc-breadcrumb"><a href="#${collection}">${COLLECTIONS[collection].label}</a><span>/</span><span>${escapeHtml(file)}</span></nav>
    <div class="doc-error">
      <div class="doc-error-icon">⚠️</div>
      <h2>This page could not be loaded</h2>
      <p>${escapeHtml(message)}</p>
      <p class="doc-error-hint">The site tried the bundled copy and then GitHub. A network block or an offline connection is the usual cause.</p>
      <div class="doc-error-actions">
        <button class="btn btn-primary btn-sm" onclick="retryArticle('${collection}', '${escapeHtml(file)}')">Try again</button>
        <a class="btn btn-ghost btn-sm" href="${blobUrl(collection, encodeURIComponent(file))}" target="_blank" rel="noopener">Read on GitHub ↗</a>
        <a class="btn btn-ghost btn-sm" href="#${collection}">Back to all ${COLLECTIONS[collection].label.toLowerCase()}</a>
      </div>
    </div>
  `;
}

function footerHtml(collection, entry) {
  const entries = state[collection].entries;
  const index = entries.findIndex((e) => e.file === entry.file);
  const prev = index > 0 ? entries[index - 1] : null;
  const next = index >= 0 && index < entries.length - 1 ? entries[index + 1] : null;
  const label = (e) => `${collection === 'tutorials' ? String(e.number || 0).padStart(2, '0') : e.emoji} ${escapeHtml(e.title)}`;

  return `
    <footer class="doc-footer">
      <div class="doc-footer-nav">
        ${prev ? `<a class="doc-footer-link prev" href="#${collection}/${encodeURIComponent(prev.file)}">
          <span>← Previous</span><strong>${label(prev)}</strong></a>` : '<span></span>'}
        ${next ? `<a class="doc-footer-link next" href="#${collection}/${encodeURIComponent(next.file)}">
          <span>Next →</span><strong>${label(next)}</strong></a>` : '<span></span>'}
      </div>
      <div class="doc-footer-meta">
        <a href="${blobUrl(collection, encodeURIComponent(entry.file))}" target="_blank" rel="noopener">View source on GitHub ↗</a>
        <a href="${REPO_URL}/issues/new?title=${encodeURIComponent(COLLECTIONS[collection].dir + entry.file)}" target="_blank" rel="noopener">Report an issue ↗</a>
      </div>
    </footer>
  `;
}

function scrollToAnchor(anchor) {
  const target = anchor ? document.getElementById(anchor) : null;
  if (!target) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const top = target.getBoundingClientRect().top + window.scrollY - 96;
  window.scrollTo({ top, behavior: 'smooth' });
}

function stripLead(markdown, summary) {
  let body = markdown.replace(/^#\s+.+\n+/, '');
  if (!summary) return body;

  const lead = body.match(/^((?:>.*\n)+)\n*/);
  if (lead && lead[1].replace(/^>\s?/gm, '').replace(/\s+/g, ' ').trim().startsWith(summary.slice(0, 60))) {
    body = body.slice(lead[0].length);
  }
  return body;
}

async function showArticle(collection, file, anchor) {
  const view = viewOf(collection);
  const article = byId(view.article);
  const content = byId(view.content);
  if (!article || !content) return;

  const slot = state[collection];
  const entry = entryOf(collection, file);
  content.hidden = true;
  article.hidden = false;

  if (slot.file === file && article.dataset.state === 'ready') {
    scrollToAnchor(anchor);
    return;
  }

  slot.file = file;
  const token = ++slot.token;
  article.dataset.state = 'loading';
  article.innerHTML = skeletonHtml(collection, entry, file);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  let markdown;
  try {
    markdown = await loadFile(collection, file);
  } catch (err) {
    if (token !== slot.token) return;
    article.dataset.state = 'error';
    article.innerHTML = errorHtml(collection, file, err.message);
    const toc = byId(view.toc);
    if (toc) {
      toc.hidden = true;
      toc.innerHTML = '';
    }
    return;
  }
  if (token !== slot.token) return;

  const meta = entry || fallbackEntry(collection, file, markdown);
  article.dataset.provisional = entry ? '' : '1';
  // The page header below carries the title and the lead blockquote summary, so
  // both are dropped from the body instead of being shown twice.
  const bodyMarkdown = stripLead(markdown, meta.summary);
  const dirty = window.marked.parse(bodyMarkdown, { gfm: true });
  const clean = window.DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });

  article.dataset.state = 'ready';
  article.innerHTML = `
    <nav class="doc-breadcrumb">
      <a href="#${collection}">${COLLECTIONS[collection].label}</a><span>/</span><span>${escapeHtml(categoryLabel(collection, meta.category))}</span>
    </nav>
    <header class="doc-head" data-category="${meta.category}">
      <div class="doc-head-icon">${articleArt(collection, meta)}</div>
      <div class="doc-head-text">
        <h1>${escapeHtml(meta.title)}${meta.ticker ? ` <span class="doc-head-ticker">$${escapeHtml(meta.ticker)}</span>` : ''}</h1>
        <p class="doc-head-desc">${escapeHtml(meta.summary || '')}</p>
        <div class="doc-head-meta">
          <span>${escapeHtml(categoryLabel(collection, meta.category))}</span>
          <span>${escapeHtml(meta.file)}</span>
          <span>${readingTime(markdown)} min read</span>
        </div>
      </div>
      <div class="doc-head-actions">
        <button class="btn btn-ghost btn-sm" onclick="copyDocLink(this)">Copy link</button>
        <a class="btn btn-ghost btn-sm" href="${blobUrl(collection, encodeURIComponent(meta.file))}" target="_blank" rel="noopener">GitHub ↗</a>
      </div>
    </header>
    <div class="doc-body markdown"></div>
    ${entry ? footerHtml(collection, meta) : ''}
  `;

  const body = article.querySelector('.doc-body');
  body.innerHTML = clean;
  const toc = hydrateArticleBody(body, collection, file);
  renderToc(collection, file, toc);
  trackTocScroll(collection, body);
  highlightArticle(body);
  scrollToAnchor(anchor);
}

function retryArticle(collection, file) {
  fileCache.delete(`${collection}/${file}`);
  state[collection].file = null;
  showArticle(collection, file, null);
}

// ==================== Code Tabs ====================
function showCodeTab(tab) {
  document.querySelectorAll('.code-tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.code-panel').forEach((p) => p.classList.remove('active'));

  const tabBtn = document.querySelector(`.code-tab[onclick*="${tab}"]`);
  const panel = byId(`code-${tab}`);

  if (tabBtn) tabBtn.classList.add('active');
  if (panel) panel.classList.add('active');
}

// ==================== Clipboard ====================
function writeClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok ? Promise.resolve() : Promise.reject(new Error('Copy was blocked by the browser.'));
}

function flashButton(btn, done, fail) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = fail || done;
  btn.classList.toggle('is-error', Boolean(fail));
  window.setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('is-error');
  }, 1600);
}

function copyInstall() {
  const btn = document.querySelector('.copy-btn');
  writeClipboard('npm install @nirholas/pump-sdk')
    .then(() => btn && flashButton(btn, '✅'))
    .catch(() => btn && flashButton(btn, '', '⚠️'));
}

function copyCodeBlock(btn, code) {
  writeClipboard(code)
    .then(() => flashButton(btn, 'Copied'))
    .catch(() => flashButton(btn, '', 'Press ⌘C'));
}

function copyDocLink(btn) {
  writeClipboard(window.location.href)
    .then(() => flashButton(btn, 'Link copied'))
    .catch(() => flashButton(btn, '', 'Copy failed'));
}

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', () => {
  state.docs.entries = curatedEntries();
  renderDocGrid();
  renderSidebar('docs', null);
  applyRoute();

  loadManifest()
    .then((manifest) => {
      applyManifest(manifest);
      // An article opened before the manifest arrived rendered without its
      // real title or footer: drop it so the route re-renders with metadata.
      Object.keys(COLLECTIONS).forEach((collection) => {
        const article = byId(viewOf(collection).article);
        if (article && article.dataset.provisional === '1') state[collection].file = null;
      });
      if (parseRoute().collection) applyRoute();
    })
    .catch(() => {
      // The curated documentation list still works without the manifest; only
      // the tutorial index depends on it.
      const tutorials = byId(viewOf('tutorials').content);
      if (tutorials) {
        tutorials.innerHTML = `
          <div class="docs-empty">
            <div class="docs-empty-icon">⚠️</div>
            <h3>The tutorial index could not be loaded</h3>
            <p>Read them on GitHub while the site index is unavailable.</p>
            <div class="docs-empty-actions">
              <a class="btn btn-ghost btn-sm" href="${REPO_URL}/tree/main/tutorials" target="_blank" rel="noopener">Browse tutorials ↗</a>
            </div>
          </div>`;
      }
    });

  window.addEventListener('hashchange', applyRoute);

  // Inline handlers live on href="#" anchors; stop them rewriting the hash.
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href="#"]');
    if (anchor) event.preventDefault();
  });

  document.addEventListener('error', (event) => {
    const img = event.target;
    if (img.tagName === 'IMG' && img.dataset.fallback) {
      const fallback = img.dataset.fallback;
      delete img.dataset.fallback;
      img.src = fallback;
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    const collection = COLLECTIONS[currentPage] ? currentPage : null;

    if (event.key === '/' && !typing) {
      event.preventDefault();
      const target = collection || 'docs';
      if (!collection) setRoute(target);
      const input = byId(viewOf(target).search);
      if (input) input.focus();
      return;
    }

    if (event.key === 'Escape') {
      if (typing && collection && document.activeElement.id === viewOf(collection).search) {
        clearSearch(collection);
        document.activeElement.blur();
        return;
      }
      if (collection && state[collection].file) setRoute(collection);
    }
  });
});
