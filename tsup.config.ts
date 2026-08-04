import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs"],
    outDir: "dist",
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist/esm",
    dts: true,
    clean: false,
    sourcemap: true,
    splitting: false,
  },
  {
    // The `pump` binary. CJS only: a shebang entry has to run under plain
    // `node` on every install, and an ESM bin inside a CJS package resolves
    // inconsistently across Node versions and package managers.
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["cjs"],
    outDir: "dist",
    dts: false,
    clean: false,
    sourcemap: false,
    splitting: false,
    // No `banner` here: src/cli/index.ts already carries the shebang and tsup
    // preserves it. Adding one too emits a second `#!` on line 2, which Node
    // rejects outright as a syntax error.
  },
]);

