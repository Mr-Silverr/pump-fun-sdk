#!/usr/bin/env node
/**
 * Derive website/data/manifest.json from the repository itself.
 *
 * The site reads this file to list tutorials, to surface documentation pages
 * that are not in the curated list in website/app.js, and to show real counts
 * in the home page stats bar. Deriving them means a new tutorial or doc appears
 * on the site the moment it lands, with no second place to update.
 *
 * Run directly (`node scripts/build-manifest.mjs`) or through
 * scripts/build-site.mjs, which always regenerates before assembling.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'website', 'data');
const outFile = join(outDir, 'manifest.json');

const WORDS_PER_MINUTE = 220;

function markdownFiles(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function firstHeading(lines) {
  const line = lines.find((l) => /^#\s+\S/.test(l));
  return line ? line.replace(/^#\s+/, '').replace(/[`*]/g, '').trim() : '';
}

// The summary is the lead blockquote when a file has one (the tutorials all do),
// otherwise the first real paragraph.
function firstSummary(lines) {
  let inFence = false;
  let seenHeading = false;

  for (const line of lines) {
    const text = line.trim();
    if (/^```/.test(text)) inFence = !inFence;
    if (inFence || !text) continue;
    if (/^#\s/.test(text)) {
      seenHeading = true;
      continue;
    }
    if (!seenHeading) continue;
    if (/^>\s?/.test(text)) return clean(text.replace(/^>\s?/, ''));
    if (/^[#\-*|<]/.test(text)) continue;
    return clean(text);
  }
  return '';
}

function clean(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function describe(dir, file) {
  const raw = readFileSync(join(root, dir, file), 'utf8');
  const lines = raw.split('\n');
  const words = raw.trim().split(/\s+/).length;
  const numbered = file.match(/^(\d+)-/);

  return {
    file,
    title: firstHeading(lines) || file.replace(/\.md$/, ''),
    summary: firstSummary(lines),
    words,
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    ...(numbered ? { number: Number(numbered[1]) } : {}),
  };
}

function countMcpTools() {
  const src = readFileSync(join(root, 'mcp-server', 'src', 'tools', 'index.ts'), 'utf8');
  const registry = src.slice(src.indexOf('export const ALL_TOOLS'));
  return (registry.match(/^\s{2}\{\s*$/gm) || []).length;
}

function countPrograms() {
  const src = readFileSync(join(root, 'src', 'programIds.ts'), 'utf8');
  return new Set(src.match(/export const [A-Z_]*PROGRAM_ID\b/g) || []).size;
}

const docs = markdownFiles('docs').map((file) => describe('docs', file));
const tutorials = markdownFiles('tutorials')
  .filter((file) => file !== 'README.md')
  .map((file) => describe('tutorials', file));

const manifest = {
  generatedBy: 'scripts/build-manifest.mjs',
  docs,
  tutorials,
  stats: {
    docs: docs.length,
    tutorials: tutorials.length,
    mcpTools: countMcpTools(),
    programs: countPrograms(),
  },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n');

console.log(
  `website/data/manifest.json: ${docs.length} docs, ${tutorials.length} tutorials, ` +
  `${manifest.stats.mcpTools} MCP tools, ${manifest.stats.programs} programs`,
);
