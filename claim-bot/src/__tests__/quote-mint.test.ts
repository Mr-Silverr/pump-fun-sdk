/**
 * Quote-currency rendering tests.
 *
 * PumpFun coins can be quoted in USDC as well as SOL, and the claim event
 * carries the amount in base units of that quote mint. Rendering a USDC amount
 * as SOL reports both the wrong number and the wrong currency.
 */

import { describe, it, expect, vi } from 'vitest';

import type { FeeClaimEvent, TrackedItem } from '../types.js';
import { QUOTE_MINT_INFO, USDC_MINT, WSOL_MINT } from '../types.js';

vi.mock('../twitter-client.js', () => ({
    formatFollowerCount: vi.fn((n: number) => `${n}`),
}));

const { formatClaimNotification } = await import('../formatters.js');

const item: TrackedItem = {
    id: 't_quote',
    chatId: 100,
    addedBy: 1,
    type: 'token',
    value: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
    createdAt: 1_700_000_000_000,
};

function event(overrides: Partial<FeeClaimEvent>): FeeClaimEvent {
    return {
        txSignature: 'sig_quote_test',
        slot: 300_000_000,
        timestamp: 1_700_000_000,
        claimerWallet: '8xpMZdyhxL1gGsrSLoJpJ3FtsXooC25UtF6EVWgPoEiS',
        tokenMint: item.value,
        amountSol: 0,
        amountLamports: 0,
        claimType: 'collect_creator_fee',
        isCashback: false,
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        claimLabel: 'Collect Creator Fee (Pump)',
        ...overrides,
    };
}

describe('quote currency', () => {
    it('knows the decimals for both supported quote mints', () => {
        expect(QUOTE_MINT_INFO[WSOL_MINT]).toEqual({ ticker: 'SOL', decimals: 9, isStable: false });
        expect(QUOTE_MINT_INFO[USDC_MINT]).toEqual({ ticker: 'USDC', decimals: 6, isStable: true });
    });

    it('renders a SOL claim in SOL', () => {
        const html = formatClaimNotification(
            event({
                amountLamports: 1_250_000_000,
                amountSol: 1.25,
                quoteMint: WSOL_MINT,
                quoteTicker: 'SOL',
                isStableQuote: false,
                amountQuote: 1.25,
            }),
            item,
            null,
        );

        expect(html).toContain('1.2500 SOL');
    });

    it('renders a USDC claim in USDC, not as a SOL amount', () => {
        // 147_050_400_000 base units of USDC is 147,050.40 USDC. Divided by 1e9
        // it would read as 147.05 SOL: right digits, wrong scale, wrong currency.
        const html = formatClaimNotification(
            event({
                amountLamports: 147_050_400_000,
                amountSol: 0,
                quoteMint: USDC_MINT,
                quoteTicker: 'USDC',
                isStableQuote: true,
                amountQuote: 147_050.4,
            }),
            item,
            null,
        );

        expect(html).toContain('147050.40 USDC');
        expect(html).not.toContain('147.0504 SOL');
    });

    it('falls back to SOL when an event predates quote mints', () => {
        const html = formatClaimNotification(
            event({ amountLamports: 500_000_000, amountSol: 0.5 }),
            item,
            null,
        );

        expect(html).toContain('0.5000 SOL');
    });
});
