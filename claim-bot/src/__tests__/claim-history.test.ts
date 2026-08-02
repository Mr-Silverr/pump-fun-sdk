/**
 * Claim history, /history lookups, and the /top leaderboard.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { FeeClaimEvent } from '../types.js';

const WALLET_A = '8xpMZdyhxL1gGsrSLoJpJ3FtsXooC25UtF6EVWgPoEiS';
const WALLET_B = 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCJ5GEFDM97zC';
const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function claim(overrides: Partial<FeeClaimEvent> = {}): FeeClaimEvent {
    return {
        txSignature: `sig_${Math.random().toString(36).slice(2)}`,
        slot: 300_000_000,
        timestamp: nowSeconds(),
        claimerWallet: WALLET_A,
        tokenMint: '',
        amountSol: 1,
        amountLamports: 1_000_000_000,
        claimType: 'collect_creator_fee',
        isCashback: false,
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        claimLabel: 'Collect Creator Fee (Pump)',
        quoteTicker: 'SOL',
        amountQuote: 1,
        isStableQuote: false,
        ...overrides,
    };
}

describe('claim history', () => {
    let history: typeof import('../claim-history.js');

    beforeEach(async () => {
        vi.resetModules();
        vi.doMock('node:fs', () => ({
            existsSync: vi.fn(() => false),
            mkdirSync: vi.fn(),
            readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
            writeFileSync: vi.fn(),
        }));
        vi.doMock('../logger.js', () => ({
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        }));
        history = await import('../claim-history.js');
        history.resetHistoryForTest();
    });

    it('records a claim in the quote currency it was paid in', () => {
        const record = history.recordClaim(claim({
            amountQuote: 1500.25,
            quoteTicker: 'USDC',
            isStableQuote: true,
            amountSol: 0,
        }));

        expect(record.amount).toBe(1500.25);
        expect(record.ticker).toBe('USDC');
        expect(record.isStableQuote).toBe(true);
    });

    it('returns recent claims newest first', () => {
        history.recordClaim(claim({ txSignature: 'first' }));
        history.recordClaim(claim({ txSignature: 'second' }));

        expect(history.recentClaims(5).map((r) => r.txSignature)).toEqual(['second', 'first']);
    });

    it('finds claims by mint, claimer, or recipient', () => {
        history.recordClaim(claim({ txSignature: 'byMint', tokenMint: MINT, claimerWallet: WALLET_B }));
        history.recordClaim(claim({ txSignature: 'byClaimer', claimerWallet: WALLET_A }));
        history.recordClaim(claim({ txSignature: 'byRecipient', claimerWallet: WALLET_B, recipientWallet: WALLET_A }));

        expect(history.claimsFor(MINT).map((r) => r.txSignature)).toEqual(['byMint']);
        expect(history.claimsFor(WALLET_A).map((r) => r.txSignature)).toEqual(['byRecipient', 'byClaimer']);
    });

    it('ignores unrelated addresses', () => {
        history.recordClaim(claim({ claimerWallet: WALLET_A }));

        expect(history.claimsFor(WALLET_B)).toHaveLength(0);
    });

    it('stays bounded at MAX_RECORDS', () => {
        for (let i = 0; i < history.MAX_RECORDS + 50; i++) {
            history.recordClaim(claim({ txSignature: `sig_${i}` }));
        }

        expect(history.totalRecords()).toBe(history.MAX_RECORDS);
        // The oldest entries are the ones dropped.
        expect(history.claimsFor(WALLET_A, 1)[0]!.txSignature).toBe(`sig_${history.MAX_RECORDS + 49}`);
    });

    it('ranks the leaderboard by SOL claimed', () => {
        history.recordClaim(claim({ claimerWallet: WALLET_A, amountQuote: 2 }));
        history.recordClaim(claim({ claimerWallet: WALLET_A, amountQuote: 3 }));
        history.recordClaim(claim({ claimerWallet: WALLET_B, amountQuote: 4 }));

        const rows = history.topClaimers(24);

        expect(rows).toHaveLength(2);
        expect(rows[0]!.wallet).toBe(WALLET_A);
        expect(rows[0]!.totals.SOL).toBe(5);
        expect(rows[0]!.claims).toBe(2);
        expect(rows[1]!.wallet).toBe(WALLET_B);
    });

    it('keeps SOL and USDC totals apart instead of summing them', () => {
        history.recordClaim(claim({ claimerWallet: WALLET_A, amountQuote: 2 }));
        history.recordClaim(claim({
            claimerWallet: WALLET_A,
            amountQuote: 500,
            quoteTicker: 'USDC',
            isStableQuote: true,
        }));

        const [row] = history.topClaimers(24);

        expect(row!.totals).toEqual({ SOL: 2, USDC: 500 });
    });

    it('credits a social claim to its recipient, not the signer that paid gas', () => {
        history.recordClaim(claim({
            claimerWallet: WALLET_B,
            recipientWallet: WALLET_A,
            claimType: 'claim_social_fee_pda',
            amountQuote: 7,
        }));

        expect(history.topClaimers(24)[0]!.wallet).toBe(WALLET_A);
    });

    it('excludes claims older than the window', () => {
        history.recordClaim(claim({ timestamp: nowSeconds() - 3 * 3600, amountQuote: 9 }));
        history.recordClaim(claim({ timestamp: nowSeconds(), amountQuote: 1 }));

        expect(history.windowSummary(1).claims).toBe(1);
        expect(history.windowSummary(1).totals.SOL).toBe(1);
        expect(history.windowSummary(24).claims).toBe(2);
    });

    it('summarizes distinct wallets in the window', () => {
        history.recordClaim(claim({ claimerWallet: WALLET_A }));
        history.recordClaim(claim({ claimerWallet: WALLET_A }));
        history.recordClaim(claim({ claimerWallet: WALLET_B }));

        expect(history.windowSummary(24).wallets).toBe(2);
    });
});
