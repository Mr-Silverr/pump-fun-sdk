/**
 * PumpFun All-Claims Bot — Entry Point
 *
 * A read-only Telegram channel feed that broadcasts EVERY PumpFun fee claim,
 * not just first claims. Large claims post individually; everything else is
 * batched into a periodic digest so the channel stays inside Telegram's rate
 * limit no matter how busy the chain gets.
 *
 * Run:
 *   npm run dev                  (hot reload)
 *   npm run build && npm start   (production)
 */

import { Bot, type BotError } from 'grammy';

import { loadConfig } from './config.js';
import { ClaimMonitor } from './claim-monitor.js';
import { ClaimDispatcher } from './dispatcher.js';
import { EventStore } from './event-store.js';
import { formatDigest, formatInstantClaim, claimUsd, CLAIM_TYPE_SHORT, type ValuedClaim } from './formatters.js';
import { startHealthServer, stopHealthServer } from './health.js';
import { log, setLogLevel } from './logger.js';
import { fetchSolUsdPrice, fetchTokenInfo, type TokenInfo } from './pump-client.js';
import { maskUrl } from './rpc-fallback.js';
import type { FeeClaimEvent } from './types.js';

async function main(): Promise<void> {
    const config = loadConfig();
    setLogLevel(config.logLevel);

    log.info('PumpFun All-Claims Bot starting...');
    log.info('  Channel: %s', config.channelId);
    log.info('  RPC: %s', maskUrl(config.solanaRpcUrl));
    log.info('  Instant threshold: $%d · digest every %ds · max %d posts/min',
        config.instantThresholdUsd, config.digestIntervalSeconds, config.maxPostsPerMinute);

    const bot = new Bot(config.telegramToken);
    bot.catch((err: BotError) => {
        log.error('Bot error:', err.error);
    });

    const store = new EventStore();
    const dispatcher = new ClaimDispatcher(config);

    /** Token info for claims seen this digest window, so the digest can name symbols. */
    const windowTokens = new Map<string, TokenInfo | null>();

    const stats = { detected: 0, instant: 0, digested: 0, dropped: 0, digestsPosted: 0, postFailures: 0 };

    /** Retry helper for transient Telegram errors (429, 5xx). */
    async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err: unknown) {
                const msg = String(err);
                const is429 = msg.includes('429') || msg.includes('Too Many Requests');
                const is5xx = msg.includes('500') || msg.includes('502') || msg.includes('503');
                if ((is429 || is5xx) && attempt < maxRetries) {
                    let delay = (attempt + 1) * 2000;
                    const retryMatch = msg.match(/retry after (\d+)/i);
                    if (retryMatch) delay = (Number(retryMatch[1]) + 1) * 1000;
                    log.warn('Telegram %s — retry %d/%d in %dms', is429 ? '429' : '5xx', attempt + 1, maxRetries, delay);
                    await new Promise((r) => setTimeout(r, delay));
                    continue;
                }
                throw err;
            }
        }
        throw new Error('Unreachable');
    }

    async function postToChannel(message: string): Promise<void> {
        await withRetry(() => bot.api.sendMessage(config.channelId, message, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
        }));
    }

    /**
     * Token info for a mint, cached for the life of the digest window.
     * Capped so a window with no digest flush (all-instant traffic) cannot
     * grow the map without bound.
     */
    const MAX_WINDOW_TOKENS = 1_000;
    async function tokenFor(mint: string): Promise<TokenInfo | null> {
        if (!mint) return null;
        if (windowTokens.has(mint)) return windowTokens.get(mint) ?? null;
        const info = await fetchTokenInfo(mint);
        if (windowTokens.size >= MAX_WINDOW_TOKENS) {
            const oldest = windowTokens.keys().next().value;
            if (oldest !== undefined) windowTokens.delete(oldest);
        }
        windowTokens.set(mint, info);
        return info;
    }

    function summarize(event: FeeClaimEvent, usd: number): string {
        const typeLabel = CLAIM_TYPE_SHORT[event.claimType] ?? event.claimType;
        const target = event.tokenMint ? event.tokenMint.slice(0, 8) : 'wallet';
        return `${typeLabel} claim on ${target} worth $${usd.toFixed(2)}`;
    }

    // ── Claim handling ───────────────────────────────────────────────
    const monitor = new ClaimMonitor(config, async (event: FeeClaimEvent) => {
        try {
            if (event.isFake) return;
            if (event.isCashback && !config.includeCashback) return;
            if (event.claimType === 'distribute_creator_fees' && !config.includeDistributions) return;

            stats.detected++;

            const solUsdPrice = await fetchSolUsdPrice();
            const usd = claimUsd(event, solUsdPrice);
            const claim: ValuedClaim = { event, usd };

            const route = dispatcher.route(claim);
            if (route === 'dropped') {
                stats.dropped++;
                return;
            }

            const recorded = store.record({
                data: {
                    amountQuote: event.amountQuote ?? event.amountSol,
                    claimType: event.claimType,
                    claimerWallet: event.claimerWallet,
                    quoteTicker: event.quoteTicker ?? 'SOL',
                    route,
                    usd,
                },
                kind: 'claim',
                mint: event.tokenMint || undefined,
                posted: false,
                summary: summarize(event, usd),
                txSignature: event.txSignature,
            });

            if (route === 'digest') {
                stats.digested++;
                // Warm the token cache now so the digest flush stays fast.
                if (event.tokenMint) await tokenFor(event.tokenMint);
                return;
            }

            const token = event.tokenMint ? await tokenFor(event.tokenMint) : null;
            try {
                await postToChannel(formatInstantClaim(event, token, solUsdPrice));
                store.markPosted(recorded.seq);
                stats.instant++;
                log.info('✅ Instant claim posted: $%s · %s', usd.toFixed(2), event.txSignature.slice(0, 8));
            } catch (postErr) {
                stats.postFailures++;
                log.error('Failed to post instant claim %s: %s', event.txSignature.slice(0, 8), postErr);
            }
        } catch (err) {
            log.error('Claim handler error: %s', err);
        }
    });

    // ── Digest flush loop ────────────────────────────────────────────
    const digestTimer = setInterval(() => {
        void (async () => {
            try {
                const window = dispatcher.flush();
                if (!window) return;

                const message = formatDigest(
                    window.claims,
                    windowTokens,
                    {
                        droppedBelowMin: window.droppedBelowMin,
                        totalClaims: window.totalClaims,
                        totalUsd: window.totalUsd,
                        windowSeconds: config.digestIntervalSeconds,
                    },
                    config.digestMaxLines,
                );

                await postToChannel(message);
                stats.digestsPosted++;
                windowTokens.clear();
                log.info('📊 Digest posted: %d claims · $%s', window.totalClaims, window.totalUsd.toFixed(2));
            } catch (err) {
                stats.postFailures++;
                log.error('Digest post failed: %s', err);
            }
        })();
    }, config.digestIntervalSeconds * 1000);

    // ── Pipeline log ─────────────────────────────────────────────────
    const statsTimer = setInterval(() => {
        log.info('Pipeline: %d detected → %d instant + %d digested (%d dropped) · %d digests · %d post failures',
            stats.detected, stats.instant, stats.digested, stats.dropped, stats.digestsPosted, stats.postFailures);
    }, 60_000);

    // ── Start ────────────────────────────────────────────────────────
    await monitor.start();
    log.info('Claim monitor started');

    await bot.init();
    log.info('Bot initialized: @%s', bot.botInfo.username);
    log.info('All-claims feed is live → %s', config.channelId);

    const startedAt = Date.now();
    startHealthServer({
        getStats: () => ({
            channel: config.channelId,
            claimMonitor: monitor.getMetrics(),
            dispatcher: dispatcher.getMetrics(),
            pipeline: stats,
        }),
        startedAt,
        store,
    });

    // ── Graceful shutdown ────────────────────────────────────────────
    const shutdown = () => {
        log.info('Shutting down...');
        clearInterval(digestTimer);
        clearInterval(statsTimer);
        monitor.stop();
        stopHealthServer();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
