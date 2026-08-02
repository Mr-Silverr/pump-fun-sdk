/**
 * PumpFun Claim Bot - WebSocket Log Classification
 *
 * Decides which signatures seen on a `logsSubscribe` stream are worth a
 * transaction fetch. Getting this wrong is silent: the bot stays connected,
 * reports "websocket mode", and detects nothing.
 */

import { CLAIM_EVENT_DISCRIMINATORS } from './types.js';

/**
 * Anchor "Instruction:" log lines that mark a claim transaction.
 *
 * The social-fee entry is load-bearing: `claim_social_fee_pda` can emit no
 * event at all (a fake claim of an empty PDA), so its instruction log line is
 * the only trace it leaves behind.
 */
export const CLAIM_INSTRUCTION_LOG_LINES = [
    'Program log: Instruction: ClaimSocialFeePda',
    'Program log: Instruction: CollectCreatorFee',
    'Program log: Instruction: CollectCoinCreatorFee',
    'Program log: Instruction: DistributeCreatorFees',
    'Program log: Instruction: TransferCreatorFeesToPump',
];

/** Cashback is a trader refund, not creator activity, so it is classified apart. */
export const CASHBACK_INSTRUCTION_LOG_LINE = 'Program log: Instruction: ClaimCashback';
const CLAIM_CASHBACK_EVENT_DISC = 'e2d6f62107f293e5';

export interface ClaimLogClassification {
    /** A creator, distribution, or social fee claim is present. */
    hasClaim: boolean;
    /** A cashback (trader refund) claim is present. */
    hasCashback: boolean;
}

/**
 * Classify a transaction's log lines for claim relevance.
 *
 * Two detection paths, and both are required:
 *
 *  1. Anchor "Instruction:" log lines. `claim_social_fee_pda` returns a struct
 *     rather than emitting a CPI event, so on a fake claim the log line is the
 *     only signal.
 *  2. Claim event discriminators on "Program data:" lines. Creator fee claims do
 *     emit events and carry no social instruction log, so a filter keyed only on
 *     ClaimSocialFeePda silently discards every pure creator fee claim before it
 *     is ever fetched.
 *
 * Discriminators are 8 raw bytes. They appear base64-encoded inside a
 * "Program data:" line and never as hex text, so a substring scan for the hex
 * form matches nothing at all.
 */
export function classifyClaimLogs(logs: string[]): ClaimLogClassification {
    let hasClaim = false;
    let hasCashback = false;

    for (const line of logs) {
        if (!hasClaim && CLAIM_INSTRUCTION_LOG_LINES.some((needle) => line.includes(needle))) {
            hasClaim = true;
        }
        if (!hasCashback && line.includes(CASHBACK_INSTRUCTION_LOG_LINE)) {
            hasCashback = true;
        }

        if (!line.includes('Program data:')) continue;
        const b64 = line.split('Program data: ')[1]?.trim();
        if (!b64) continue;
        try {
            const bytes = Buffer.from(b64, 'base64');
            if (bytes.length < 8) continue;
            const disc = Buffer.from(bytes.subarray(0, 8)).toString('hex');
            if (disc in CLAIM_EVENT_DISCRIMINATORS) {
                if (disc === CLAIM_CASHBACK_EVENT_DISC) hasCashback = true;
                else hasClaim = true;
            }
        } catch {
            // Unparseable log line, ignore it.
        }
    }

    return { hasClaim, hasCashback };
}
