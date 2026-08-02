#!/usr/bin/env node
/**
 * Run a numbered example: `npm run example 07` or `npm run example 07-sell-all`.
 *
 * Resolves the examples/NN-*.ts file for the given number (or exact name)
 * and executes it with tsx, which honors the path mapping in
 * examples/tsconfig.json so `@nirholas/pump-sdk` resolves to src/.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'examples');

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run example <number|name>   e.g. npm run example 07');
  const files = readdirSync(dir).filter((f) => /^\d{2}-.*\.ts$/.test(f)).sort();
  for (const f of files) console.error(`  ${f.replace(/\.ts$/, '')}`);
  process.exit(1);
}

const wanted = /^\d+$/.test(arg) ? arg.padStart(2, '0') + '-' : arg;
const files = readdirSync(dir).filter((f) => /\.ts$/.test(f));
const match =
  files.find((f) => f === `${arg}.ts`) ??
  files.find((f) => f.startsWith(wanted));

if (!match) {
  console.error(`No example matching "${arg}" in examples/`);
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['tsx', '--tsconfig', join(dir, 'tsconfig.json'), join(dir, match)],
  { stdio: 'inherit', cwd: root },
);
process.exit(result.status ?? 1);
