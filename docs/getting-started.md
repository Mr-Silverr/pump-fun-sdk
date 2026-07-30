# Getting started with pump-fun-sdk

TypeScript SDK for the Pump protocol on Solana — token creation, bonding curves, AMM pools, fee sharing, and volume rewards

## Install

```bash
npm install @nirholas/pump-sdk
```

## Verify the install

Clone the repository and run its checks to confirm everything works on your machine:

```bash
git clone https://github.com/nirholas/pump-fun-sdk.git
cd pump-fun-sdk
```

Available commands:

| Command | Runs |
|---|---|
| `npm run build` | `tsup --clean --dts` |
| `npm run dev` | `tsup --watch` |
| `npm run test` | `jest` |
| `npm run lint` | `eslint --cache --quiet "${@:-.}"` |
| `npm run typecheck` | `tsc --noEmit` |

## Next steps

- [Examples](./examples.md) shows runnable snippets.
- The [README](https://github.com/nirholas/pump-fun-sdk#readme) is the complete reference.
- Found a problem? [Open an issue](https://github.com/nirholas/pump-fun-sdk/issues).
