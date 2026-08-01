/**
 * PumpFun Channel Bot — Configuration
 *
 * Loads and validates environment variables for the read-only channel feed.
 */

import 'dotenv/config';

export interface ChannelBotConfig {
    /** Telegram Bot API token (separate bot from @pfclaimsbot) */
    telegramToken: string;
    /** Channel ID to post to (@channelname or -100xxx) */
    channelId: string;
    /** Solana RPC HTTP URL (primary) */
    solanaRpcUrl: string;
    /** All Solana RPC HTTP URLs for fallback (primary + backups) */
    solanaRpcUrls: string[];
    /** Solana WebSocket URL (optional) */
    solanaWsUrl?: string;
    /** Polling interval in seconds */
    pollIntervalSeconds: number;
    /** Log level */
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    /** Feed toggles */
    feed: {
        claims: boolean;
        launches: boolean;
        graduations: boolean;
        whales: boolean;
        feeDistributions: boolean;
    };
    /** Only post claims for tokens that have GitHub URLs in their description */
    requireGithub: boolean;
    /** Minimum SOL for whale alerts */
    whaleThresholdSol: number;
    /** Affiliate ref codes for trading links */
    affiliates: {
        axiom: string;
        gmgn: string;
        padre: string;
    };
    /** Telegram user IDs allowed to run admin commands (empty = disabled) */
    adminUserIds: number[];
    /** Webhook endpoints that receive every feed event as a signed JSON POST */
    webhookUrls: string[];
    /** HMAC-SHA256 secret for webhook signatures (optional) */
    webhookSecret?: string;
}

export function loadConfig(): ChannelBotConfig {
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

    // Validate primary RPC URL
    try { new URL(solanaRpcUrl); } catch {
        throw new Error(`Invalid SOLANA_RPC_URL: ${solanaRpcUrl}`);
    }

    // Support comma-separated fallback RPC URLs — always include primary first
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

    const pollIntervalSeconds = Number.parseInt(
        process.env.POLL_INTERVAL_SECONDS || '30',
        10,
    );

    const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
    const rawLogLevel = process.env.LOG_LEVEL || 'info';
    const logLevel: ChannelBotConfig['logLevel'] = VALID_LOG_LEVELS.includes(rawLogLevel as typeof VALID_LOG_LEVELS[number])
        ? (rawLogLevel as ChannelBotConfig['logLevel'])
        : 'info';

    const feed = {
        claims: (process.env.FEED_CLAIMS || 'true').toLowerCase() === 'true',
        feeDistributions: (process.env.FEED_FEE_DISTRIBUTIONS || 'false').toLowerCase() === 'true',
        graduations: (process.env.FEED_GRADUATIONS || 'false').toLowerCase() === 'true',
        launches: (process.env.FEED_LAUNCHES || 'false').toLowerCase() === 'true',
        whales: (process.env.FEED_WHALES || 'false').toLowerCase() === 'true',
    };

    const requireGithub = (process.env.REQUIRE_GITHUB || 'true').toLowerCase() === 'true';

    const whaleThresholdSol = Number.parseFloat(
        process.env.WHALE_THRESHOLD_SOL || '10',
    );

    const affiliates = {
        axiom: process.env.AXIOM_REF ?? '',
        gmgn:  process.env.GMGN_REF  ?? '',
        padre: process.env.PADRE_REF  ?? '',
    };

    const adminUserIds = (process.env.ADMIN_USER_IDS ?? '')
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);

    const webhookUrls = (process.env.WEBHOOK_URLS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => {
            if (!s) return false;
            try { new URL(s); return true; } catch { return false; }
        });

    return {
        adminUserIds,
        affiliates,
        channelId,
        feed,
        logLevel,
        pollIntervalSeconds,
        requireGithub,
        solanaRpcUrl,
        solanaRpcUrls,
        solanaWsUrl,
        telegramToken,
        webhookSecret: process.env.WEBHOOK_SECRET || undefined,
        webhookUrls,
        whaleThresholdSol,
    };
}

