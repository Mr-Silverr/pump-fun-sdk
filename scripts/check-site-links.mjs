#!/usr/bin/env node
/**
 * Fail the site build on a link that goes nowhere.
 *
 * The website is hand-written HTML plus a curated list in website/app.js, and
 * both point at files that live elsewhere in the repository: documents,
 * tutorials, dashboards, source directories. Renaming one of those used to
 * leave a card silently pointing at a 404. This checks every target that can be
 * resolved offline:
 *
 *   #docs/<file>.md        -> docs/<file>.md exists
 *   #tutorials/<file>.md   -> tutorials/<file>.md exists
 *   #<page>                -> a <section id="page-<page>"> exists, or the slug
 *                             matches a documentation file
 *   live/x.html            -> the file exists in the repository
 *   github.com/.../tree/main/<path> and /blob/main/<path> -> the path exists
 *   DOCS entries in app.js -> every file exists in docs/
 *   website/data/manifest.json -> matches what build-manifest.mjs produces now
 *
 * Run: node scripts/check-site-links.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, 'website');
const html = readFileSync(join(siteDir, 'index.html'), 'utf8');
const appJs = readFileSync(join(siteDir, 'app.js'), 'utf8');

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

const pages = new Set([...html.matchAll(/id="page-([\w-]+)"/g)].map((m) => m[1]));
const repoPrefix = 'https://github.com/nirholas/pump-fun-sdk/';

function checkCollectionRoute(where, collection, file) {
  const target = decodeURIComponent(file.split('~')[0]);
  if (!existsSync(join(root, collection, target))) {
    fail(where, `#${collection}/${target} has no file at ${collection}/${target}`);
  }
}

function checkHash(where, hash) {
  const value = hash.replace(/^#/, '');
  if (!value) return;

  const [head, ...rest] = value.split('/');
  if (head === 'docs' || head === 'tutorials') {
    if (rest.length) checkCollectionRoute(where, head, rest.join('/'));
    return;
  }
  if (pages.has(head)) return;
  if (existsSync(join(root, 'docs', `${head}.md`))) return;
  fail(where, `#${value} matches no page and no documentation file`);
}

// 1. Every href in the site.
for (const match of html.matchAll(/href="([^"]+)"/g)) {
  const href = match[1];
  const where = 'website/index.html';

  if (href.startsWith('#')) {
    checkHash(where, href);
  } else if (href.startsWith(repoPrefix)) {
    const path = href.slice(repoPrefix.length).replace(/^(tree|blob)\/main\//, '').split('#')[0];
    if (path && !path.startsWith('issues') && !path.startsWith('search') && !existsSync(join(root, path))) {
      fail(where, `${href} points at a path that does not exist in the repository`);
    }
  } else if (!/^(https?:|mailto:|data:)/i.test(href)) {
    const path = href.split('#')[0].split('?')[0];
    if (path && !existsSync(join(siteDir, path)) && !existsSync(join(root, path))) {
      fail(where, `relative link ${href} resolves to nothing`);
    }
  }
}

// 2. Inline handlers that open a document.
for (const match of html.matchAll(/open(Doc|Tutorial)\('([^']+)'/g)) {
  const collection = match[1] === 'Doc' ? 'docs' : 'tutorials';
  checkCollectionRoute('website/index.html', collection, match[2]);
}

// 3. The curated documentation list.
const docsBlock = appJs.slice(appJs.indexOf('const DOCS = ['), appJs.indexOf('const CATEGORIES'));
for (const match of docsBlock.matchAll(/file:\s*"([^"]+)"/g)) {
  if (!existsSync(join(root, 'docs', match[1]))) {
    fail('website/app.js', `DOCS entry "${match[1]}" has no file at docs/${match[1]}`);
  }
}

// 4. The generated manifest must match the repository as it stands now.
const manifestPath = join(siteDir, 'data', 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('website/data/manifest.json', 'is missing; run node scripts/build-manifest.mjs');
} else {
  const before = readFileSync(manifestPath, 'utf8');
  execFileSync(process.execPath, [join(root, 'scripts', 'build-manifest.mjs')], { stdio: 'pipe' });
  if (readFileSync(manifestPath, 'utf8') !== before) {
    fail('website/data/manifest.json', 'was stale and has been regenerated; commit the update');
  }
}

if (problems.length) {
  console.error(`Site link check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

console.log('Site link check passed: every in-site route, dashboard, and source link resolves.');
