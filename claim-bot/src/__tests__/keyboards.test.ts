/**
 * Inline keyboard callback encoding.
 *
 * Telegram rejects callback data over 64 bytes, and a silently rejected button
 * looks like a dead button to the user, so the encoding stays short and the
 * decoder never trusts what comes back.
 */

import { describe, it, expect } from 'vitest';

import {
    claimKeyboard,
    decodeCallback,
    encodeCallback,
    historyKeyboard,
    trackedListKeyboard,
} from '../keyboards.js';
import type { FeeClaimEvent, TrackedItem } from '../types.js';

const item: TrackedItem = {
    id: 't_1754000000001',
    chatId: 100,
    addedBy: 1,
    type: 'token',
    value: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
    createdAt: 1_700_000_000_000,
};

const event: FeeClaimEvent = {
    txSignature: '5MThTVd6rWHDktftiRqsDLHy4kxZWz2AKin82AK2yyZCBPXB4npXpQhixYv5',
    slot: 300_000_000,
    timestamp: 1_700_000_000,
    claimerWallet: '8xpMZdyhxL1gGsrSLoJpJ3FtsXooC25UtF6EVWgPoEiS',
    tokenMint: item.value,
    amountSol: 1.5,
    amountLamports: 1_500_000_000,
    claimType: 'collect_creator_fee',
    isCashback: false,
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    claimLabel: 'Collect Creator Fee (Pump)',
};

describe('callback data', () => {
    it('round-trips an action and an item id', () => {
        expect(decodeCallback(encodeCallback('untrack', item.id))).toEqual({
            action: 'untrack',
            id: item.id,
        });
        expect(decodeCallback(encodeCallback('history', item.id))).toEqual({
            action: 'history',
            id: item.id,
        });
    });

    it('stays inside the 64-byte callback limit Telegram enforces', () => {
        const encoded = encodeCallback('untrack', item.id);

        expect(Buffer.byteLength(encoded, 'utf8')).toBeLessThanOrEqual(64);
    });

    it('rejects unknown or malformed data instead of guessing', () => {
        expect(decodeCallback('')).toBeNull();
        expect(decodeCallback('nope')).toBeNull();
        expect(decodeCallback('zz:t_1')).toBeNull();
        expect(decodeCallback('ut:')).toBeNull();
    });
});

describe('keyboards', () => {
    it('builds claim buttons with the tx, wallet, coin, history and untrack', () => {
        const rows = claimKeyboard(event, item).inline_keyboard;
        const labels = rows.flat().map((b) => b.text);

        expect(labels).toContain('🔍 Transaction');
        expect(labels).toContain('👤 Wallet');
        expect(labels).toContain('🚀 pump.fun');
        expect(labels).toContain('📜 History');
        expect(labels).toContain('🔕 Untrack');
    });

    it('omits the coin link for a wallet-level claim on a tracked wallet', () => {
        const walletItem: TrackedItem = { ...item, type: 'wallet', value: event.claimerWallet };
        const rows = claimKeyboard({ ...event, tokenMint: '' }, walletItem).inline_keyboard;

        expect(rows.flat().map((b) => b.text)).not.toContain('🚀 pump.fun');
    });

    it('gives every tracked item its own untrack button', () => {
        const items: TrackedItem[] = [
            item,
            { ...item, id: 't_2', type: 'xhandle', value: 'dorklon_must' },
            { ...item, id: 't_3', type: 'wallet', value: event.claimerWallet, label: 'Dev' },
        ];

        const buttons = trackedListKeyboard(items)!.inline_keyboard.flat();

        expect(buttons).toHaveLength(3);
        expect(buttons.map((b) => b.text)).toEqual(['🔕 FeMb…pump', '🔕 @dorklon_must', '🔕 Dev']);
    });

    it('returns no keyboard when there is nothing to show', () => {
        expect(trackedListKeyboard([])).toBeUndefined();
        expect(historyKeyboard([])).toBeUndefined();
    });
});
