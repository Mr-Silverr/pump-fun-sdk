#!/usr/bin/env node
/**
 * Catch counted claims in prose that no longer match the code.
 *
 * "53 tools", "19 tutorials", "43 agents": every one of those was true when it
 * was written and wrong by the time anyone read it. This re-derives each number
 * from its source of truth and fails on any documentation or site copy that
 * still states an old one.
 *
 * Truth comes from:
 *   MCP tools / resources / prompts -> the registries in mcp-server/src
 *   tutorials                       -> tutorials/*.md (numbered files)
 *   DeFi agents                     -> packages/defi-agents/src/*.json
 *   agent languages                 -> locale files for one agent
 *
 * Run: node scripts/check-doc-stats.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function countRegistry(relativePath, exportName) {
  const src = readFileSync(join(root, ...relativePath), 'utf8');
  const registry = src.slice(src.indexOf(`export const ${exportName}`));
  return (registry.match(/^\s{2}\{\s*$/gm) || []).length;
}

const countFiles = (dir, test) => readdirSync(join(root, dir)).filter(test).length;

const agentsDir = join('packages', 'defi-agents');
const truth = {
  mcpTools: countRegistry(['mcp-server', 'src', 'tools', 'index.ts'], 'ALL_TOOLS'),
  tutorials: countFiles('tutorials', (f) => /^\d+-.*\.md$/.test(f)),
  skills: existsSync(join(root, 'skills'))
    ? readdirSync(join(root, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).length
    : null,
  agents: existsSync(join(root, agentsDir, 'src'))
    ? countFiles(join(agentsDir, 'src'), (f) => f.endsWith('.json'))
    : null,
  languages: existsSync(join(root, agentsDir, 'locales'))
    ? (() => {
      const first = readdirSync(join(root, agentsDir, 'locales'))[0];
      return countFiles(join(agentsDir, 'locales', first), (f) => f.endsWith('.json'));
    })()
    : null,
};

// Each rule only fires on a line that is talking about the thing it counts, so
// unrelated numbers ("10 commands", "18 languages" in another context) are left
// alone.
const RULES = [
  { key: 'mcpTools', context: /\bmcp\b|model context protocol/i, pattern: /\b(\d+)\+?\s+(?:ai\s+)?tools\b/gi, what: 'MCP tools' },
  { key: 'tutorials', context: /tutorial/i, pattern: /\b(\d+)\+?\s+tutorials\b/gi, what: 'tutorials' },
  { key: 'agents', context: /agent/i, pattern: /\b(\d+)\+?\s+(?:defi\s+|production-ready\s+|ai\s+)?agents\b(?!\s+(?:skill|definition|manifest))/gi, what: 'DeFi agents' },
  { key: 'skills', context: /skill/i, pattern: /\b(\d+)\+?\s+(?:agent\s+)?skills?\b/gi, what: 'agent skills' },
  { key: 'languages', context: /agent|i18n|translat/i, pattern: /\b(\d+)\+?\s+languages\b/gi, what: 'agent languages' },
];

const TARGETS = [
  ...readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => join('docs', f)),
  ...readdirSync(join(root, 'tutorials')).filter((f) => f.endsWith('.md')).map((f) => join('tutorials', f)),
  join('website', 'index.html'),
  'README.md',
];

// Upstream mirrors kept verbatim in docs/ are not ours to edit.
const SKIP = new Set([join('docs', 'solanaappkit.md'), join('docs', 'solana-official-llms.txt.md')]);

const problems = [];
for (const target of TARGETS) {
  if (SKIP.has(target)) continue;

  const lines = readFileSync(join(root, target), 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Arrow lines are flow diagrams listing tutorial numbers, not counts.
    if (/(→|->)/.test(line)) return;

    for (const rule of RULES) {
      const expected = truth[rule.key];
      if (expected === null || !rule.context.test(line)) continue;

      for (const match of line.matchAll(rule.pattern)) {
        const stated = Number(match[1]);
        // "one of 8 fee recipients" style ranges are not counts of our things;
        // only flag a number that reads as a total and disagrees.
        if (stated !== expected) {
          problems.push(`${target}:${i + 1} claims ${stated} ${rule.what}, the repository has ${expected}\n      ${line.trim().slice(0, 120)}`);
        }
      }
    }
  });
}

if (problems.length) {
  console.error(`Documentation stats check failed (${problems.length} stale claim${problems.length === 1 ? '' : 's'}):`);
  problems.forEach((p) => console.error(`  - ${p}`));
  console.error('\nUpdate the prose, or if the number is deliberately historical, reword it so it does not read as a current count.');
  process.exit(1);
}

console.log(
  `Documentation stats check passed: ${truth.mcpTools} MCP tools, ${truth.tutorials} tutorials, ` +
  `${truth.agents} agents, ${truth.skills} skills, ${truth.languages} languages stated consistently.`,
);
