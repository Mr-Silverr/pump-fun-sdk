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

// ==================== Doc Sources ====================
// Markdown is bundled next to the site by scripts/build-site.mjs. If a file is
// missing from the bundle (or the SPA host answers with index.html), the reader
// falls back to the canonical copy on GitHub so no link is ever a dead end.
const REPO_URL = 'https://github.com/nirholas/pump-fun-sdk';
// Resolved against app.js itself, so the bundled markdown is found even when the
// SPA fallback serves the site from a deeper path such as /docs/.
const SITE_ROOT = new URL('.', document.currentScript ? document.currentScript.src : window.location.href).href;
const DOC_SOURCE = {
  local: SITE_ROOT + 'docs/',
  raw: 'https://raw.githubusercontent.com/nirholas/pump-fun-sdk/main/docs/',
  blob: REPO_URL + '/blob/main/docs/',
};
const DOC_FILE_RE = /^[A-Za-z0-9][\w.-]*\.md$/;
const PAGES = ['home', 'docs', 'sdk', 'tools', 'ecosystem'];

const docCache = new Map();
let searchIndexPromise = null;
let hljsPromise = null;
let renderToken = 0;
let currentPage = 'home';
let currentDoc = null;
let currentQuery = '';
let tocObserver = null;

const byId = (id) => document.getElementById(id);
const docSlug = (file) => file.replace(/\.md$/i, '').toLowerCase();
const docEntry = (file) => DOCS.find((d) => d.file.toLowerCase() === file.toLowerCase()) || null;
const categoryLabel = (key) => (CATEGORIES.find((c) => c.key === key) || { label: 'Reference' }).label;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Accepts "getting-started.md", "./getting-started.md", "docs/getting-started.md"
// and the bare "getting-started" slug. Returns null for anything else.
function normalizeDocFile(value) {
  if (!value) return null;
  const clean = value.trim().replace(/^\.?\//, '').replace(/^docs\//i, '');
  if (clean.includes('..') || clean.includes('/')) return null;
  if (DOC_FILE_RE.test(clean)) return clean;
  const bySlug = DOCS.find((d) => docSlug(d.file) === clean.toLowerCase());
  return bySlug ? bySlug.file : null;
}

async function fetchText(url) {
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) return null;
  const text = await res.text().catch(() => null);
  return text || null;
}

async function loadDoc(file) {
  if (docCache.has(file)) return docCache.get(file);

  const local = await fetchText(DOC_SOURCE.local + file);
  // A single-page-app host serves index.html for unknown paths with a 200.
  const bundled = local && !/^\s*<(!doctype|html)/i.test(local) ? local : null;
  const text = bundled || (await fetchText(DOC_SOURCE.raw + file));
  if (!text) throw new Error(`${file} could not be loaded from this site or from GitHub.`);

  docCache.set(file, text);
  return text;
}

// ==================== Router ====================
function parseRoute() {
  const raw = decodeURIComponent((window.location.hash || '').replace(/^#/, '')).trim();
  if (!raw || raw === 'home') return { page: 'home' };

  const [head, ...rest] = raw.split('/');
  if (head === 'docs') {
    const [file, anchor] = rest.join('/').split('~');
    return { page: 'docs', file: normalizeDocFile(file), anchor: anchor || null };
  }
  if (PAGES.includes(head)) return { page: head };

  // Bare slugs (#getting-started, #api-reference) open the matching document.
  const file = normalizeDocFile(head);
  return file ? { page: 'docs', file } : { page: 'home' };
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

  if (route.page !== 'docs') {
    currentDoc = null;
    if (pageChanged) window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const docsPage = byId('page-docs');
  if (docsPage) docsPage.classList.toggle('reading', Boolean(route.file));

  renderDocsSidebar(route.file);
  if (route.file) {
    showDocArticle(route.file, route.anchor);
  } else if (currentQuery) {
    renderQuery(currentQuery);
  } else {
    showDocsIndex();
    if (pageChanged) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// ==================== Doc Cards ====================
function docCardHtml(doc, snippet) {
  return `
    <a class="token-card" data-category="${doc.category}" href="#docs/${encodeURIComponent(doc.file)}">
      <div class="token-card-header">${doc.emoji}</div>
      <div class="token-card-body">
        <div class="token-card-title">
          ${escapeHtml(doc.title)}
          <span class="token-card-ticker">$${escapeHtml(doc.ticker)}</span>
        </div>
        <div class="token-card-desc">${escapeHtml(doc.desc)}</div>
        ${snippet ? `<div class="token-card-snippet">${snippet}</div>` : ''}
        <div class="token-card-meta">
          <span>${doc.category.replace('-', ' ')}</span>
          <span>${doc.file}</span>
        </div>
      </div>
    </a>
  `;
}

function renderDocGrid(filter = 'all') {
  const grid = byId('docGrid');
  if (!grid) return;

  const filtered = filter === 'all' ? DOCS : DOCS.filter((d) => d.category === filter);
  grid.innerHTML = filtered.map((doc) => docCardHtml(doc)).join('');
}

function filterDocs(category) {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    const key = btn.textContent.trim().toLowerCase().replace(/\s+/g, '-');
    btn.classList.toggle('active', key === category || (category === 'all' && key === 'all'));
  });

  renderDocGrid(category);
}

// ==================== Docs Index ====================
function renderDocsSidebar(activeFile) {
  const sidebar = byId('docsSidebar');
  if (!sidebar) return;

  sidebar.innerHTML = `
    <a class="docs-all-link${activeFile ? '' : ' active'}" href="#docs">All documentation</a>
    ${CATEGORIES.map((cat) => `
      <div class="docs-category">
        <div class="docs-category-title">${cat.label}</div>
        ${DOCS.filter((d) => d.category === cat.key).map((doc) => `
          <a href="#docs/${encodeURIComponent(doc.file)}"
             class="docs-category-link${activeFile === doc.file ? ' active' : ''}"
             title="${escapeHtml(doc.desc)}">${doc.emoji} ${escapeHtml(doc.title)}</a>
        `).join('')}
      </div>
    `).join('')}
  `;

  const active = sidebar.querySelector('.docs-category-link.active');
  if (active && typeof active.scrollIntoView === 'function') {
    active.scrollIntoView({ block: 'nearest' });
  }
}

function showDocsIndex(cards) {
  const content = byId('docsContent');
  const article = byId('docArticle');
  const toc = byId('docsToc');
  if (!content || !article) return;

  currentDoc = null;
  renderToken += 1;
  article.hidden = true;
  article.innerHTML = '';
  if (toc) {
    toc.hidden = true;
    toc.innerHTML = '';
  }
  content.hidden = false;
  content.innerHTML = cards || DOCS.map((doc) => docCardHtml(doc)).join('');
}

// ==================== Search ====================
// Markdown noise (fences, table pipes, heading marks) reads as garbage in a
// one-line preview, so the snippet is taken from a flattened copy of the body.
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

function ensureSearchIndex() {
  if (!searchIndexPromise) {
    searchIndexPromise = Promise.all(
      DOCS.map((doc) => loadDoc(doc.file)
        .then((md) => [doc.file, md])
        .catch(() => [doc.file, ''])),
    ).then((pairs) => new Map(pairs.map(([file, md]) => [file, flattenMarkdown(md)])));
  }
  return searchIndexPromise;
}

function renderSearchResults(query, results) {
  const content = byId('docsContent');
  if (!content) return;

  if (!results.length) {
    showDocsIndex(`
      <div class="docs-empty">
        <div class="docs-empty-icon">🔍</div>
        <h3>No documentation matches “${escapeHtml(query)}”</h3>
        <p>Try a broader term, browse the categories on the left, or search the full repository.</p>
        <div class="docs-empty-actions">
          <button class="btn btn-ghost btn-sm" onclick="clearDocSearch()">Clear search</button>
          <a class="btn btn-ghost btn-sm" href="${REPO_URL}/search?q=${encodeURIComponent(query)}"
             target="_blank" rel="noopener">Search on GitHub ↗</a>
        </div>
      </div>
    `);
    return;
  }

  showDocsIndex(results.map(({ doc, snippet }) => docCardHtml(doc, snippet)).join(''));
}

function matchDocs(query, index) {
  return DOCS
    .map((doc) => {
      const meta = [doc.title, doc.desc, doc.ticker, doc.category, doc.file]
        .join(' ')
        .toLowerCase();
      if (meta.includes(query)) return { doc, snippet: '' };

      const body = index ? index.get(doc.file) || '' : '';
      if (body.toLowerCase().includes(query)) return { doc, snippet: buildSnippet(body, query) };
      return null;
    })
    .filter(Boolean);
}

// Metadata matches render immediately; the full-text pass lands as soon as the
// markdown index resolves, and is dropped if the query moved on.
function renderQuery(query) {
  renderSearchResults(query, matchDocs(query, null));
  if (query.length < 3) return;

  ensureSearchIndex().then((index) => {
    // Drop the result if the query moved on or a document was opened meanwhile.
    if (currentQuery !== query || currentDoc) return;
    renderSearchResults(query, matchDocs(query, index));
  });
}

function searchDocs(value) {
  const query = value.trim().toLowerCase();
  currentQuery = query;

  if (currentPage !== 'docs') return;
  // Searching from inside a document returns to the index, and the route change
  // renders the results.
  if (currentDoc) {
    setRoute('docs');
    return;
  }

  if (!query) {
    showDocsIndex();
    return;
  }

  renderQuery(query);
}

function clearDocSearch() {
  const input = byId('docSearch');
  if (input) input.value = '';
  currentQuery = '';
  showDocsIndex();
}

// ==================== Markdown Rendering ====================
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

function rewriteLink(anchor, file) {
  const href = anchor.getAttribute('href') || '';

  if (href.startsWith('#')) {
    anchor.setAttribute('href', `#docs/${file}~${href.slice(1)}`);
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
  const target = normalizeDocFile(path);
  if (target) {
    anchor.setAttribute('href', `#docs/${target}${hash ? '~' + hash : ''}`);
    return;
  }

  // Anything else in the repo (source files, scripts, sibling folders).
  anchor.setAttribute('href', DOC_SOURCE.blob + path.replace(/^\.?\//, '') + (hash ? '#' + hash : ''));
  anchor.setAttribute('target', '_blank');
  anchor.setAttribute('rel', 'noopener noreferrer');
}

function hydrateArticleBody(body, file) {
  body.querySelectorAll('a[href]').forEach((a) => rewriteLink(a, file));

  body.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!/^https?:|^data:/i.test(src)) {
      const relative = src.replace(/^\.?\//, '');
      img.setAttribute('src', DOC_SOURCE.local + relative);
      img.dataset.fallback = DOC_SOURCE.raw + relative;
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
    link.href = `#docs/${file}~${id}`;
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
      view.href = DOC_SOURCE.blob + file;
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

function renderToc(toc) {
  const rail = byId('docsToc');
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
        <a class="docs-toc-link level-${item.level}" href="#docs/${currentDoc}~${item.id}" data-target="${item.id}">
          ${escapeHtml(item.text)}
        </a>
      `).join('')}
    </nav>
  `;
}

function trackTocScroll(body) {
  const rail = byId('docsToc');
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


// ==================== Doc Article ====================
function readingTime(markdown) {
  const words = markdown.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}

function fallbackEntry(file, markdown) {
  const heading = markdown && markdown.match(/^#\s+(.+)$/m);
  return {
    title: heading ? heading[1].replace(/[#*`]/g, '').trim() : file.replace(/\.md$/i, ''),
    ticker: 'DOC',
    emoji: '📄',
    category: 'reference',
    desc: 'Repository documentation.',
    file,
  };
}

function docSkeletonHtml(entry, file) {
  return `
    <nav class="doc-breadcrumb"><a href="#docs">Docs</a><span>/</span><span>${escapeHtml(entry ? categoryLabel(entry.category) : 'Reference')}</span></nav>
    <header class="doc-head">
      <div class="doc-head-icon">${entry ? entry.emoji : '📄'}</div>
      <div class="doc-head-text">
        <h1>${escapeHtml(entry ? entry.title : file)}</h1>
        <p class="doc-head-desc">${escapeHtml(entry ? entry.desc : 'Loading document…')}</p>
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

function docErrorHtml(file, message) {
  return `
    <nav class="doc-breadcrumb"><a href="#docs">Docs</a><span>/</span><span>${escapeHtml(file)}</span></nav>
    <div class="doc-error">
      <div class="doc-error-icon">⚠️</div>
      <h2>This page could not be loaded</h2>
      <p>${escapeHtml(message)}</p>
      <p class="doc-error-hint">The site tried the bundled copy and then GitHub. A network block or an offline connection is the usual cause.</p>
      <div class="doc-error-actions">
        <button class="btn btn-primary btn-sm" onclick="retryDoc('${escapeHtml(file)}')">Try again</button>
        <a class="btn btn-ghost btn-sm" href="${DOC_SOURCE.blob}${encodeURIComponent(file)}" target="_blank" rel="noopener">Read on GitHub ↗</a>
        <a class="btn btn-ghost btn-sm" href="#docs">Back to all docs</a>
      </div>
    </div>
  `;
}

function docFooterHtml(entry) {
  const index = DOCS.findIndex((d) => d.file === entry.file);
  const prev = index > 0 ? DOCS[index - 1] : null;
  const next = index >= 0 && index < DOCS.length - 1 ? DOCS[index + 1] : null;

  return `
    <footer class="doc-footer">
      <div class="doc-footer-nav">
        ${prev ? `<a class="doc-footer-link prev" href="#docs/${encodeURIComponent(prev.file)}">
          <span>← Previous</span><strong>${prev.emoji} ${escapeHtml(prev.title)}</strong></a>` : '<span></span>'}
        ${next ? `<a class="doc-footer-link next" href="#docs/${encodeURIComponent(next.file)}">
          <span>Next →</span><strong>${next.emoji} ${escapeHtml(next.title)}</strong></a>` : '<span></span>'}
      </div>
      <div class="doc-footer-meta">
        <a href="${DOC_SOURCE.blob}${encodeURIComponent(entry.file)}" target="_blank" rel="noopener">View source on GitHub ↗</a>
        <a href="${REPO_URL}/issues/new?title=${encodeURIComponent('docs: ' + entry.file)}" target="_blank" rel="noopener">Report an issue ↗</a>
      </div>
    </footer>
  `;
}

function scrollToAnchor(anchor) {
  if (!anchor) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const target = document.getElementById(anchor);
  if (!target) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const top = target.getBoundingClientRect().top + window.scrollY - 96;
  window.scrollTo({ top, behavior: 'smooth' });
}

async function showDocArticle(file, anchor) {
  const article = byId('docArticle');
  const content = byId('docsContent');
  if (!article || !content) return;

  const entry = docEntry(file);
  content.hidden = true;
  article.hidden = false;

  if (currentDoc === file && article.dataset.state === 'ready') {
    scrollToAnchor(anchor);
    return;
  }

  currentDoc = file;
  const token = ++renderToken;
  article.dataset.state = 'loading';
  article.innerHTML = docSkeletonHtml(entry, file);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  let markdown;
  try {
    markdown = await loadDoc(file);
  } catch (err) {
    if (token !== renderToken) return;
    article.dataset.state = 'error';
    article.innerHTML = docErrorHtml(file, err.message);
    const toc = byId('docsToc');
    if (toc) {
      toc.hidden = true;
      toc.innerHTML = '';
    }
    return;
  }
  if (token !== renderToken) return;

  const meta = entry || fallbackEntry(file, markdown);
  // The leading H1 is replaced by the page header below, so drop it from the body.
  const bodyMarkdown = markdown.replace(/^#\s+.+\n+/, '');
  const dirty = window.marked.parse(bodyMarkdown, { gfm: true });
  const clean = window.DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });

  article.dataset.state = 'ready';
  article.innerHTML = `
    <nav class="doc-breadcrumb">
      <a href="#docs">Docs</a><span>/</span><span>${escapeHtml(categoryLabel(meta.category))}</span>
    </nav>
    <header class="doc-head" data-category="${meta.category}">
      <div class="doc-head-icon">${meta.emoji}</div>
      <div class="doc-head-text">
        <h1>${escapeHtml(meta.title)} <span class="doc-head-ticker">$${escapeHtml(meta.ticker)}</span></h1>
        <p class="doc-head-desc">${escapeHtml(meta.desc)}</p>
        <div class="doc-head-meta">
          <span>${escapeHtml(categoryLabel(meta.category))}</span>
          <span>${escapeHtml(meta.file)}</span>
          <span>${readingTime(markdown)} min read</span>
        </div>
      </div>
      <div class="doc-head-actions">
        <button class="btn btn-ghost btn-sm" onclick="copyDocLink(this)">Copy link</button>
        <a class="btn btn-ghost btn-sm" href="${DOC_SOURCE.blob}${encodeURIComponent(meta.file)}" target="_blank" rel="noopener">GitHub ↗</a>
      </div>
    </header>
    <div class="doc-body markdown"></div>
    ${entry ? docFooterHtml(meta) : ''}
  `;

  const body = article.querySelector('.doc-body');
  body.innerHTML = clean;
  const toc = hydrateArticleBody(body, file);
  renderToc(toc);
  trackTocScroll(body);
  highlightArticle(body);
  scrollToAnchor(anchor);
}

function retryDoc(file) {
  docCache.delete(file);
  currentDoc = null;
  showDocArticle(file, null);
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
  renderDocGrid();
  renderDocsSidebar(null);
  applyRoute();

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

    if (event.key === '/' && !typing) {
      event.preventDefault();
      if (currentPage !== 'docs') setRoute('docs');
      const input = byId('docSearch');
      if (input) input.focus();
      return;
    }

    if (event.key === 'Escape') {
      if (typing && document.activeElement.id === 'docSearch') {
        clearDocSearch();
        document.activeElement.blur();
        return;
      }
      if (currentPage === 'docs' && currentDoc) setRoute('docs');
    }
  });
});
