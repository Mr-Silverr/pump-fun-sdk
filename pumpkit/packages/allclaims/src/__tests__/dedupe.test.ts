import { describe, expect, it } from 'vitest';

import { dedupeWithinTransaction, type DecodedClaim } from '../claim-monitor.js';
import type { ClaimType, FeeClaimEvent } from '../types.js';

/**
 * A creator claiming from both venues in one transaction matches a claim
 * instruction in the pump program and in the pumpswap program, but only one of
 * them emits a claim event. The other is priced from the signer's balance
 * change and lands on the identical figure, which used to post the claim twice
 * and double the digest total. These cases pin that behavior down.
 */
function decoded(
    amountLamports: number,
    amountFromEvent: boolean,
    claimType: ClaimType = 'collect_creator_fee',
): DecodedClaim {
    const event: FeeClaimEvent = {
        amountLamports,
        amountQuote: amountLamports / 1e9,
        amountSol: amountLamports / 1e9,
        claimLabel: claimType,
        claimType,
        claimerWallet: 'Wa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        isCashback: false,
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        slot: 1,
        timestamp: 1_700_000_000,
        tokenMint: '',
        txSignature: 'SigAAAA',
    };
    return { amountFromEvent, event };
}

describe('dedupeWithinTransaction', () => {
    it('drops the fallback-priced twin of an event-priced claim', () => {
        const kept = dedupeWithinTransaction([
            decoded(1_000_000, true, 'collect_coin_creator_fee'),
            decoded(1_000_000, false, 'collect_creator_fee'),
        ]);
        expect(kept).toHaveLength(1);
        expect(kept[0]!.event.claimType).toBe('collect_coin_creator_fee');
    });

    it('drops the twin even though the transaction fee shifts its amount', () => {
        // The fallback reads the signer's balance delta, which is the claim
        // minus the fee, so the two never match to the lamport.
        const kept = dedupeWithinTransaction([
            decoded(236_388_118, true, 'collect_creator_fee'),
            decoded(236_383_118, false, 'collect_coin_creator_fee'),
        ]);
        expect(kept).toHaveLength(1);
        expect(kept[0]!.event.amountLamports).toBe(236_388_118);
    });

    it('drops the twin regardless of which instruction decoded first', () => {
        const kept = dedupeWithinTransaction([
            decoded(1_000_000, false, 'transfer_creator_fees_to_pump'),
            decoded(1_000_000, true, 'distribute_creator_fees'),
        ]);
        expect(kept).toHaveLength(1);
        expect(kept[0]!.event.claimType).toBe('distribute_creator_fees');
    });

    it('keeps genuinely distinct claims in one transaction', () => {
        const kept = dedupeWithinTransaction([
            decoded(1_000_000, true),
            decoded(2_500_000, true),
        ]);
        expect(kept).toHaveLength(2);
    });

    it('keeps two same-amount claims that each carry their own event', () => {
        const kept = dedupeWithinTransaction([
            decoded(1_000_000, true, 'collect_creator_fee'),
            decoded(1_000_000, true, 'collect_coin_creator_fee'),
        ]);
        expect(kept).toHaveLength(2);
    });

    it('keeps a lone fallback-priced claim', () => {
        expect(dedupeWithinTransaction([decoded(1_000_000, false)])).toHaveLength(1);
    });

    it('passes an empty transaction through', () => {
        expect(dedupeWithinTransaction([])).toHaveLength(0);
    });
});
