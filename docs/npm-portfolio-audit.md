# npm Portfolio Audit

> Every package published under the `nirholas` npm account, ranked by monthly
> downloads, with the vulnerable dependency pins each one carries.

**Audited 2026-08-04.** 57 packages, 9,526 downloads per month.
28 packages (5,849 downloads/mo, 61% of all traffic)
declare a dependency range whose floor version carries a known advisory.

## Method

Package list from the npm registry search API, latest manifest per package,
then every dependency range's floor version checked against the OSV database
(`api.osv.dev/v1/querybatch`). The floor is what matters: a `^1.0.0` range
permits a resolver to land on `1.0.0`, so a vulnerable floor is reachable by
any fresh install without a lockfile. Regenerate with `node scripts/audit-npm-portfolio.mjs`; the raw data lives in
[`npm-portfolio-audit.json`](npm-portfolio-audit.json).

## Ranked

| Downloads/mo | Vulnerable pins | Package | Published |
|---|---|---|---|
| 2,008 | **2** | `xactions@3.4.8` | 2026-08-04 |
| 1,464 | **1** | `@nirholas/pump-sdk@1.35.0` | 2026-08-04 |
| 378 | 0 | `pumpfun-claims-bot@1.0.3` | 2026-08-04 |
| 376 | **3** | `pump-fun-mcp@1.0.1` | 2026-08-02 |
| 324 | 0 | `xactions-mcp@3.4.7` | 2026-08-04 |
| 284 | 0 | `data-workbench-mcp@0.1.2` | 2026-08-04 |
| 265 | 0 | `hood-tokenlist@0.1.1` | 2026-08-02 |
| 233 | **2** | `@nirholas/awesome-openrouter@1.0.1` | 2026-08-02 |
| 227 | 0 | `@nirholas/lyra-tool-discovery@0.1.3` | 2026-08-04 |
| 215 | **1** | `@nirholas/binance-us-mcp-server@1.0.3` | 2026-08-02 |
| 196 | 0 | `gitglow@1.0.3` | 2026-08-02 |
| 193 | **4** | `@nirholas/x402-deploy@0.1.2` | 2026-08-04 |
| 193 | **1** | `@nirholas/free-crypto-news-mcp@1.0.4` | 2026-08-02 |
| 191 | **8** | `free-crypto-news@1.0.7` | 2026-03-07 |
| 184 | **2** | `@nirholas/binance-mcp-server@1.0.2` | 2026-03-07 |
| 180 | **2** | `@nirholas/lyra-registry@1.0.1` | 2026-08-02 |
| 179 | 0 | `lyra-registry@1.0.4` | 2026-08-04 |
| 177 | 0 | `@nirholas/openbare@1.0.1` | 2026-08-02 |
| 169 | 0 | `@nirholas/solana-wallet-toolkit@1.0.2` | 2026-08-04 |
| 159 | 0 | `@nirholas/erc-8004-contracts@1.0.2` | 2026-08-04 |
| 156 | **2** | `@nirholas/extract-llms-docs@1.0.2` | 2026-08-04 |
| 155 | 0 | `@nirholas/registry@0.0.2` | 2026-08-02 |
| 151 | 0 | `t4g@0.0.4` | 2026-08-02 |
| 148 | 0 | `@nirholas/web3auth-examples@1.0.2` | 2026-08-04 |
| 139 | 0 | `@nirholas/g1t@0.0.2` | 2026-08-02 |
| 136 | 0 | `e7c@0.0.4` | 2026-08-02 |
| 131 | 0 | `g1t@0.0.3` | 2026-08-02 |
| 130 | 0 | `github-to-mcp-monorepo@1.0.1` | 2026-03-07 |
| 111 | 0 | `robinhood-volume-alerts@0.2.1` | 2026-08-04 |
| 87 | **2** | `llms-forge@1.0.3` | 2026-08-04 |
| 64 | **7** | `@nirholas/universal-crypto-mcp@1.0.0` | 2026-03-08 |
| 57 | **2** | `@nirholas/bnbchain-mcp@1.0.2` | 2026-08-04 |
| 49 | 0 | `@nirholas/ai-agents-library@1.42.2` | 2026-03-07 |
| 37 | **2** | `@nirholas/binance-mcp@1.0.0` | 2026-03-08 |
| 29 | 0 | `@nirholas/servers@0.6.2` | 2026-03-08 |
| 26 | **3** | `@nirholas/look@2.1.1` | 2026-08-04 |
| 22 | **4** | `@nirholas/crypto-data-aggregator@1.0.0` | 2026-03-08 |
| 22 | 0 | `@nirholas/crypto-market-data@1.0.0` | 2026-03-08 |
| 22 | 0 | `@nirholas/github-to-mcp@1.0.0` | 2026-03-08 |
| 21 | **1** | `@nirholas/binance-us-mcp@1.0.0` | 2026-03-08 |
| 20 | **3** | `@nirholas/agenti@0.1.0` | 2026-03-08 |
| 18 | **1** | `lyra-web3-playground@0.1.2` | 2026-03-07 |
| 18 | **1** | `@nirholas/pump-swap-sdk@1.14.0` | 2026-03-08 |
| 17 | **6** | `@nirholas/crypto-vision@0.1.0` | 2026-03-08 |
| 17 | **2** | `@nirholas/bnbchain-mcp-pr@0.0.1` | 2026-03-08 |
| 15 | 0 | `@nirholas/crypto-news@1.0.1` | 2026-03-07 |
| 15 | 0 | `@nirholas/subgraph@1.0.0` | 2026-03-08 |
| 15 | 0 | `@nirholas/auditkit@0.1.0` | 2026-03-08 |
| 14 | **1** | `@nirholas/lyra-web3-playground@0.1.0` | 2026-03-08 |
| 14 | 0 | `@nirholas/crypto-market-data-ts@1.0.0` | 2026-03-08 |
| 13 | **11** | `@nirholas/clawdbot@2026.2.1` | 2026-03-08 |
| 13 | **3** | `@nirholas/erc-8004-demo-agent@1.0.0` | 2026-03-08 |
| 13 | 0 | `@nirholas/defi-agents@1.42.3` | 2026-03-08 |
| 12 | **1** | `@nirholas/bnb-chain-toolkit@2.0.0` | 2026-03-08 |
| 12 | 0 | `@nirholas/boosty@1.0.1` | 2026-08-04 |
| 12 | 0 | `@nirholas/plugin.delivery@1.0.1` | 2026-08-04 |
| 0 | **2** | `works-with-openrouter@1.0.2` | 2026-08-04 |

## Most recurring advisories

| Packages affected | Dependency | Advisory | Fixed in |
|---|---|---|---|
| 11 | `@modelcontextprotocol/sdk` | GHSA-w48q-cv73-mx4w (DNS rebinding, HIGH) | 1.24.0 |
| 8 | `@modelcontextprotocol/sdk` | GHSA-345p-7cg4-v4c7 | see advisory |
| 7 | `@modelcontextprotocol/sdk` | GHSA-8r9q-7v3j-jr4g | see advisory |
| 6 | `express` | GHSA-qw6h-vgh9-j6wx | see advisory |
| 6 | `express` | GHSA-rv95-896h-c2vc | see advisory |
| 4 | `js-yaml` | GHSA-52cp-r559-cp3m | see advisory |
| 4 | `ws` | GHSA-58qx-3vcg-4xpx | see advisory |

The MCP SDK dominates: eleven packages pin `@modelcontextprotocol/sdk` at a
floor below 1.24.0, which is the DNS-rebinding fix. Raising that one floor
across the fleet clears the largest share of the exposure.

## Fixed in this repository

| Package | Was | Now | Advisories cleared |
|---|---|---|---|
| `@nirholas/pump-sdk` | 1.35.0 | 1.35.1 | `bn.js` floor raised to 5.2.3 (GHSA-378v-28hj-76wf) |
| `pump-fun-mcp` | 1.0.1 | 1.1.1 | `@modelcontextprotocol/sdk` to ^1.24.0, `zod` to ^3.22.3, `bn.js` to ^5.2.3, `uuid` override for GHSA-w5hq-g745-h8pq |

## Known unfixable

`bigint-buffer` (GHSA-3gc7-fjrx-p6mg) reaches every Solana package through
`@solana/spl-token`. The only version npm offers as a fix is `@solana/spl-token@0.1.8`,
a 2021 release that predates the token program this SDK targets. No package
in the Solana ecosystem ships that downgrade, and neither do we.

## Packages owned elsewhere

Most of the list is published from repositories other than this one. The
ranking above is the work queue for those: start at the top, raise the
floors named in the recurring-advisories table, republish.
