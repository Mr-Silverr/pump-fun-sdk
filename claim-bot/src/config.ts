/**
 * PumpFun Claim Bot - Configuration
 *
 * Loads and validates environment variables.
 */

import 'dotenv/config';

import type { BotConfig } from './types.js';

/**
 * Default RPC lane. Verified to serve both HTTP and `wss://` logsSubscribe with
 * no API key, which matters because polling mode cannot power this bot: it
 * samples only the most recent signatures per program per tick.
 */
const DEFAULT_RPC_URL = 'https://rpc.magicblock.app/mainnet';

/** Backup lanes used when the primary starts refusing calls. */
const DEFAULT_FALLBACK_RPC_URLS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-rpc.publicnode.com',
];

const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

function parseUrlList(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Derive a WebSocket URL from an HTTP RPC URL, the way web3.js does internally. */
export function deriveWsUrl(rpcUrl: string): string | undefined {
    try {
        const url = new URL(rpcUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return url.toString();
    } catch {
        return undefined;
    }
}

export interface LoadConfigOptions {
    /**
     * Set false for monitor-only mode: runs the chain monitor with no Telegram
     * bot, so detection can be verified against mainnet before a token exists.
     */
    requireTelegramToken?: boolean;
}

export function loadConfig(options: LoadConfigOptions = {}): BotConfig {
    const { requireTelegramToken = true } = options;

    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!telegramToken && requireTelegramToken) {
        throw new Error(
            'TELEGRAM_BOT_TOKEN is required. Create a bot via @BotFather and set the env var.',
        );
    }

    const relayWsUrl = process.env.RELAY_WS_URL;
    const solanaRpcUrl = process.env.SOLANA_RPC_URL || (relayWsUrl ? undefined : DEFAULT_RPC_URL);

    if (solanaRpcUrl) {
        try {
            new URL(solanaRpcUrl);
        } catch {
            throw new Error(`Invalid SOLANA_RPC_URL: ${solanaRpcUrl}`);
        }
    }

    // Primary first, then explicit backups, then the built-in ones. Duplicates
    // are dropped so a repeated entry cannot occupy two rotation slots.
    const configuredFallbacks = parseUrlList(process.env.SOLANA_RPC_URLS);
    const solanaRpcUrls = solanaRpcUrl
        ? [...new Set([solanaRpcUrl, ...configuredFallbacks, ...DEFAULT_FALLBACK_RPC_URLS])]
        : [];

    // An explicit SOLANA_WS_URL wins. Otherwise derive one: without this the
    // monitor silently drops to polling and misses most claims on a busy chain.
    const solanaWsUrl = solanaRpcUrl
        ? process.env.SOLANA_WS_URL || deriveWsUrl(solanaRpcUrl)
        : undefined;

    const pollIntervalSeconds = process.env.POLL_INTERVAL_SECONDS
        ? parseInt(process.env.POLL_INTERVAL_SECONDS, 10)
        : 15;

    if (!relayWsUrl && !solanaRpcUrl) {
        throw new Error(
            'Either RELAY_WS_URL or SOLANA_RPC_URL is required. ' +
            'Set SOLANA_RPC_URL for direct RPC monitoring, or RELAY_WS_URL for relay mode.',
        );
    }

    const rawLogLevel = process.env.LOG_LEVEL || 'info';
    const logLevel: BotConfig['logLevel'] = VALID_LOG_LEVELS.includes(
        rawLogLevel as (typeof VALID_LOG_LEVELS)[number],
    )
        ? (rawLogLevel as BotConfig['logLevel'])
        : 'info';

    const twitterBearerToken = process.env.TWITTER_BEARER_TOKEN;

    const twitterInfluencerIds = process.env.TWITTER_INFLUENCER_IDS
        ? process.env.TWITTER_INFLUENCER_IDS.split(',').map((s) => s.trim()).filter(Boolean)
        : [];

    return {
        logLevel,
        relayWsUrl,
        solanaRpcUrl,
        solanaRpcUrls,
        solanaWsUrl,
        pollIntervalSeconds,
        telegramToken: telegramToken ?? '',
        twitterBearerToken,
        twitterInfluencerIds,
    };
}
