/**
 * WebSocket log classification tests.
 *
 * The regression these guard: discriminators are raw bytes that reach the log
 * stream base64-encoded on a "Program data:" line. A filter that scans the log
 * text for the hex form matches nothing, so the bot stays connected, reports
 * WebSocket mode, and detects zero claims.
 */

import { describe, it, expect } from 'vitest';

import { classifyClaimLogs } from '../claim-logs.js';
import { CLAIM_EVENT_DISCRIMINATORS } from '../types.js';

/** Build the "Program data:" line an Anchor event with this discriminator emits. */
function programDataLine(discHex: string, payloadBytes = 40): string {
    const buf = Buffer.concat([
        Buffer.from(discHex, 'hex'),
        Buffer.alloc(payloadBytes),
    ]);
    return `Program data: ${buf.toString('base64')}`;
}

const COLLECT_CREATOR_FEE_EVENT = '7a027f010ebf0caf';
const CLAIM_CASHBACK_EVENT = 'e2d6f62107f293e5';
const SOCIAL_FEE_PDA_CLAIMED_EVENT = '3212c141edd2eaec';

describe('classifyClaimLogs', () => {
    it('detects a social fee claim from its instruction log line alone', () => {
        // A fake claim on an empty PDA emits no event at all, so the log line is
        // the only trace it leaves.
        const logs = [
            'Program pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ invoke [1]',
            'Program log: Instruction: ClaimSocialFeePda',
            'Program pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ success',
        ];

        expect(classifyClaimLogs(logs)).toEqual({ hasClaim: true, hasCashback: false });
    });

    it('detects a creator fee claim from its event discriminator', () => {
        const logs = [
            'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
            programDataLine(COLLECT_CREATOR_FEE_EVENT),
            'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
        ];

        expect(classifyClaimLogs(logs).hasClaim).toBe(true);
    });

    it('does not detect a creator fee claim from the hex discriminator as text', () => {
        // The exact defect that kept the bot silent: hex never appears in logs.
        const logs = [
            'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
            `Program log: ${COLLECT_CREATOR_FEE_EVENT}`,
            'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
        ];

        expect(classifyClaimLogs(logs).hasClaim).toBe(false);
    });

    it('classifies cashback separately so it can be skipped', () => {
        const logs = [
            'Program log: Instruction: ClaimCashback',
            programDataLine(CLAIM_CASHBACK_EVENT),
        ];

        expect(classifyClaimLogs(logs)).toEqual({ hasClaim: false, hasCashback: true });
    });

    it('reports both when a cashback and a creator claim share a transaction', () => {
        const logs = [
            programDataLine(CLAIM_CASHBACK_EVENT),
            programDataLine(COLLECT_CREATOR_FEE_EVENT),
        ];

        expect(classifyClaimLogs(logs)).toEqual({ hasClaim: true, hasCashback: true });
    });

    it('ignores unrelated program logs', () => {
        const logs = [
            'Program 11111111111111111111111111111111 invoke [1]',
            'Program log: Instruction: Transfer',
            'Program data: bm90LWFuLWV2ZW50',
            'Program 11111111111111111111111111111111 success',
        ];

        expect(classifyClaimLogs(logs)).toEqual({ hasClaim: false, hasCashback: false });
    });

    it('survives malformed base64 on a Program data line', () => {
        const logs = ['Program data: !!!not-base64!!!'];

        expect(() => classifyClaimLogs(logs)).not.toThrow();
    });

    it('recognizes every non-cashback claim event discriminator', () => {
        for (const disc of Object.keys(CLAIM_EVENT_DISCRIMINATORS)) {
            const { hasClaim, hasCashback } = classifyClaimLogs([programDataLine(disc)]);
            if (disc === CLAIM_CASHBACK_EVENT) {
                expect(hasCashback).toBe(true);
            } else {
                expect(hasClaim, `discriminator ${disc} should count as a claim`).toBe(true);
            }
        }
    });

    it('detects the social claim event by discriminator too', () => {
        expect(classifyClaimLogs([programDataLine(SOCIAL_FEE_PDA_CLAIMED_EVENT)]).hasClaim).toBe(true);
    });
});
