/**
 * PumpFun All-Claims Bot — Dispatcher
 *
 * Flood control between the claim monitor (unbounded event rate) and the
 * Telegram channel (~20 posts/min hard cap). Routing:
 *
 *   claim ≥ instantThresholdUsd AND budget available → individual post now
 *   claim ≥ minClaimUsd                              → buffered into the digest
 *   claim < minClaimUsd                              → counted, not shown
 *
 * The digest flushes on a fixed interval as ONE post summarizing the window.
 * When the post budget is exhausted, instant claims demote into the digest,
 * and an un-postable digest rolls its claims into the next window. Nothing
 * is silently lost: every claim is either posted, digested, or counted.
 */

import type { AllClaimsConfig } from './config.js';
import type { ValuedClaim } from './formatters.js';
import { log } from './logger.js';

/** Sliding-window post budget: at most maxPerMinute sends in any 60s window. */
export class PostBudget {
    private timestamps: number[] = [];

    constructor(private maxPerMinute: number) {}

    /** True when a post is allowed right now (does not consume). */
    canPost(now = Date.now()): boolean {
        this.prune(now);
        return this.timestamps.length < this.maxPerMinute;
    }

    /** Consume one slot. Call only after canPost() returned true. */
    consume(now = Date.now()): void {
        this.prune(now);
        this.timestamps.push(now);
    }

    /**
     * Give a consumed slot back. Used when a post was reserved and then turned
     * out to be unnecessary (an empty digest), so the slot can carry a card
     * instead of being burned on nothing.
     */
    refund(): void {
        this.timestamps.pop();
    }

    /** Posts remaining in the current window. */
    remaining(now = Date.now()): number {
        this.prune(now);
        return Math.max(0, this.maxPerMinute - this.timestamps.length);
    }

    private prune(now: number): void {
        const cutoff = now - 60_000;
        while (this.timestamps.length > 0 && this.timestamps[0]! <= cutoff) {
            this.timestamps.shift();
        }
    }
}

export type Route = 'instant' | 'digest' | 'dropped';

/**
 * Split a window into the claims that deserve their own card and the tail that
 * belongs in the digest.
 *
 * Two things happen here. First, repeats collapse: one payout routinely
 * surfaces as several claims (the AMM vault and the pump vault swept in the
 * same breath, or a claim bot firing repeatedly), and posting each as its own
 * card fills the channel with the same coin. Second, what is left is ranked by
 * value and the top `cardBudget` are promoted.
 *
 * Nothing is discarded: every claim that does not become a card comes back in
 * `digest`, so the window's total still adds up.
 */
export function splitWindow(
    claims: ValuedClaim[],
    cardBudget: number,
    subjectKey: (claim: ValuedClaim) => string,
): { cards: ValuedClaim[]; digest: ValuedClaim[] } {
    const best = new Map<string, ValuedClaim>();
    const repeats: ValuedClaim[] = [];

    for (const claim of [...claims].sort((a, b) => b.usd - a.usd)) {
        const key = subjectKey(claim);
        if (best.has(key)) repeats.push(claim);
        else best.set(key, claim);
    }

    const ranked = [...best.values()].sort((a, b) => b.usd - a.usd);
    const limit = Math.max(0, cardBudget);
    return { cards: ranked.slice(0, limit), digest: [...ranked.slice(limit), ...repeats] };
}

export interface DigestWindow {
    claims: ValuedClaim[];
    totalClaims: number;
    totalUsd: number;
    droppedBelowMin: number;
}

/** Max claims held per digest window; beyond this, claims are counted but not listed. */
const MAX_BUFFERED_CLAIMS = 500;

export class ClaimDispatcher {
    private buffer: ValuedClaim[] = [];
    private totalClaims = 0;
    private totalUsd = 0;
    private droppedBelowMin = 0;
    readonly budget: PostBudget;

    constructor(
        private config: Pick<AllClaimsConfig, 'instantThresholdUsd' | 'minClaimUsd' | 'maxPostsPerMinute'>,
    ) {
        this.budget = new PostBudget(config.maxPostsPerMinute);
    }

    /**
     * Decide how a claim is delivered. Returns the route taken.
     * 'instant' means the caller should post it now (one budget slot is
     * consumed here); 'digest' and 'dropped' need no caller action.
     */
    route(claim: ValuedClaim, now = Date.now()): Route {
        if (claim.usd < this.config.minClaimUsd) {
            this.droppedBelowMin++;
            return 'dropped';
        }

        this.totalClaims++;
        this.totalUsd += claim.usd;

        // Keep at least one budget slot in reserve so the digest can always post.
        if (claim.usd >= this.config.instantThresholdUsd && this.budget.remaining(now) > 1) {
            this.budget.consume(now);
            return 'instant';
        }

        if (this.buffer.length < MAX_BUFFERED_CLAIMS) {
            this.buffer.push(claim);
        }
        return 'digest';
    }

    /** True when the current window holds anything worth posting. */
    hasPending(): boolean {
        return this.totalClaims > 0 || this.droppedBelowMin > 0;
    }

    /**
     * Close the window and return its contents for posting, consuming one
     * budget slot. Returns null when there is nothing to post or no budget;
     * in the no-budget case the window stays open and rolls forward.
     */
    flush(now = Date.now()): DigestWindow | null {
        // Nothing buffered: every claim this window went out as an instant
        // post (or nothing happened). Reset counters, skip the digest.
        if (this.buffer.length === 0 && this.droppedBelowMin === 0) {
            this.totalClaims = 0;
            this.totalUsd = 0;
            return null;
        }
        if (!this.budget.canPost(now)) {
            log.warn('Digest flush deferred: post budget exhausted (%d claims pending)', this.buffer.length);
            return null;
        }
        this.budget.consume(now);

        const window: DigestWindow = {
            claims: this.buffer,
            droppedBelowMin: this.droppedBelowMin,
            totalClaims: this.totalClaims,
            totalUsd: this.totalUsd,
        };
        this.buffer = [];
        this.totalClaims = 0;
        this.totalUsd = 0;
        this.droppedBelowMin = 0;
        return window;
    }

    getMetrics(): Record<string, unknown> {
        return {
            buffered: this.buffer.length,
            pendingClaims: this.totalClaims,
            pendingUsd: Number(this.totalUsd.toFixed(2)),
            postsRemainingThisMinute: this.budget.remaining(),
        };
    }
}
