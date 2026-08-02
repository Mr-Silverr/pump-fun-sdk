# PumpFun Claim Bot

Interactive Telegram bot that monitors PumpFun fee claims and notifies you instantly. Track tokens by contract address or X accounts by handle, similar to [Bags.fm Fee Tracker](https://bags.fm).

Runs as [@pfclaimsbot](https://t.me/pfclaimsbot).

## Features

- **Token tracking** by contract address, matched through the token's creator wallet so wallet-level claims still land
- **Wallet tracking**: every claim an address signs or receives. `/add` tells a mint from a wallet for you
- **X account tracking** by handle, resolved from the coins the claiming wallet created
- **Alert settings per chat**: a minimum claim size, a USD whale threshold, and a mute switch that keeps your tracked items
- **Whale alerts**: any claim over a USD value, tracked or not, priced from a live SOL feed
- **Rate-limit safe delivery**: bursts collapse into one digest instead of tripping Telegram's per-chat limit
- **Claim history and leaderboard**: `/history` for anything you track, `/top` for the biggest claimers on PumpFun
- **Inline buttons** on every alert: transaction, wallet, coin, trading venues (Axiom, GMGN, Padre, FOMO), history, and one-tap untrack
- **Real-time WebSocket monitoring** of the Pump, PumpSwap, and PumpFees programs, with automatic reconnect and an HTTP polling fallback
- **RPC failover** across every endpoint in `SOLANA_RPC_URLS`, rotating after repeated failures
- **JSON API** for the same data the bot posts: `/claims`, `/top`, `/health`
- **Twitter follower tracking** (optional): follower counts and influencer follows for tracked X accounts

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and quick start guide |
| `/add <token CA>` | Track a token by contract address |
| `/add <wallet>` | Track every claim a wallet signs or receives |
| `/add @handle` | Track an X (Twitter) account |
| `/remove <CA, wallet or @handle>` | Stop tracking an item |
| `/list` | View all tracked items, with one-tap untrack buttons |
| `/history [CA, wallet or @handle]` | Recent claims for one item, or across everything you track |
| `/top [hours]` | Biggest claimers in a window, default 24h, max 168h |
| `/settings` | Show this chat's alert settings |
| `/minsol <amount>` | Skip claims below this size |
| `/whale <usd\|off>` | Alert on any claim over this USD value, tracked or not |
| `/mute`, `/unmute` | Pause and resume alerts without losing tracked items |
| `/status` | Monitor status and stats |
| `/help` | Full command list |

`/add` decides what you gave it by asking the PumpFun API: a known mint is tracked as a token, anything else as a wallet.

### Alert filtering

`/minsol` is compared in each claim's own currency, so `/minsol 0.5` means 0.5 SOL on a SOL-quoted claim and 0.5 USDC on a USDC-quoted one. Converting between them would need a live price feed, and a stale rate would silently drop alerts you asked for.

`/whale` works on a single USD scale instead, since its whole point is comparing claims across coins. SOL is priced from PumpFun's own price endpoint with Coinbase spot as failover; when neither answers, USD figures are omitted and whale alerts hold rather than firing on a guessed number.

Muting and thresholds only affect delivery. Claim history still records everything, so `/history` and `/top` stay complete while a chat is muted.

In group chats, `/add`, `/remove`, `/minsol`, `/whale`, `/mute`, `/unmute` and the untrack buttons are limited to admins, because they change what everyone in the group receives. Read-only commands stay open to all members.

### Delivery under load

Telegram accepts roughly 20 messages per minute to a chat, and exceeding it earns a 429 that applies to everything the bot sends. Each chat has a rolling budget: inside it, alerts go out one by one; past it, they collapse into a single digest that goes out when the window reopens. Nothing is dropped, and a 429 pauses only the chat that caused it, for exactly the `retry_after` Telegram asked for.

## Quick Start

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

3. Install dependencies and run:

```bash
npm install
npm run dev
```

The only value you have to supply is `TELEGRAM_BOT_TOKEN`. The RPC defaults work with no key and no account.

### Verify the chain monitor without a bot token

```bash
npm run dryrun               # 120 seconds against live mainnet, then a summary
DRYRUN_SECONDS=300 npm run dryrun
```

The dry run subscribes to the real programs, prints every claim it detects, and exits non-zero if it detected none. Use it to check a new RPC lane before trusting it: a lane that accepts the `wss://` connection but never delivers `logsSubscribe` notifications looks identical to a healthy one in the logs.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | yes | none | Bot token from @BotFather |
| `SOLANA_RPC_URL` | no | `https://rpc.magicblock.app/mainnet` | Primary Solana RPC endpoint |
| `SOLANA_WS_URL` | no | derived from `SOLANA_RPC_URL` | WebSocket endpoint for real-time monitoring |
| `SOLANA_RPC_URLS` | no | mainnet-beta, publicnode | Comma-separated extra endpoints for failover |
| `POLL_INTERVAL_SECONDS` | no | `15` | Polling interval, used only when WebSocket is unavailable |
| `DRYRUN_SECONDS` | no | `120` | How long `npm run dryrun` monitors before summarizing |
| `LOG_LEVEL` | no | `info` | `debug` \| `info` \| `warn` \| `error` |
| `TWITTER_BEARER_TOKEN` | no | none | Twitter API v2 bearer token for follower tracking |
| `TWITTER_INFLUENCER_IDS` | no | none | Comma-separated influencer user IDs to check for follows |
| `DATA_DIR` | no | `./data` | Where the tracking store is persisted |
| `STATE_BUCKET` | on Cloud Run | none | Cloud Storage bucket the state files are mirrored to. Unset means local disk only |
| `STATE_PREFIX` | no | `claim-bot/` | Object prefix inside the bucket, so one bucket can hold several bots |
| `AXIOM_REF` | no | `nich` | Axiom referral code used in alert links. Empty string drops the venue |
| `GMGN_REF` | no | `nichxbt` | GMGN referral code |
| `PADRE_REF` | no | `nichxbt` | Padre referral code |
| `FOMO_REF` | no | `nichxbt` | FOMO referral code (fomo.family) |

> **WebSocket is not optional in practice.** Polling asks for the 20 most recent signatures per program per tick. The Pump programs do thousands of transactions per minute, so polling mode will miss most claims. The bot logs a loud warning whenever it falls back to it.
>
> Free lanes verified to serve both HTTP and `logsSubscribe`: `rpc.magicblock.app/mainnet` (the default) and `api.mainnet-beta.solana.com` (heavily rate limited). `solana-rpc.publicnode.com` serves HTTP but its WebSocket does not deliver log notifications, so it is a fallback only.

### Twitter Follower Tracking (Optional)

To enable Twitter follower counts and influencer follow tracking:

1. Get a Twitter API v2 bearer token from [Twitter Developer Portal](https://developer.twitter.com/)
2. Set `TWITTER_BEARER_TOKEN` in your `.env` file
3. (Optional) Set `TWITTER_INFLUENCER_IDS` to a comma-separated list of Twitter user IDs to check for follows

When enabled, claim notifications will show:
- **Follower count** for the token creator's X account (formatted as 1.2K, 3.4M, etc.)
- **Influencer follows** if any tracked influencer follows the creator

Example notification with Twitter data:
```
🏦 Creator Fee Claim Detected!

👤 Claimer: abc123...xyz
💰 Amount: 2.5000 SOL
Token: PUMP (PumpToken) · $127.5K mcap
🐦 X Account: @creator · 12.3K followers · ⭐ Followed by 2 tracked influencer(s)
⚙️ Program: Pump
```

## How It Works

1. **On-chain monitoring.** Subscribes to logs for Pump (`6EF8r...`), PumpSwap AMM (`pAMMB...`), and PumpFees (`pfeeU...`).
2. **Log classification.** A signature is fetched when its logs carry a claim instruction line (`Instruction: CollectCreatorFee`, `ClaimSocialFeePda`, and friends) or a claim event discriminator on a `Program data:` line. Both paths are required: social claims can emit no event at all, and creator fee claims carry no social instruction line. Cashback is classified separately and skipped, because it is a trader refund that can never match a tracked token and it outnumbers every real claim.
3. **Event decoding.** Amounts, mints, and social claim fields are read from the Anchor event payload rather than from balance diffs, which a CPI-routed claim would hide.
4. **Matching.** Only `distribute_creator_fees` (and a resolved social claim) name a mint on chain. Everything else sweeps a creator vault, so the bot matches those claims through the tracked token's creator wallet, resolved from the PumpFun API when the token is added and backfilled on startup for older entries.
5. **X handle matching.** For a claim with a mint, the token's metadata gives the handle. For a wallet-level claim, the bot asks which coins the claiming wallet created and takes their handles (cached per wallet).
6. **Deduplication.** One payout usually lands as two instructions in the same transaction (the AMM collect that fills the creator vault, then the Pump collect that empties it). Instructions with the same wallet, amount, and mint are collapsed into a single event, and each chat is notified once per claim.
7. **Notification.** Rich HTML messages to every matching chat, with Solscan and pump.fun links.

## Deployment

### Docker

```bash
docker build -t pumpfun-claim-bot .
docker run --env-file .env pumpfun-claim-bot
```

### Google Cloud Run

```bash
PROJECT=my-project ./deploy-cloudrun.sh
```

The token goes into Secret Manager, everything else in `.env` ships as a plain env var, and the service is pinned to exactly one always-on instance: two instances would both long-poll the same bot and fight over updates. The script also creates the state bucket, grants the runtime service account, and pins that account on the service (the project's default compute account cannot be assumed to exist).

### Railway

Click "Deploy" in the Railway dashboard. `railway.json` is pre-configured.

### State durability

State lives in `DATA_DIR` as three files: `tracked.json` (tracked items), `settings.json` (per-chat alert settings), and `claims.json` (claim history, capped at 5,000 records and flushed every 30s).

A container filesystem does not survive a redeploy, so on Cloud Run those files are also mirrored to Cloud Storage. Set `STATE_BUCKET` and the bot:

- restores all three files from the bucket at boot, before anything reads them,
- mirrors each file about two seconds after it changes, coalescing bursts into one upload,
- retries a failed upload with backoff, and retries inline on shutdown, where a scheduled retry would never run,
- falls back to local-disk-only if the bucket is unreachable, logging the reason instead of refusing to start.

Check the bucket and its permissions before deploying:

```bash
STATE_BUCKET=pumpfun-bot-state npm run verify:state
```

It writes a probe object at the exact path the bot uses, reads it back, and deletes it. `/health` reports the active backend as `state`, either `local` or `gs://bucket/prefix/`.

On Docker or Railway, mount `DATA_DIR` as a volume instead.

## Architecture

```
claim-bot/
├── src/
│   ├── index.ts          # Entry point: config -> monitor -> bot, plus creator backfill
│   ├── config.ts         # Environment loader, WS derivation, RPC rotation list
│   ├── bot.ts            # Telegram commands and claim-to-track matching
│   ├── rpc-monitor.ts    # Direct Solana monitor (WebSocket + polling fallback)
│   ├── monitor.ts        # Optional relay-server client (RELAY_WS_URL mode)
│   ├── claim-logs.ts     # Log classification for the WebSocket stream
│   ├── rpc-fallback.ts   # Multi-endpoint RPC rotation
│   ├── dryrun.ts         # Monitor-only run, no Telegram token needed
│   ├── health.ts         # /health and /stats endpoint for probes and ops
│   ├── state-store.ts    # DATA_DIR paths and the Cloud Storage state mirror
│   ├── store.ts          # Persistent tracking store (tokens, wallets, X handles)
│   ├── settings.ts       # Per-chat alert settings (threshold, mute)
│   ├── claim-history.ts  # Bounded claim log behind /history, /top, /claims
│   ├── affiliates.ts     # Trading venue links and their referral codes
│   ├── keyboards.ts      # Inline buttons and their callback encoding
│   ├── delivery.ts       # Per-chat rate limiting, digest overflow, 429 backoff
│   ├── price.ts          # Cached SOL price with failover, for USD figures
│   ├── pump-client.ts    # PumpFun API client (token info, coins by creator)
│   ├── twitter-client.ts # Twitter/X API client for follower tracking
│   ├── formatters.ts     # HTML message formatters
│   ├── logger.ts         # Structured logger
│   └── types.ts          # Type definitions and program constants
├── package.json
├── tsconfig.json
├── Dockerfile
├── scripts/
│   ├── verify-amounts.mjs      # Cross-checks decoded claim amounts against the chain
│   └── verify-state-mirror.mjs # Probes the state bucket: write, read back, delete
├── deploy-cloudrun.sh    # One-command Cloud Run deploy
├── railway.json
└── .env.example
```

## HTTP API

The bot serves a small read-only JSON API on `PORT` (default 3000). Everything it exposes is public on-chain data.

| Endpoint | Description |
|----------|-------------|
| `GET /health`, `GET /stats` | Liveness plus monitor transport, claim counts, tracked items |
| `GET /claims?limit=50` | Recent claims, newest first (max 200) |
| `GET /top?hours=24&limit=10` | Leaderboard and window summary (max 168 hours) |

```bash
curl -s localhost:3000/claims?limit=3 | jq '.claims[] | {claimType, amount, ticker}'
curl -s localhost:3000/top?hours=6 | jq '.summary'
```

`GET /health` returns:

```json
{
  "status": "ok",
  "uptime": "3600s",
  "mode": "websocket",
  "claimsDetected": 412,
  "claimTxSeen": 780,
  "wsEventsReceived": 4820117,
  "queueDrops": 0,
  "activeRpc": "rpc.magicblock.app/mainnet…",
  "rpcEndpoints": 3,
  "trackedTokens": 12,
  "historyRecords": 1204
}
```

It returns 503 with `"status": "degraded"` when the monitor has fallen back to polling, because in that mode it silently misses most claims. `claimsDetected` staying flat while `wsEventsReceived` climbs is the signature of a broken log filter.

## Monitored Claim Types

| Claim Type | Program | Carries a mint | Description |
|-----------|---------|----------------|-------------|
| `collect_creator_fee` | Pump | no | Creator collects fees from the bonding curve |
| `claim_cashback` | Pump / PumpSwap | no | Trader claims cashback rewards (not fetched: never matches a track) |
| `distribute_creator_fees` | Pump | yes | Fee distribution to shareholders |
| `collect_coin_creator_fee` | PumpSwap | no | Creator collects fees from an AMM pool |
| `transfer_creator_fees_to_pump` | PumpSwap | no | Transfer AMM fees to the Pump program |
| `claim_social_fee_pda` | PumpFees | via recipient | Social fee PDA claim |

## Tests

```bash
npm test
```

Covers log classification (including the hex-versus-base64 regression that made the monitor silent), the claim matching paths, quote-currency rendering, alert settings, claim history and leaderboard aggregation, inline-button callback encoding, the tracking store, and the formatters.

To check parsed amounts against real balance changes on chain:

```bash
npm run build
VERIFY_SECONDS=180 node scripts/verify-amounts.mjs
```

It monitors live, then prints each claim's parsed amount beside the recipient's actual SOL and token deltas for the same transaction.
