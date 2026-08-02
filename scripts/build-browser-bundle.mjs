#!/usr/bin/env node
/**
 * Build the browser ESM bundle of the Pump SDK.
 *
 * Run with: node scripts/build-browser-bundle.mjs
 * (also wired as: npm run build:bundle)
 *
 * Bundles src/index.ts (the full SDK surface, including @solana/web3.js,
 * @coral-xyz/anchor, bn.js and @solana/spl-token) into a single minified
 * ES module that loads directly in a browser via:
 *
 *   import { PUMP_SDK, OnlinePumpSdk } from "./vendor/pump-sdk.browser.mjs";
 *
 * Output is emitted to BOTH locations so every serving layout resolves it:
 *   website/vendor/pump-sdk.browser.mjs  (dist-site copies website/ -> /vendor/)
 *   live/vendor/pump-sdk.browser.mjs     (repo-root static serve: /live/vendor/)
 *
 * Browser shims:
 *   - Buffer: the `buffer` npm package (feross/buffer) is injected wherever the
 *     bundled code references the free variable `Buffer` (anchor's borsh coder
 *     and web3.js serialization depend on it).
 *   - process: a tiny inline shim providing env/browser/version/nextTick, which
 *     is all anchor and web3.js touch at runtime in the browser.
 *   - global: defined to globalThis.
 *
 * On top of the SDK surface, the bundle re-exports the Solana primitives a
 * browser page needs to actually use the SDK (PublicKey, Keypair, Connection,
 * Transaction, BN, token program ids, Buffer), so a live page needs exactly
 * one import.
 */
import { build } from "esbuild";
import { mkdirSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shimDir = join(root, "node_modules", ".pump-browser-shims");
mkdirSync(shimDir, { recursive: true });

// Inject file: esbuild rewrites free references to `Buffer` and `process`
// across the whole bundle into imports of these named exports.
const shimPath = join(shimDir, "shims.mjs");
writeFileSync(
  shimPath,
  [
    'import { Buffer } from "buffer";',
    "export { Buffer };",
    "export const process = {",
    '  env: { NODE_ENV: "production" },',
    "  browser: true,",
    '  version: "v18.0.0",',
    "  nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),",
    "};",
    "",
  ].join("\n"),
);

// Bundle entry: the full SDK surface plus the web3 primitives browser pages
// need (constructing PublicKeys, keypairs, transactions, BN amounts).
const entryPath = join(shimDir, "entry.ts");
writeFileSync(
  entryPath,
  [
    'export * from "../../src/index";',
    "export {",
    "  PublicKey,",
    "  Keypair,",
    "  Connection,",
    "  Transaction,",
    "  VersionedTransaction,",
    "  TransactionMessage,",
    "  TransactionInstruction,",
    "  SystemProgram,",
    "  ComputeBudgetProgram,",
    "  LAMPORTS_PER_SOL,",
    '} from "@solana/web3.js";',
    'export { default as BN } from "bn.js";',
    "export {",
    "  TOKEN_PROGRAM_ID,",
    "  TOKEN_2022_PROGRAM_ID,",
    "  getAssociatedTokenAddressSync,",
    '} from "@solana/spl-token";',
    'export { Buffer } from "buffer";',
    "",
  ].join("\n"),
);

const outWebsite = join(root, "website", "vendor", "pump-sdk.browser.mjs");
const outLive = join(root, "live", "vendor", "pump-sdk.browser.mjs");
mkdirSync(dirname(outWebsite), { recursive: true });
mkdirSync(dirname(outLive), { recursive: true });

const result = await build({
  entryPoints: [entryPath],
  outfile: outWebsite,
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  mainFields: ["browser", "module", "main"],
  conditions: ["browser"],
  define: {
    global: "globalThis",
    "process.env.NODE_ENV": '"production"',
  },
  inject: [shimPath],
  logLevel: "info",
  metafile: true,
});

copyFileSync(outWebsite, outLive);

const bytes = statSync(outWebsite).size;
const kib = (bytes / 1024).toFixed(1);
console.log(`pump-sdk.browser.mjs: ${kib} KiB (${bytes} bytes)`);
console.log(`  -> ${outWebsite}`);
console.log(`  -> ${outLive}`);

// Fail loudly if esbuild reported anything.
if (result.errors.length > 0) process.exit(1);
