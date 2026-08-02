import { describe, expect, it } from 'vitest';

import { ClaimDispatcher, PostBudget, splitWindow } from '../dispatcher.js';
import type { ValuedClaim } from '../formatters.js';
import type { FeeClaimEvent } from '../types.js';

function claim(usd: number, mint = 'MintOne'): ValuedClaim {
    const event: FeeClaimEvent = {
        amountLamports: Math.round(usd * 1e7),
        amountSol: usd / 100,
        claimLabel: 'Collect Creator Fee (Pump)',
        claimType: 'collect_creator_fee',
        claimerWallet: 'Wallet1111111111111111111111111111111111111',
        isCashback: false,
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        slot: 1,
        timestamp: 1_700_000_000,
        tokenMint: mint,
        txSignature: `sig-${usd}-${mint}`,
    };
    return { event, usd };
}

const CONFIG = { instantThresholdUsd: 100, maxPostsPerMinute: 15, minClaimUsd: 0 };

describe('PostBudget', () => {
    it('allows up to the cap within a rolling minute', () => {
        const budget = new PostBudget(3);
        const t0 = 1_000_000;
        expect(budget.remaining(t0)).toBe(3);
        budget.consume(t0);
        budget.consume(t0 + 100);
        budget.consume(t0 + 200);
        expect(budget.canPost(t0 + 300)).toBe(false);
        expect(budget.remaining(t0 + 300)).toBe(0);
    });

    it('frees slots once they age out of the window', () => {
        const budget = new PostBudget(2);
        const t0 = 1_000_000;
        budget.consume(t0);
        budget.consume(t0 + 1_000);
        expect(budget.canPost(t0 + 2_000)).toBe(false);
        // First slot expires 60s after it was taken.
        expect(budget.canPost(t0 + 60_001)).toBe(true);
        expect(budget.remaining(t0 + 60_001)).toBe(1);
        expect(budget.remaining(t0 + 61_001)).toBe(2);
    });
});

describe('ClaimDispatcher.route', () => {
    it('sends claims at or above the threshold instantly', () => {
        const d = new ClaimDispatcher(CONFIG);
        expect(d.route(claim(250))).toBe('instant');
        expect(d.route(claim(100))).toBe('instant');
    });

    it('buffers claims below the threshold into the digest', () => {
        const d = new ClaimDispatcher(CONFIG);
        expect(d.route(claim(99.99))).toBe('digest');
        expect(d.route(claim(0.01))).toBe('digest');
    });

    it('drops claims below the configured minimum without counting them as digest claims', () => {
        const d = new ClaimDispatcher({ ...CONFIG, minClaimUsd: 1 });
        expect(d.route(claim(0.5))).toBe('dropped');
        expect(d.route(claim(2))).toBe('digest');
        const window = d.flush();
        expect(window?.totalClaims).toBe(1);
        expect(window?.droppedBelowMin).toBe(1);
    });

    it('demotes instant claims to the digest when the post budget runs out', () => {
        const d = new ClaimDispatcher({ ...CONFIG, maxPostsPerMinute: 3 });
        const t = 1_000_000;
        // 2 instant posts allowed; the 3rd is held back so the digest can post.
        expect(d.route(claim(500, 'a'), t)).toBe('instant');
        expect(d.route(claim(500, 'b'), t)).toBe('instant');
        expect(d.route(claim(500, 'c'), t)).toBe('digest');
        expect(d.budget.remaining(t)).toBe(1);
        // The reserved slot is exactly what lets the digest go out.
        expect(d.flush(t)).not.toBeNull();
    });
});

describe('ClaimDispatcher.flush', () => {
    it('returns null and resets counters when everything went out instantly', () => {
        const d = new ClaimDispatcher(CONFIG);
        d.route(claim(500));
        expect(d.flush()).toBeNull();
        expect(d.getMetrics().pendingClaims).toBe(0);
    });

    it('accumulates totals across the window and clears them after a flush', () => {
        const d = new ClaimDispatcher(CONFIG);
        d.route(claim(10, 'a'));
        d.route(claim(20, 'b'));
        d.route(claim(30, 'c'));
        const window = d.flush();
        expect(window?.totalClaims).toBe(3);
        expect(window?.totalUsd).toBeCloseTo(60);
        expect(window?.claims).toHaveLength(3);
        expect(d.flush()).toBeNull();
    });

    it('rolls the window forward instead of dropping it when no budget is left', () => {
        const d = new ClaimDispatcher({ ...CONFIG, instantThresholdUsd: 1_000_000, maxPostsPerMinute: 1 });
        const t = 1_000_000;
        d.route(claim(10, 'a'), t);
        // Burn the only slot on a digest.
        expect(d.flush(t)).not.toBeNull();
        d.route(claim(20, 'b'), t + 1_000);
        // No budget: the claim stays pending rather than vanishing.
        expect(d.flush(t + 2_000)).toBeNull();
        expect(d.getMetrics().buffered).toBe(1);
        // Once the window frees up, the held claim posts.
        const later = d.flush(t + 61_000);
        expect(later?.totalClaims).toBe(1);
        expect(later?.totalUsd).toBeCloseTo(20);
    });

    it('caps how many claims one window buffers while still counting them', () => {
        const d = new ClaimDispatcher(CONFIG);
        for (let i = 0; i < 600; i++) d.route(claim(1, `mint-${i}`));
        const window = d.flush();
        expect(window?.totalClaims).toBe(600);
        expect(window?.claims.length).toBe(500);
    });
});

describe('splitWindow', () => {
    function claim(usd: number, key: string, sig = key): ValuedClaim {
        return {
            event: { txSignature: sig, tokenMint: key } as unknown as ValuedClaim['event'],
            usd,
        };
    }
    const byMint = (c: ValuedClaim) => c.event.tokenMint;

    it('promotes the biggest claims of the window to cards', () => {
        const { cards, digest } = splitWindow(
            [claim(1, 'a'), claim(50, 'b'), claim(10, 'c')],
            2,
            byMint,
        );
        expect(cards.map((c) => c.usd)).toEqual([50, 10]);
        expect(digest.map((c) => c.usd)).toEqual([1]);
    });

    /**
     * The repetition that made the live channel unreadable: one payout surfaces
     * as several claims on the same coin, and each became its own line.
     */
    it('cards a coin once and keeps its twins in the digest', () => {
        const { cards, digest } = splitWindow(
            [claim(5, 'a', 'sig1'), claim(5, 'a', 'sig2'), claim(4, 'b')],
            6,
            byMint,
        );
        expect(cards).toHaveLength(2);
        expect(cards.map((c) => c.event.tokenMint)).toEqual(['a', 'b']);
        expect(digest).toHaveLength(1);
        expect(digest[0]!.event.txSignature).toBe('sig2');
    });

    it('loses nothing: every claim is either carded or digested', () => {
        const claims = Array.from({ length: 25 }, (_, i) => claim(i + 1, `m${i % 7}`, `sig${i}`));
        const { cards, digest } = splitWindow(claims, 3, byMint);
        expect(cards.length + digest.length).toBe(claims.length);
    });

    it('sends the whole window to the digest when no card budget is left', () => {
        const { cards, digest } = splitWindow([claim(9, 'a'), claim(3, 'b')], 0, byMint);
        expect(cards).toHaveLength(0);
        expect(digest).toHaveLength(2);
    });

    it('treats a negative budget as zero rather than slicing from the end', () => {
        const { cards, digest } = splitWindow([claim(9, 'a')], -4, byMint);
        expect(cards).toHaveLength(0);
        expect(digest).toHaveLength(1);
    });
});

describe('PostBudget.refund', () => {
    it('returns a reserved slot that went unused', () => {
        const budget = new PostBudget(3);
        budget.consume();
        budget.consume();
        expect(budget.remaining()).toBe(1);
        budget.refund();
        expect(budget.remaining()).toBe(2);
    });
});
