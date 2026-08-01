#!/usr/bin/env node
/**
 * Assemble the deployable website bundle into dist-site/.
 *
 * Layout:
 *   /            -> website/  (SDK docs & marketing SPA)
 *   /docs/       -> docs/     (markdown the docs reader fetches and renders)
 *   /live/       -> live/     (standalone dashboards: launches, trades, vanity)
 *
 * Top-level aliases (/live, /trades, /vanity, /chart) keep old links
 * working via the _redirects file written below.
 *
 * Output is consumed by wrangler.jsonc (Cloudflare Workers static assets)
 * and by any static host (nginx, etc.).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-site');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(join(root, 'website'), out, {
  recursive: true,
  filter: (src) => !/vercel\.json$|README\.md$/.test(src),
});

// Markdown for the in-site documentation reader (website/app.js fetches
// /docs/<file>.md). Top-level files only: nested folders are upstream vendor
// copies that the reader links to on GitHub instead.
const docsSrc = join(root, 'docs');
const docsOut = join(out, 'docs');
mkdirSync(docsOut, { recursive: true });

let mdCount = 0;
for (const entry of readdirSync(docsSrc, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.md')) {
    cpSync(join(docsSrc, entry.name), join(docsOut, entry.name));
    mdCount += 1;
  }
}
cpSync(join(docsSrc, 'assets'), join(docsOut, 'assets'), { recursive: true });

mkdirSync(join(out, 'live'), { recursive: true });
for (const f of readdirSync(join(root, 'live'))) {
  if (f.endsWith('.html')) cpSync(join(root, 'live', f), join(out, 'live', f));
}

writeFileSync(
  join(out, '_redirects'),
  [
    '/trades /live/trades 302',
    '/vanity /live/vanity 302',
    '/chart /live/dashboard 302',
    '',
  ].join('\n'),
);

writeFileSync(
  join(out, '_headers'),
  [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    // Filenames are not content-hashed, so app.js/styles.css revalidate often
    // enough that a deploy reaches returning visitors the same day.
    '/*.css',
    '  Cache-Control: public, max-age=600, must-revalidate',
    '/*.js',
    '  Cache-Control: public, max-age=600, must-revalidate',
    '/vendor/*',
    '  Cache-Control: public, max-age=86400',
    '/docs/*',
    '  Cache-Control: public, max-age=600',
    '',
  ].join('\n'),
);

const files = readdirSync(out, { recursive: true }).length;
console.log(`dist-site/ assembled (${files} entries, ${mdCount} docs)`);
