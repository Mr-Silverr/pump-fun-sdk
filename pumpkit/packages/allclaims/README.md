# @pumpkit/allclaims

> Telegram channel feed that broadcasts **every** PumpFun fee claim, not just first claims.

This is the firehose sibling of [`@pumpkit/channel`](../channel/). Where the channel bot posts a curated signal (a developer's *first* GitHub fee claim on a token), this bot reports the whole claim stream: creator fees, AMM creator fees, fee distributions, social fee PDA claims, and optionally cashback.

Because the whole stream is far more traffic than a Telegram channel can accept, the bot never simply relays it. Large claims post individually; everything else is batched into a periodic digest. Delivery stays inside the rate limit no matter how busy the chain gets.

**This is a separate bot, a separate token, and a separate channel from the first-claims feed.** It does not read, write, or share state with `channel-bot`, so running it cannot affect [@pumpfunclaims](https://t.me/pumpfunclaims).

---

## How claims are routed

Every detected claim takes exactly one of three routes:

| Route | Condition | Delivery |
|-------|-----------|----------|
| **Instant** | USD value ≥ `INSTANT_THRESHOLD_USD` and post budget available | Its own message, immediately |
| **Digest** | Anything else at or above `MIN_CLAIM_USD` | Batched into the next digest |
| **Dropped** | Below `MIN_CLAIM_USD` | Counted, and the count is disclosed in the digest |

Nothing is silently discarded. A claim is always posted, digested, or counted, and the digest footer states how many dust claims were filtered.

### Flood control

Telegram accepts roughly 20 posts/min to a channel. `MAX_POSTS_PER_MINUTE` (default 15) is enforced with a sliding-window budget:

- One budget slot is always held in reserve for the digest, so a burst of large claims can never starve it.
- When the budget runs out, instant claims **demote into the digest** rather than being dropped.
- If a digest itself cannot post, its claims **roll into the next window** instead of being lost.

Measured on mainnet, claim volume runs roughly 8-25 claims per 150s (~3-10/min). The digest is what makes that deliverable.

---

## Quick start

```bash
cd packages/allclaims
cp .env.example .env
# Edit .env: TELEGRAM_BOT_TOKEN, CHANNEL_ID, SOLANA_RPC_URL, SOLANA_WS_URL
npm install
npm run dev
```

Then:

1. Create a **new** bot with [@BotFather](https://t.me/BotFather). Do not reuse the first-claims bot token.
2. Create your channel, add the bot as an administrator with permission to post.
3. Set `CHANNEL_ID` to `@your_channel` or the numeric `-100…` chat ID.

### A WebSocket RPC is effectively required

Set `SOLANA_WS_URL`. The bot works without one, but polling mode samples only the 20 most recent signatures per program per tick, and on a chain doing thousands of transactions per minute it **will** miss most claims. The bot logs a loud warning when it falls back to polling.

Verified working free endpoint used during development:

```bash
SOLANA_RPC_URL=https://rpc.magicblock.app/mainnet
SOLANA_WS_URL=wss://rpc.magicblock.app/mainnet
```

A paid RPC (Helius, QuickNode, Triton) is recommended for production. Note that Helius's free tier refuses WebSocket upgrades with HTTP 429.

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Bot token from @BotFather (its own bot) |
| `CHANNEL_ID` | ✅ | — | Channel to post to (`@name` or `-100…`) |
| `SOLANA_RPC_URL` | ⬜ | `api.mainnet-beta.solana.com` | Primary RPC HTTP endpoint |
| `SOLANA_RPC_URLS` | ⬜ | — | Comma-separated fallback RPCs |
| `SOLANA_WS_URL` | ⬜ | Derived from RPC URL | WebSocket endpoint. Strongly recommended |
| `INSTANT_THRESHOLD_USD` | ⬜ | `100` | Claims at or above this post individually |
| `MIN_CLAIM_USD` | ⬜ | `0` | Claims below this are counted but not shown |
| `DIGEST_INTERVAL_SECONDS` | ⬜ | `60` | Seconds between digest posts |
| `DIGEST_MAX_LINES` | ⬜ | `12` | Claims listed per digest; the rest are summarized |
| `MAX_POSTS_PER_MINUTE` | ⬜ | `15` | Telegram post budget (max 19) |
| `INCLUDE_CASHBACK` | ⬜ | `false` | Include cashback (user refunds, not creator activity) |
| `INCLUDE_DISTRIBUTIONS` | ⬜ | `true` | Include `distribute_creator_fees` payouts |
| `POLL_INTERVAL_SECONDS` | ⬜ | `30` | Polling interval when no WebSocket is available |
| `LOG_LEVEL` | ⬜ | `info` | `debug` \| `info` \| `warn` \| `error` |
| `PORT` | ⬜ | `3000` | HTTP API port |

Invalid numeric values fail at startup with a named error rather than silently falling back to a default.

---

## Message formats

**Instant** (one claim, one post):

```
💸 FEE CLAIM · fee distribution

🪙 RETURN TO TRADITION $RTT
💰 1.25 SOL ($89)
💎 Mcap: $17.9k
👤 3Dnx…svaB

🔗 TX · Pump
```

**Digest** (one window, one post):

```
🧾 CLAIMS DIGEST · last 1m · 11 claims · $420 total

• $5.54 · wallet · creator fee · tx
• $2.09 · wallet · creator fee · tx
• $2.09 · wallet · creator fee (AMM) · tx
… +6 more ($34.86)
```

USDC-quoted claims (PumpFun V2, rolled out 2026-05-21) render in USDC without a redundant USD conversion. SOL-quoted claims convert at spot from Jupiter, falling back to CoinGecko then Binance.

---

## HTTP API

The bot serves a read-only JSON API on `PORT` alongside the Telegram feed:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness probe with uptime and counters |
| `GET /stats` | Pipeline counters, transport mode, dispatcher state |
| `GET /events/recent?limit=50` | Ring buffer of recent claims |
| `GET /events/stream` | Live Server-Sent Events stream |

```bash
curl localhost:3000/stats
```

Each recorded event carries the route it took (`instant`, `digest`), its USD value, claim type, and transaction signature, so the API is a complete record even for claims that were only digested.

---

## Claim types

| Type | Program | Meaning |
|------|---------|---------|
| `collect_creator_fee` | Pump | Creator collecting bonding-curve fees |
| `collect_coin_creator_fee` | PumpAMM | Creator collecting post-graduation AMM fees |
| `distribute_creator_fees` | Pump | Payout split across fee shareholders |
| `transfer_creator_fees_to_pump` | PumpAMM | Fees routed back to the Pump program |
| `claim_social_fee_pda` | PumpFees | GitHub-assigned developer claiming social fees |
| `claim_cashback` | Pump / PumpAMM | User refund. Excluded by default |

Both V1 and V2 instruction discriminators are matched, and V2's trailing `quote_mint` field is decoded so USDC-paired coins report the correct currency.

---

## Detection

Claims are found by subscribing to program logs for the Pump, PumpAMM, and PumpFees programs, then fetching only the transactions that look like claims.

That filter is the load-bearing part, and it needs both of its paths:

- **Anchor instruction log lines** catch `claim_social_fee_pda`, which emits no CPI event at all on a fake claim. The log line is the only trace it leaves.
- **Event discriminators** on `Program data:` lines catch creator fee claims, which emit events but carry no social instruction log.

A filter keyed only on the social instruction discards every pure creator-fee claim before it is ever fetched, which is the entire product for this bot. `classifyClaimLogs()` is exported and covered by tests for exactly this reason.

Cashback is classified separately so that refund transactions, the highest-volume claim type on chain, are not fetched when the feed excludes them. Fetching them saturates the RPC queue and starves real creator claims. When the queue does overflow, the drop count is reported in the heartbeat log and in `/stats` rather than being swallowed.

---

## Development

```bash
npm run dev        # hot reload
npm test           # 36 tests: dispatcher routing, formatters, log classification
npm run typecheck
npm run build && npm start
```

## Deploy

A `Dockerfile` and `railway.json` are included:

```bash
docker build -t pumpkit-allclaims .
docker run --env-file .env -p 3000:3000 pumpkit-allclaims
```

## Related

- [`@pumpkit/channel`](../channel/) — first-claims-only curated feed
- [`@pumpkit/claim`](../claim/) — interactive DM bot for tracking specific tokens
- [`@pumpkit/core`](../core/) — shared framework
