#!/usr/bin/env node
/**
 * Audit every package published under the nirholas npm account.
 *
 * For each package: read its latest manifest from the registry, take the
 * floor version of every dependency range, and check those pins against the
 * OSV database. The floor is the interesting version: a `^1.0.0` range lets a
 * resolver land on `1.0.0`, so a vulnerable floor is reachable by any fresh
 * install without a lockfile.
 *
 * Writes docs/npm-portfolio-audit.md and prints the ranked summary.
 *
 *   node scripts/audit-npm-portfolio.mjs
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAINTAINER = process.env.NPM_MAINTAINER ?? 'nirholas';

const search = await fetch(
  `https://registry.npmjs.org/-/v1/search?text=maintainer:${MAINTAINER}&size=250`,
);
const names = ((await search.json()).objects ?? []).map((o) => o.package.name);

const pkgs = [];
for (const name of names) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
  if (!res.ok) continue;
  const doc = await res.json();
  const latest = doc['dist-tags']?.latest;
  const manifest = doc.versions?.[latest];
  if (!manifest) continue;
  pkgs.push({
    name,
    version: latest,
    modified: (doc.time?.[latest] ?? '').slice(0, 10),
    deps: manifest.dependencies ?? {},
  });
}

const floorOf = (range) =>
  (String(range).match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/) || [])[1] ?? null;

const queries = [];
const index = [];
for (const pkg of pkgs) {
  for (const [dep, range] of Object.entries(pkg.deps)) {
    const version = floorOf(range);
    if (!version) continue;
    queries.push({ package: { name: dep, ecosystem: 'npm' }, version });
    index.push({ pkg: pkg.name, dep, version });
  }
}

const findings = new Map();
for (let i = 0; i < queries.length; i += 200) {
  const res = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queries: queries.slice(i, i + 200) }),
  });
  const data = await res.json();
  (data.results ?? []).forEach((result, offset) => {
    if (!(result.vulns ?? []).length) return;
    const meta = index[i + offset];
    if (!findings.has(meta.pkg)) findings.set(meta.pkg, []);
    findings.get(meta.pkg).push({
      dep: meta.dep,
      version: meta.version,
      vulns: result.vulns.map((v) => v.id),
    });
  });
}

// Download counts rank the work queue. The bulk endpoint takes unscoped names
// in one call; scoped names are fetched individually and paced, because the
// downloads API rate-limits hard enough to return zeros for everything.
const downloads = new Map();
const unscoped = pkgs.filter((p) => !p.name.startsWith('@')).map((p) => p.name);
if (unscoped.length) {
  const res = await fetch(
    `https://api.npmjs.org/downloads/point/last-month/${unscoped.join(',')}`,
  );
  if (res.ok) {
    for (const [name, value] of Object.entries(await res.json())) {
      downloads.set(name, value?.downloads ?? 0);
    }
  }
}
for (const pkg of pkgs.filter((p) => p.name.startsWith('@'))) {
  const res = await fetch(
    `https://api.npmjs.org/downloads/point/last-month/${pkg.name}`,
  );
  if (res.ok) downloads.set(pkg.name, (await res.json()).downloads ?? 0);
  await new Promise((resolve) => setTimeout(resolve, 900));
}

const report = pkgs
  .map((p) => ({
    name: p.name,
    version: p.version,
    modified: p.modified,
    downloads: downloads.get(p.name) ?? null,
    vulnDeps: findings.get(p.name) ?? [],
  }))
  .sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1));

const total = report.reduce((sum, p) => sum + (p.downloads ?? 0), 0);
const affected = report.filter((p) => p.vulnDeps.length);
console.log(`${report.length} packages, ${total.toLocaleString()} downloads/mo`);
console.log(`${affected.length} with vulnerable dependency pins\n`);
for (const p of affected) {
  console.log(
    `${String(p.downloads ?? 'n/a').padStart(6)} dl  ${String(p.vulnDeps.length).padStart(2)} pins  ${p.name}@${p.version}`,
  );
}

writeFileSync(
  join(root, 'docs', 'npm-portfolio-audit.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log('\nwrote docs/npm-portfolio-audit.json');
