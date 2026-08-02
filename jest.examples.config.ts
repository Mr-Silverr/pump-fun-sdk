import type { Config } from "jest";

/**
 * Jest project for the runnable examples in examples/.
 *
 * Kept separate from jest.config.ts so `npm test` (SDK unit suite with
 * coverage thresholds) stays fast and offline, while
 * `npm run test:examples` exercises every example's exported logic.
 *
 * The `@nirholas/pump-sdk` import in every example resolves to the local
 * src/ tree here, so the examples always test the code in this repo, not
 * the last published package.
 */
const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/examples"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  moduleNameMapper: {
    "^@nirholas/pump-sdk$": "<rootDir>/src/index.ts",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "examples/tsconfig.json",
      },
    ],
  },
};

export default config;
