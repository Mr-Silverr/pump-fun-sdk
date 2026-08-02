#!/usr/bin/env node
/**
 * Assemble the deployable website bundle into dist-site/.
 *
 * Layout:
 *   /            -> website/  (SDK docs & marketing SPA)
 *   /docs/       -> docs/      (markdown the reader fetches and renders)
 *   /tutorials/  -> tutorials/ (same, for the tutorial track)
 *   /live/       -> live/     (standalone dashboards: launches, trades, vanity)
 *
 * Top-level aliases (/live, /trades, /vanity, /chart) keep old links
 * working via the _redirects file written below.
 *
 * Output is consumed by wrangler.jsonc (Cloudflare Workers static assets)
 * and by any static host (nginx, etc.).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-site');

// The manifest the site reads (tutorial index, extra docs, live stats) is
// derived from the repository, so it is regenerated on every build. The link
// check then refuses to ship a card, dashboard, or source link that goes
// nowhere, which is exactly what a rename used to leave behind.
execFileSync(process.execPath, [join(root, 'scripts', 'build-manifest.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'scripts', 'check-site-links.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'scripts', 'check-doc-stats.mjs')], { stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(join(root, 'website'), out, {
  recursive: true,
  filter: (src) => !/vercel\.json$|README\.md$/.test(src),
});

// Markdown for the in-site reader (website/app.js fetches /docs/<file>.md and
// /tutorials/<file>.md). Top-level files only: nested folders under docs/ are
// upstream vendor copies that the reader links to on GitHub instead.
function copyMarkdown(dir) {
  const src = join(root, dir);
  const dest = join(out, dir);
  mkdirSync(dest, { recursive: true });

  let count = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      cpSync(join(src, entry.name), join(dest, entry.name));
      count += 1;
    }
  }
  return count;
}

const mdCount =
  copyMarkdown('docs') +
  copyMarkdown('tutorials') +
  copyMarkdown('tutorials/examples');
cpSync(join(root, 'docs', 'assets'), join(out, 'docs', 'assets'), { recursive: true });

mkdirSync(join(out, 'live'), { recursive: true });
for (const f of readdirSync(join(root, 'live'))) {
  if (f.endsWith('.html')) cpSync(join(root, 'live', f), join(out, 'live', f));
}
// The launchpad imports the SDK browser bundle from live/vendor/.
cpSync(join(root, 'live', 'vendor'), join(out, 'live', 'vendor'), { recursive: true });

writeFileSync(
  join(out, '_redirects'),
  [
    '/trades /live/trades 302',
    '/vanity /live/vanity 302',
    '/chart /live/dashboard 302',
    '/launchpad /live/launchpad 302',
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
    '/tutorials/*',
    '  Cache-Control: public, max-age=600',
    '/data/*',
    '  Cache-Control: public, max-age=600',
    '',
  ].join('\n'),
);

const files = readdirSync(out, { recursive: true }).length;
console.log(`dist-site/ assembled (${files} entries, ${mdCount} markdown pages)`);
