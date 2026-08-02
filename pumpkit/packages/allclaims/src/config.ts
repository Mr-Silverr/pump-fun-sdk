/**
 * PumpFun All-Claims Bot — Configuration
 *
 * Loads and validates environment variables for the all-claims channel feed.
 * Unlike the first-claims channel bot, this bot broadcasts EVERY fee claim,
 * so its config centers on flood control: an instant-post threshold, a
 * digest interval for everything below it, and a Telegram post budget.
 */

import 'dotenv/config';

export interface AllClaimsConfig {
    /** Telegram Bot API token (its own bot — never reuse the first-claims bot token) */
    telegramToken: string;
    /** Channel ID to post to (@channelname or -100xxx) */
    channelId: string;
    /** Solana RPC HTTP URL (primary) */
    solanaRpcUrl: string;
    /** All Solana RPC HTTP URLs for fallback (primary + backups) */
    solanaRpcUrls: string[];
    /** Solana WebSocket URL (optional) */
    solanaWsUrl?: string;
    /** Polling interval in seconds (fallback mode) */
    pollIntervalSeconds: number;
    /** Log level */
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    /** Claims at or above this USD value post immediately as individual messages */
    instantThresholdUsd: number;
    /** Claims below this USD value are dropped entirely (0 = keep everything) */
    minClaimUsd: number;
    /** Seconds between digest posts that batch all sub-threshold claims */
    digestIntervalSeconds: number;
    /** Hard ceiling on Telegram posts per minute (channel cap is ~20/min) */
    maxPostsPerMinute: number;
    /** Max digest lines shown per digest message (rest are summarized) */
    digestMaxLines: number;
    /**
     * How many of a window's biggest claims are promoted to full cards.
     *
     * Without this the feed is digest-only whenever claims run small, which is
     * most of the time: a $100 instant threshold never fires on a chain whose
     * typical claim is a few dollars. Promoting the top of each window keeps
     * the channel made of readable cards regardless of claim sizes.
     */
    cardsPerWindow: number;
    /** Include cashback claims (user refunds, not creator activity) */
    includeCashback: boolean;
    /** Include distribute_creator_fees payouts */
    includeDistributions: boolean;
    /** Referral handles for the trade links on an instant card. Empty values render plain links. */
    affiliates: { axiom: string; gmgn: string; padre: string; fomo: string };
}

function parseNumber(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (raw == null || raw === '') return fallback;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got: ${raw}`);
    if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}, got: ${n}`);
    return n;
}

function parseBool(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw == null || raw === '') return fallback;
    return raw.toLowerCase() === 'true';
}

export function loadConfig(): AllClaimsConfig {
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!telegramToken) {
        throw new Error(
            'TELEGRAM_BOT_TOKEN is required. Create a bot via @BotFather and set the env var.',
        );
    }

    const channelId = process.env.CHANNEL_ID;
    if (!channelId) {
        throw new Error(
            'CHANNEL_ID is required. Set it to @your_channel_name or the numeric chat ID.',
        );
    }

    const solanaRpcUrl =
        process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    try { new URL(solanaRpcUrl); } catch {
        throw new Error(`Invalid SOLANA_RPC_URL: ${solanaRpcUrl}`);
    }

    const extraUrls = process.env.SOLANA_RPC_URLS
        ? process.env.SOLANA_RPC_URLS.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const solanaRpcUrls = [solanaRpcUrl, ...extraUrls.filter((u) => u !== solanaRpcUrl)];

    let solanaWsUrl = process.env.SOLANA_WS_URL;
    if (!solanaWsUrl) {
        try {
            const url = new URL(solanaRpcUrl);
            url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            solanaWsUrl = url.toString();
        } catch {
            // leave undefined — monitor will use polling
        }
    }

    const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
    const rawLogLevel = process.env.LOG_LEVEL || 'info';
    const logLevel: AllClaimsConfig['logLevel'] = VALID_LOG_LEVELS.includes(rawLogLevel as typeof VALID_LOG_LEVELS[number])
        ? (rawLogLevel as AllClaimsConfig['logLevel'])
        : 'info';

    return {
        affiliates: {
            axiom: process.env.AXIOM_REF ?? 'nich',
            gmgn: process.env.GMGN_REF ?? 'nichxbt',
            padre: process.env.PADRE_REF ?? 'nichxbt',
            fomo: process.env.FOMO_REF ?? 'nichxbt',
        },
        cardsPerWindow: parseNumber('CARDS_PER_WINDOW', 6, 0, 18),
        channelId,
        digestIntervalSeconds: parseNumber('DIGEST_INTERVAL_SECONDS', 60, 10, 3600),
        digestMaxLines: parseNumber('DIGEST_MAX_LINES', 12, 1, 40),
        includeCashback: parseBool('INCLUDE_CASHBACK', false),
        includeDistributions: parseBool('INCLUDE_DISTRIBUTIONS', true),
        instantThresholdUsd: parseNumber('INSTANT_THRESHOLD_USD', 100, 0, 1_000_000),
        logLevel,
        maxPostsPerMinute: parseNumber('MAX_POSTS_PER_MINUTE', 15, 1, 19),
        minClaimUsd: parseNumber('MIN_CLAIM_USD', 0, 0, 1_000_000),
        pollIntervalSeconds: Number.parseInt(process.env.POLL_INTERVAL_SECONDS || '30', 10),
        solanaRpcUrl,
        solanaRpcUrls,
        solanaWsUrl,
        telegramToken,
    };
}
