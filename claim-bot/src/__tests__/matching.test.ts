/**
 * Claim-to-tracked-item matching tests.
 *
 * The regression these guard: collect_creator_fee and collect_coin_creator_fee
 * sweep a creator vault and name no mint, so matching on `event.tokenMint`
 * alone notifies nobody for the most common claim on chain.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { FeeClaimEvent } from '../types.js';

const CREATOR = '8xpMZdyhxL1gGsrSLoJpJ3FtsXooC25UtF6EVWgPoEiS';
const OTHER_WALLET = 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCJ5GEFDM97zC';
const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

function claimEvent(overrides: Partial<FeeClaimEvent> = {}): FeeClaimEvent {
    return {
        txSignature: 'sig_match_test',
        slot: 300_000_000,
        timestamp: 1_700_000_000,
        claimerWallet: CREATOR,
        tokenMint: '',
        amountSol: 0.42,
        amountLamports: 420_000_000,
        claimType: 'collect_creator_fee',
        isCashback: false,
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        claimLabel: 'Collect Creator Fee (Pump)',
        ...overrides,
    };
}

describe('claim matching', () => {
    let store: typeof import('../store.js');
    let findMatchingTracks: typeof import('../bot.js').findMatchingTracks;

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
            setLogLevel: vi.fn(),
        }));
        // No network in unit tests: the PumpFun lookups are exercised for real by
        // the live dry run, not here.
        vi.doMock('../pump-client.js', () => ({
            fetchTokenInfo: vi.fn(async () => null),
            fetchCoinsByCreator: vi.fn(async () => []),
            fetchXHandlesForWallet: vi.fn(async (wallet: string) =>
                wallet === CREATOR ? new Set(['dorklon_must']) : new Set<string>(),
            ),
            getXHandleFromToken: vi.fn(() => null),
        }));

        store = await import('../store.js');
        store.loadTracked();
        ({ findMatchingTracks } = await import('../bot.js'));
    });

    it('matches a wallet-level claim through the tracked token creator', async () => {
        store.addTrackedItem(100, 1, 'token', MINT, 'Tracked', CREATOR);

        const matches = await findMatchingTracks(claimEvent());

        expect(matches).toHaveLength(1);
        expect(matches[0]!.value).toBe(MINT);
    });

    it('ignores a claim by an unrelated wallet', async () => {
        store.addTrackedItem(100, 1, 'token', MINT, 'Tracked', CREATOR);

        const matches = await findMatchingTracks(claimEvent({ claimerWallet: OTHER_WALLET }));

        expect(matches).toHaveLength(0);
    });

    it('still matches on the mint when the claim carries one', async () => {
        store.addTrackedItem(100, 1, 'token', MINT, 'Tracked');

        const matches = await findMatchingTracks(
            claimEvent({ claimerWallet: OTHER_WALLET, tokenMint: MINT, claimType: 'distribute_creator_fees' }),
        );

        expect(matches).toHaveLength(1);
    });

    it('matches a social fee claim through the recipient wallet', async () => {
        store.addTrackedItem(100, 1, 'token', MINT, 'Tracked', CREATOR);

        const matches = await findMatchingTracks(
            claimEvent({
                claimerWallet: OTHER_WALLET,
                recipientWallet: CREATOR,
                claimType: 'claim_social_fee_pda',
            }),
        );

        expect(matches).toHaveLength(1);
    });

    it('matches a tracked X handle through the claiming wallet coins', async () => {
        store.addTrackedItem(100, 1, 'xhandle', 'dorklon_must');

        const matches = await findMatchingTracks(claimEvent());

        expect(matches).toHaveLength(1);
        expect(matches[0]!.type).toBe('xhandle');
    });

    it('returns each tracked item once when several match paths hit', async () => {
        store.addTrackedItem(100, 1, 'token', MINT, 'Tracked', CREATOR);

        const matches = await findMatchingTracks(
            claimEvent({ tokenMint: MINT, recipientWallet: CREATOR }),
        );

        expect(matches).toHaveLength(1);
    });

    it('backfills the creator wallet onto an already tracked mint', async () => {
        store.addTrackedItem(100, 1, 'token', MINT, 'Tracked');
        expect(await findMatchingTracks(claimEvent())).toHaveLength(0);

        store.setCreatorWalletForMint(MINT, CREATOR);

        expect(await findMatchingTracks(claimEvent())).toHaveLength(1);
    });
});
