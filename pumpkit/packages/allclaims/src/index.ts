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
import { ClaimDispatcher, splitWindow } from './dispatcher.js';
import { EventStore } from './event-store.js';
import {
    formatDigest,
    formatInstantClaim,
    cardImageUrl,
    claimUsd,
    resolveSubject,
    CLAIM_TYPE_SHORT,
    type DigestSubject,
    type ValuedClaim,
} from './formatters.js';
import { buildClaimCard, resolveDigestSubject, subjectWallet } from './enrich.js';
import { buildClaimKeyboard, type InlineKeyboard } from './keyboards.js';
import { startHealthServer, stopHealthServer } from './health.js';
import { log, setLogLevel } from './logger.js';
import { fetchSolUsdPrice, setRpcEndpoints } from './pump-client.js';
import { maskUrl } from './rpc-fallback.js';
import type { FeeClaimEvent } from './types.js';

async function main(): Promise<void> {
    const config = loadConfig();
    setLogLevel(config.logLevel);

    log.info('PumpFun All-Claims Bot starting...');
    log.info('  Channel: %s', config.channelId);
    log.info('  RPC: %s', maskUrl(config.solanaRpcUrl));
    log.info('  Instant threshold: $%d · up to %d cards + 1 digest every %ds · max %d posts/min',
        config.instantThresholdUsd, config.cardsPerWindow, config.digestIntervalSeconds, config.maxPostsPerMinute);

    // Holder concentration is read from the chain: no HTTP API serves it now.
    setRpcEndpoints(config.solanaRpcUrls);

    const bot = new Bot(config.telegramToken);
    bot.catch((err: BotError) => {
        log.error('Bot error:', err.error);
    });

    const store = new EventStore();
    const dispatcher = new ClaimDispatcher(config);

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

    /**
     * Post a card.
     *
     * When an image is available it rides on the link preview rather than a
     * photo upload: `sendPhoto` caps captions at 1024 characters, which a full
     * card exceeds, while a previewed message keeps the artwork AND the whole
     * card. Telegram fetches the image itself, so a dead IPFS gateway costs a
     * missing thumbnail, never a failed post.
     */
    async function postToChannel(
        message: string,
        imageUrl?: string | null,
        keyboard?: InlineKeyboard,
    ): Promise<void> {
        await withRetry(() => bot.api.sendMessage(config.channelId, message, {
            link_preview_options: imageUrl
                ? { url: imageUrl, prefer_large_media: true, show_above_text: true }
                : { is_disabled: true },
            parse_mode: 'HTML',
            ...(keyboard ? { reply_markup: keyboard } : {}),
        }));
    }

    /** Enrich one claim and post it as a full card with its action buttons. */
    async function postCard(claim: ValuedClaim, solUsdPrice: number): Promise<void> {
        const card = await buildClaimCard(claim.event, claim.usd, solUsdPrice, config.affiliates);
        const mint = resolveSubject(card)?.mint ?? null;
        const keyboard = buildClaimKeyboard(
            mint,
            claim.event.txSignature,
            claim.event.recipientWallet ?? claim.event.creatorWallet ?? claim.event.claimerWallet,
            config.affiliates,
        );
        await postToChannel(formatInstantClaim(card), cardImageUrl(card), keyboard);
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
                return;
            }

            try {
                await postCard(claim, solUsdPrice);
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

    // ── Window flush: cards first, then a digest for the tail ────────
    //
    // The instant threshold alone leaves the channel digest-only whenever
    // claims run small, which is most of the time. Every window therefore
    // promotes its biggest distinct claims to full cards and digests only what
    // is left, so the feed reads as cards no matter what the chain is paying.
    const digestTimer = setInterval(() => {
        void (async () => {
            const window = dispatcher.flush();
            if (!window) return;

            const solUsdPrice = await fetchSolUsdPrice();

            // One budget slot is already held for the digest by flush(); the
            // rest of the minute is available for cards.
            const cardBudget = Math.min(config.cardsPerWindow, dispatcher.budget.remaining());
            const { cards: carded, digest: leftover } = splitWindow(
                window.claims,
                cardBudget,
                (claim) => `${subjectWallet(claim.event)}|${claim.event.tokenMint}`,
            );

            for (const claim of carded) {
                if (!dispatcher.budget.canPost()) break;
                dispatcher.budget.consume();
                try {
                    await postCard(claim, solUsdPrice);
                    stats.instant++;
                    log.info('🃏 Card posted: $%s · %s', claim.usd.toFixed(2), claim.event.txSignature.slice(0, 8));
                } catch (err) {
                    stats.postFailures++;
                    log.error('Card post failed for %s: %s', claim.event.txSignature.slice(0, 8), err);
                }
            }

            // Nothing left to summarize: hand the reserved slot back rather
            // than posting a digest that repeats the cards above it.
            if (leftover.length === 0 && window.droppedBelowMin === 0) {
                dispatcher.budget.refund();
                return;
            }

            try {
                // Only the lines that actually ship get enriched, so a busy
                // window costs `digestMaxLines` lookups rather than hundreds.
                const listed = [...leftover]
                    .sort((a, b) => b.usd - a.usd)
                    .slice(0, config.digestMaxLines);
                const subjects = new Map<string, DigestSubject>();
                await Promise.all(listed.map(async ({ event }) => {
                    subjects.set(event.txSignature, await resolveDigestSubject(event));
                }));

                const message = formatDigest(
                    leftover,
                    subjects,
                    {
                        droppedBelowMin: window.droppedBelowMin,
                        totalClaims: leftover.length,
                        totalUsd: leftover.reduce((sum, c) => sum + c.usd, 0),
                        windowSeconds: config.digestIntervalSeconds,
                    },
                    config.digestMaxLines,
                );

                await postToChannel(message);
                stats.digestsPosted++;
                log.info('📊 Digest posted: %d claims · %d carded', leftover.length, carded.length);
            } catch (err) {
                stats.postFailures++;
                log.error('Digest post failed: %s', err);
            }
        })().catch((err) => log.error('Window flush failed: %s', err));
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
