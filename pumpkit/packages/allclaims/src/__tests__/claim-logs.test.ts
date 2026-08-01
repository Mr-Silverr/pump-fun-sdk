import { describe, expect, it } from 'vitest';

import { classifyClaimLogs } from '../claim-monitor.js';

/** Build a "Program data:" log line carrying an 8-byte event discriminator. */
function programData(discHex: string, extraBytes = 40): string {
    const bytes = Buffer.concat([Buffer.from(discHex, 'hex'), Buffer.alloc(extraBytes)]);
    return `Program data: ${bytes.toString('base64')}`;
}

const INVOKE = 'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]';
const SUCCESS = 'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success';

describe('classifyClaimLogs', () => {
    it('ignores ordinary trades', () => {
        expect(classifyClaimLogs([
            INVOKE,
            'Program log: Instruction: Buy',
            programData('bddb7fd34ee661ee'), // TradeEvent
            SUCCESS,
        ])).toEqual({ hasClaim: false, hasCashback: false });
    });

    it('detects social fee claims from the instruction log alone', () => {
        // This instruction emits no event on a fake claim, so the log line is
        // the only signal that the transaction exists.
        expect(classifyClaimLogs([
            INVOKE,
            'Program log: Instruction: ClaimSocialFeePda',
            SUCCESS,
        ])).toEqual({ hasClaim: true, hasCashback: false });
    });

    it('detects a pure creator fee claim that carries no social instruction log', () => {
        // Regression: a filter keyed only on ClaimSocialFeePda dropped every
        // one of these, which is the entire point of an all-claims feed.
        expect(classifyClaimLogs([
            INVOKE,
            'Program log: Instruction: CollectCreatorFee',
            programData('7a027f010ebf0caf'), // CollectCreatorFeeEvent
            SUCCESS,
        ])).toEqual({ hasClaim: true, hasCashback: false });
    });

    it('detects a creator fee claim from its event alone, with no instruction log', () => {
        expect(classifyClaimLogs([
            INVOKE,
            programData('e8f5c2eeeada3a59'), // CollectCoinCreatorFeeEvent
            SUCCESS,
        ])).toEqual({ hasClaim: true, hasCashback: false });
    });

    it('detects fee distributions', () => {
        expect(classifyClaimLogs([
            INVOKE,
            programData('a537817004b3ca28'), // DistributeCreatorFeesEvent
            SUCCESS,
        ])).toEqual({ hasClaim: true, hasCashback: false });
    });

    it('reports cashback separately so it can be skipped before fetching', () => {
        expect(classifyClaimLogs([
            INVOKE,
            'Program log: Instruction: ClaimCashback',
            programData('e2d6f62107f293e5'), // ClaimCashbackEvent
            SUCCESS,
        ])).toEqual({ hasClaim: false, hasCashback: true });
    });

    it('reports both when a transaction carries a claim and a cashback', () => {
        expect(classifyClaimLogs([
            INVOKE,
            'Program log: Instruction: CollectCreatorFee',
            programData('7a027f010ebf0caf'),
            'Program log: Instruction: ClaimCashback',
            programData('e2d6f62107f293e5'),
            SUCCESS,
        ])).toEqual({ hasClaim: true, hasCashback: true });
    });

    it('matches V2 instruction names, which extend the V1 names', () => {
        expect(classifyClaimLogs([
            INVOKE,
            'Program log: Instruction: CollectCreatorFeeV2',
            SUCCESS,
        ])).toEqual({ hasClaim: true, hasCashback: false });
    });

    it('survives malformed and truncated Program data lines', () => {
        expect(classifyClaimLogs([
            'Program data: not-valid-base64!!!',
            'Program data: ',
            'Program data:',
            programData('7a027f010ebf', 0), // shorter than an 8-byte discriminator
        ])).toEqual({ hasClaim: false, hasCashback: false });
    });

    it('handles an empty log array', () => {
        expect(classifyClaimLogs([])).toEqual({ hasClaim: false, hasCashback: false });
    });
});
