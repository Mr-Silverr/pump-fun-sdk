# PumpFun Channel Bot

Read-only Telegram channel feed that broadcasts PumpFun on-chain activity — GitHub social fee claims, token graduations, and more. Posts rich, intelligence-enriched cards to a Telegram channel in real time.

> **Live channel**: [@pumpfunclaims](https://t.me/pumpfunclaims) — powered by [@pumpclaimsbot](https://t.me/pumpclaimsbot)
>
> **Looking for interactive monitoring?** The [telegram-bot](../telegram-bot/) supports watch management, group chats, REST API, SSE streaming, and webhooks. Use this channel-bot for simple broadcast-only channels.

## Features

### Feed Types

| Feed | Description | Toggle |
|------|-------------|--------|
| **GitHub Social Fee Claims** | GitHub devs claiming PumpFun social fee PDA rewards | `FEED_CLAIMS` |
| **Token Launches** | New token mints with creator profile enrichment | `FEED_LAUNCHES` |
| **Token Graduations** | Tokens graduating from bonding curve to PumpAMM | `FEED_GRADUATIONS` |
| **Whale Trades** | Buys/sells over `WHALE_THRESHOLD_SOL` with curve progress | `FEED_WHALES` |
| **Fee Distributions** | Creator fee payouts to shareholders | `FEED_FEE_DISTRIBUTIONS` |

All toggles except `FEED_CLAIMS` can also be flipped at runtime with the `/feeds` admin command — no redeploy needed. Detection always runs for every feed; toggles only gate what gets posted to Telegram, so the HTTP API and webhooks below always carry the full event stream.

### Claim Intelligence

Every GitHub social fee claim card includes:

| Feature | Description |
|---------|-------------|
| **🚨 First-Time Alert** | `🚨🚨🚨 FIRST TIME CLAIM` banner when a GitHub user claims for the first time ever |
| **⚠️ Fake Claim Detection** | Detects when `claim_social_fee_pda` instruction is called but no fees are actually paid out |
| **📊 Claim Counter** | Sequential claim number tracked persistently across restarts |
| **💹 Lifetime SOL** | Total SOL claimed from the PDA over all time |
| **👤 GitHub Profile** | Username, bio, repos, followers, account age, location, blog |
| **𝕏 Social Links** | Twitter/X profile with follower counts (from GitHub profile) |
| **🏅 Influencer Badge** | Tier-based badge for high-follower GitHub/X accounts |
| **📈 Token Intel** | Graduated/bonding curve status, curve progress %, created age, reply count |
| **🔗 Token Socials** | Twitter, Telegram, website links from token metadata |
| **🏷️ Token Flags** | NSFW, banned, cashback status indicators |
| **⚠️ Trust Signals** | Warnings for new GitHub accounts (< 30 days), zero repos, fake claims |
| **🔗 Trading Links** | Axiom, GMGN, Padre links with affiliate codes |
| **️ Token Image** | Token image or GitHub avatar as photo card |

### Graduation Cards

Rich graduation cards include creator profile, top holders analysis, 24h trading volume, dev wallet activity, pool liquidity, and bundle detection.

## Architecture

```
Solana RPC (WebSocket + HTTP polling)
        │
        ▼
┌───────────────────┐
│  SocialFeeIndex   │──▶ Bootstraps ~148K SharingConfig → mint mappings
└────────┬──────────┘
         │
┌────────▼──────────┐
│   ClaimMonitor    │──▶ Decodes PumpFees program claim transactions
│   EventMonitor    │──▶ Decodes Pump program logs (graduations)
└────────┬──────────┘
         │ FeeClaimEvent / GraduationEvent
┌────────▼──────────┐
│ Enrichment Layer  │
│  ├─ GitHub API    │──▶ User profile, repos, followers
│  ├─ X/Twitter API │──▶ Follower counts, influencer tier
│  ├─ PumpFun API   │──▶ Token info, creator profile, holders, trades
│  ├─ ClaimTracker  │──▶ First-claim detection, persistent counts
│  └─ Fake Detect   │──▶ Instruction called but no payout (amountLamports=0)
└────────┬──────────┘
         │ ClaimFeedContext
┌────────▼──────────┐
│    Formatters     │──▶ Rich HTML cards with sections & emoji layout
└────────┬──────────┘
         │
┌────────▼──────────┐
│   grammY Bot      │──▶ Posts photo + caption to Telegram channel
│   (retry + rate   │    Falls back to text-only if photo fails
│    limiting)      │
└───────────────────┘
```

### Programs Monitored

| Program | ID | Purpose |
|---------|-----|---------|
| PumpFees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` | Fee sharing, social fee PDA claims |
| Pump | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Bonding curve (graduations) |
| PumpAMM | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | AMM (graduated pool events) |

## Quick Start

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. `/newbot` → follow prompts → copy the bot token
3. Create a public channel (e.g., `@pumpfunclaims`)
4. Add the bot as an **admin** to the channel (must have "Post Messages" permission)

### 2. Configure Environment

```bash
cp .env.example .env
```

```env
# ── Required ──────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather
CHANNEL_ID=@your_channel_name    # or numeric chat ID like -100xxx

# ── Solana RPC ────────────────────────────────────────────
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your-key
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=your-key

# Multiple RPC endpoints for fallback (comma-separated)
SOLANA_RPC_URLS=https://mainnet.helius-rpc.com/?api-key=key1,https://your-other-rpc.com

# ── Feed Toggles ──────────────────────────────────────────
FEED_CLAIMS=true                 # GitHub social fee claims
FEED_LAUNCHES=false              # New token launches
FEED_GRADUATIONS=true            # Token graduations
FEED_WHALES=false                # Large trades over WHALE_THRESHOLD_SOL
FEED_FEE_DISTRIBUTIONS=false     # Creator fee distributions to shareholders

# ── GitHub Enrichment ─────────────────────────────────────
REQUIRE_GITHUB=true              # Only post claims with GitHub social fee PDA
GITHUB_TOKEN=ghp_your_token      # Optional: raises rate limit from 60 to 5000 req/hr

# ── AI Summaries (optional) ──────────────────────────────
GROQ_API_KEY=gsk_your_key        # Groq API for AI one-liners

# ── Admin Commands (optional) ────────────────────────────
ADMIN_USER_IDS=123456789         # Telegram user IDs allowed to control the bot via DM

# ── Webhooks (optional) ──────────────────────────────────
WEBHOOK_URLS=https://example.com/pump-hook   # Every event POSTed as JSON
WEBHOOK_SECRET=change-me                     # Enables HMAC-SHA256 signatures

# ── Tuning ────────────────────────────────────────────────
POLL_INTERVAL_SECONDS=30         # HTTP polling fallback interval
WHALE_THRESHOLD_SOL=10           # Minimum SOL for whale alerts
LOG_LEVEL=info                   # debug | info | warn | error
```

### 3. Run

```bash
# Install dependencies
npm install

# Development (hot reload via tsx)
npm run dev

# Production
npm run build
npm start
```

### 4. Deploy with Docker

```bash
docker build -t pumpfun-channel-bot .
docker run -d --env-file .env pumpfun-channel-bot
```

### 5. Deploy to Railway

Railway auto-deploys from GitHub and provides persistent volumes for claim tracking data.

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

# Create & link project
railway init
railway link

# Set environment variables
railway variables set TELEGRAM_BOT_TOKEN=your-token
railway variables set CHANNEL_ID=@your_channel_name
railway variables set SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your-key
railway variables set SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=your-key
railway variables set FEED_CLAIMS=true
railway variables set REQUIRE_GITHUB=true

# Create persistent volume for claim tracker data
railway volume create --mount /app/data

# Deploy
railway up
```

See [railway.json](railway.json) for the deployment config:
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### 6. Deploy to Google Cloud Run

The bot is a single container with an HTTP port, so it runs on Cloud Run as-is. Use [cloudbuild.yaml](cloudbuild.yaml) (substitutions: `_SERVICE`, `_REGION`, `_REPO`) or deploy straight from source:

```bash
gcloud run deploy pumpfun-channel-bot \
  --source . \
  --region us-central1 \
  --min-instances 1 --max-instances 1 \
  --set-env-vars "CHANNEL_ID=@your_channel,SOLANA_RPC_URL=...,SOLANA_WS_URL=...,FEED_GRADUATIONS=true" \
  --set-secrets "TELEGRAM_BOT_TOKEN=telegram-bot-token:latest"
```

`--min-instances 1` matters: this is a long-lived monitor, not a request server, so it must not scale to zero. `/health` doubles as the container health check.

## Admin Commands

With `ADMIN_USER_IDS` set, the operator can DM the bot to inspect and steer it at runtime. Everyone else is ignored silently, and commands only work in private chats.

| Command | Effect |
|---------|--------|
| `/status` | Uptime, transport (websocket/polling), feed toggles, counters, webhook stats |
| `/feeds` | List feed toggles |
| `/feeds graduations off` | Flip a feed at runtime (claims requires a restart to turn on) |
| `/threshold 25` | Set the whale alert threshold in SOL |
| `/mute 30` | Pause channel posting for 30 minutes (monitoring continues) |
| `/unmute` | Resume posting |
| `/recent 10` | Show the last 10 detected events |

## HTTP API

The health port (`PORT`, default 3000) serves a read-only JSON API over the same event pipeline. CORS is open — everything here is public on-chain data.

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness probe: status, uptime, counters |
| `GET /stats` | Transport mode, feed toggles, mute state, event counters, webhook stats |
| `GET /events/recent?limit=50&kind=graduation` | Ring buffer of recent events, newest first |
| `GET /events/stream?kind=whale` | Live [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream |

`kind` is one of `claim`, `launch`, `graduation`, `whale`, `feeDistribution`. Example consumer:

```js
const stream = new EventSource('http://localhost:3000/events/stream?kind=graduation');
stream.addEventListener('graduation', (e) => {
    const event = JSON.parse(e.data);
    console.log('graduated:', event.mint, event.summary);
});
```

## Webhooks

Set `WEBHOOK_URLS` to fan every detected event out as a JSON POST — the push-based twin of the SSE stream, for consumers that can't hold a connection open. With `WEBHOOK_SECRET` set, each delivery carries an HMAC-SHA256 signature:

```
POST <your-url>
Content-Type: application/json
X-PumpFeed-Event: graduation
X-PumpFeed-Signature-256: sha256=<hex hmac of the raw body>
```

Verify by recomputing the HMAC of the raw request body with your secret and comparing (timing-safe compare recommended). Deliveries retry up to 3 times on network errors and 5xx; 4xx responses are not retried.

## Delivery Health

The bot verifies at boot that it can actually post to `CHANNEL_ID` and says so on line one, rather than failing silently on the first event:

```
[INFO]  Channel access verified: @pumpgraduatedbot can post to @trackpumpfun
```

When it cannot, you get the fault and the fix instead of a stack trace, and the feed keeps running so the API and webhooks still carry every event:

```
[ERROR] CHANNEL NOT REACHABLE (not_a_member)
[ERROR] FIX: Add the bot to @trackpumpfun and grant it post rights (Telegram → group → Add members → the bot, then promote it to admin).
```

The same state is machine-readable: `GET /health` returns **503** with `degraded: true` and a `delivery` object carrying the fault and the fix, so an uptime check catches a bot that is running but mute. Recognized faults:

| Fault | Meaning | Fix |
|-------|---------|-----|
| `not_a_member` | Bot was never added, or was removed/kicked | Add the bot to the chat and promote it |
| `chat_not_found` | `CHANNEL_ID` does not resolve | Correct the `@username` or use the numeric `-100…` ID |
| `no_permission` | In the chat but cannot post | Promote to admin with Send Messages / Send Photos |
| `blocked` | Bot is blocked in the chat | Unblock it |
| `rate_limited`, `transient` | Telegram 429/5xx | None — retried automatically, health stays OK |

Repeated failures of the same kind log once, then periodically, instead of once per event.

## Transport Resilience

The monitor prefers a WebSocket subscription (real-time, complete) and falls back to HTTP polling only when the socket is genuinely unusable: after 3 consecutive silent heartbeat periods it switches to polling and retries the WebSocket every 10 minutes, promoting it back automatically the moment live events flow again. `/status` and `GET /stats` both report the active transport.

Polling is a degraded mode by design — `getSignaturesForAddress` caps at 20 signatures per poll on one of the busiest programs on Solana, so a healthy WebSocket endpoint matters. Free endpoints that carry the full `logsSubscribe` stream exist (e.g. `wss://solana-rpc.publicnode.com`).

## Project Structure

```
channel-bot/
├── src/
│   ├── index.ts              # Entry point — wires monitors, enrichment, & Telegram posting
│   ├── config.ts             # Environment variable loading & validation
│   ├── claim-monitor.ts      # PumpFees program monitor (WebSocket + HTTP polling)
│   ├── claim-tracker.ts      # First-claim detection + claim counter (persisted to disk)
│   ├── event-monitor.ts      # Pump program log decoder (graduations, launches)
│   ├── social-fee-index.ts   # SocialFeeIndex — maps SharingConfig PDAs → mints (~148K)
│   ├── formatters.ts         # Rich HTML card builders for Telegram
│   ├── pump-client.ts        # PumpFun HTTP API client (token info, creator profiles)
│   ├── github-client.ts      # GitHub API client (user profiles, rate-limited cache)
│   ├── x-client.ts           # X/Twitter profile fetcher + influencer tier logic
│   ├── groq-client.ts        # Groq AI one-liner summaries
│   ├── rpc-fallback.ts       # Multi-RPC failover with round-robin
│   ├── health.ts             # HTTP API: /health, /stats, /events/recent, /events/stream
│   ├── event-store.ts        # Ring buffer of recent events + live subscriber fan-out
│   ├── webhooks.ts           # Signed JSON webhook delivery with retries
│   ├── admin.ts              # Telegram DM admin commands (/status, /feeds, /mute, ...)
│   ├── delivery.ts           # Channel preflight + delivery fault classification
│   ├── types.ts              # Program IDs, discriminators, event types
│   └── logger.ts             # Leveled console logger
├── data/                     # Persisted state (gitignored, Railway volume mount)
│   └── github-first-claims.json
├── Dockerfile                # Multi-stage Docker build
├── railway.json              # Railway deployment config
├── cloudbuild.yaml           # Google Cloud Run build + deploy config
├── package.json
└── tsconfig.json
```

## How It Works

### Claim Detection Pipeline

```
Transaction detected on PumpFees program
  │
  ▼
Identify instruction: claim_social_fee_pda?
  │
  ├─ YES ──▶ Parse platform (2 = GitHub) + user_id from Anchor args
  │           │
  │           ▼
  │        Check amountLamports from SocialFeePdaClaimed event
  │           │
  │           ├─ amountLamports > 0 ──▶ Real claim
  │           │   ├─ Check ClaimTracker: first time for this GitHub user?
  │           │   │   ├─ YES ──▶ 🚨 FIRST TIME CLAIM banner
  │           │   │   └─ NO  ──▶ Standard claim card
  │           │   └─ Enrich: GitHub API + PumpFun API + X profile
  │           │
  │           └─ amountLamports = 0 ──▶ ⚠️ FAKE CLAIM (instruction called, no payout)
  │
  └─ NO ───▶ Other claim type (creator fee, cashback, etc.)
```

### SocialFeeIndex Bootstrap

On startup, the bot fetches all `SharingConfig` accounts from the PumpFees program to build a reverse mapping from social fee PDA addresses to token mints. This enables resolving which token a social fee claim belongs to without additional RPC calls.

- **~148K mappings** loaded at startup
- **Incremental updates** via WebSocket subscription on `CreateFeeSharingConfig` and `UpdateFeeShares` events
- **Lookup**: `socialFeeIndex.getMintForPda(pdaAddress)` → token mint

### Fake Claim Detection

Some users call the `claim_social_fee_pda` instruction targeting random token PDAs where they have no fees to collect. The bot detects these by checking:

1. The instruction discriminator matches `claim_social_fee_pda`
2. The transaction logs contain no `SocialFeePdaClaimed` event — OR the event shows `amountLamports = 0`
3. The GitHub user ID and platform are still parsed from the instruction args (Anchor Borsh format)

Fake claims are posted with a `⚠️ FAKE CLAIM` warning and a `🚩 Fake claim — no fees paid out` trust signal.

### First-Claim Tracking

The `ClaimTracker` maintains a persistent set of GitHub user IDs that have successfully claimed:

- **In-memory set** for fast lookup during processing
- **Debounced disk persistence** (5-second delay) to `data/github-first-claims.json`
- **Split check/mark pattern**: `hasGithubUserClaimed()` checks without side effects, `markGithubUserClaimed()` only called after successful Telegram post
- **Claim counter**: `incrementGithubClaimCount()` returns sequential claim number per user
- First-claim status is NOT set for fake claims

## Example Claim Card

```
🚨🚨🚨 FIRST TIME CLAIM 🚨🚨🚨

🐙 $PUMP — PumpCoin  💹 $45K
  ↳ GitHub dev claimed PumpFun social fees

📊 Claim #1 · 0.1043 SOL lifetime ($15.65)

🏦 0.1043 SOL ($15.65)
  ↳ 8mNp...4rWz

👤 nirholas (Nicholas)
  ↳ 📦 45 · 👁 200 · 📅 5y ago
  TypeScript SDK builder
𝕏 nichxbt · 1.2K

📈 Bonding curve (72%) · Created 3h ago · 💬 12
𝕏 @pump_coin · 💬 TG · 🌐 pumpcoin.io

⚠️ GitHub account created 15d ago

CA: 7xKXt...p3Bz
Axiom · GMGN · Padre

🔍 TX
```

## Requirements

- **Node.js** >= 20.0.0
- **Telegram bot token** (via [@BotFather](https://t.me/BotFather))
- **Telegram channel** with the bot added as admin
- **Solana RPC endpoint** — dedicated RPC recommended (Helius, QuickNode, Triton). Public mainnet works but may rate-limit.
- **GitHub token** (optional) — raises API rate limit from 60 to 5,000 req/hr

## Troubleshooting

### Bot Not Posting Messages

1. **Check bot permissions** — The bot must be an admin in the channel with "Post Messages" permission
2. **Verify CHANNEL_ID** — Use `@channel_name` for public channels or the numeric ID (e.g., `-100xxx`) for private channels. To find the numeric ID, forward a channel message to [@userinfobot](https://t.me/userinfobot)
3. **Telegram 403 error** — Means the bot is NOT a member/admin of the channel. Add it via channel settings → Administrators → Add Administrator
4. **Check logs** — Set `LOG_LEVEL=debug` to see all events the bot processes

### Rate Limiting

Telegram limits bots to ~30 messages per second to a channel. The grammY framework handles rate limiting automatically:
- Messages may be delayed but won't be dropped
- The bot includes a retry helper that respects `retry_after` headers
- For very high activity, increase `POLL_INTERVAL_SECONDS` to reduce event volume

### RPC Connection Issues

- Public RPC endpoints have rate limits — for production use a dedicated RPC
- Set `SOLANA_RPC_URLS` with multiple endpoints for automatic failover
- If WebSocket disconnects, the bot falls back to HTTP polling at `POLL_INTERVAL_SECONDS`
- The `RpcFallback` class provides round-robin across configured endpoints
- Set `LOG_LEVEL=debug` to see connection status

### Missing Claims

- **GitHub claims only?** — Set `REQUIRE_GITHUB=true` to only post GitHub social fee claims
- **Feed disabled?** — Verify `FEED_CLAIMS=true` is set
- **SocialFeeIndex slow?** — Initial bootstrap fetches ~148K accounts. This takes 30-60 seconds on startup. Check logs for `SocialFeeIndex: loaded N mappings`
- **Rate limited?** — GitHub API allows 60 req/hr unauthenticated. Set `GITHUB_TOKEN` for 5,000 req/hr

### Pipeline Stats

The bot logs pipeline counters every 60 seconds:
```
Pipeline: 15 total → 8 social → 3 first / 5 repeat → 8 posted (skip: 7 cashback)
```

- **total**: All claim events received
- **social**: GitHub social fee PDA claims
- **first/repeat**: First-time vs. returning claimers
- **posted**: Successfully posted to Telegram
- **skip cashback**: Cashback claims (user refunds, not creator activity)

## Local Development

```bash
# Install dependencies
npm install

# Run with hot reload (tsx)
npm run dev
```

Set `LOG_LEVEL=debug` — all events are logged to stdout regardless of whether they're posted to Telegram.
