/**
 * PumpFun Claim Bot - Inline Keyboards
 *
 * Buttons attached to notifications and lists, plus the encoding of their
 * callback data.
 *
 * Telegram caps callback data at 64 bytes, so nothing here embeds an address.
 * Buttons carry a short verb and a tracked-item id; anything larger is looked
 * up server side when the button is pressed.
 */

import { InlineKeyboard } from 'grammy';

import { loadAffiliates, venueLinks } from './affiliates.js';
import type { ClaimRecord, FeeClaimEvent, TrackedItem } from './types.js';

export const CALLBACK_PREFIX = {
    untrack: 'ut',
    history: 'hi',
} as const;

export function encodeCallback(action: keyof typeof CALLBACK_PREFIX, id: string): string {
    return `${CALLBACK_PREFIX[action]}:${id}`;
}

export function decodeCallback(data: string): { action: keyof typeof CALLBACK_PREFIX; id: string } | null {
    const [prefix, ...rest] = data.split(':');
    const id = rest.join(':');
    if (!prefix || !id) return null;
    for (const [action, code] of Object.entries(CALLBACK_PREFIX)) {
        if (code === prefix) return { action: action as keyof typeof CALLBACK_PREFIX, id };
    }
    return null;
}

/** Buttons under a claim notification: inspect the claim, or stop tracking it. */
export function claimKeyboard(event: FeeClaimEvent, item: TrackedItem): InlineKeyboard {
    const keyboard = new InlineKeyboard()
        .url('🔍 Transaction', `https://solscan.io/tx/${event.txSignature}`)
        .url('👤 Wallet', `https://solscan.io/account/${event.claimerWallet}`);

    const mint = event.tokenMint || (item.type === 'token' ? item.value : '');
    if (mint) {
        keyboard.row().url('🚀 pump.fun', `https://pump.fun/coin/${mint}`);
    }

    // Trading venues, two per row: a claim is exactly when someone wants to look
    // at the coin, and a four-button row renders too narrow to read on mobile.
    const venues = venueLinks(loadAffiliates(), mint || undefined);
    venues.forEach((venue, index) => {
        if (index % 2 === 0) keyboard.row();
        keyboard.url(venue.label, venue.url);
    });

    keyboard.row()
        .text('📜 History', encodeCallback('history', item.id))
        .text('🔕 Untrack', encodeCallback('untrack', item.id));

    return keyboard;
}

/** One untrack button per tracked item, two per row. */
export function trackedListKeyboard(items: TrackedItem[]): InlineKeyboard | undefined {
    if (items.length === 0) return undefined;

    const keyboard = new InlineKeyboard();
    items.forEach((item, index) => {
        const name = item.label
            || (item.type === 'xhandle' ? `@${item.value}` : `${item.value.slice(0, 4)}…${item.value.slice(-4)}`);
        keyboard.text(`🔕 ${name}`, encodeCallback('untrack', item.id));
        if (index % 2 === 1) keyboard.row();
    });
    return keyboard;
}

/** Link out to the transactions behind a /history listing. */
export function historyKeyboard(records: ClaimRecord[]): InlineKeyboard | undefined {
    if (records.length === 0) return undefined;
    const keyboard = new InlineKeyboard();
    records.slice(0, 3).forEach((record, index) => {
        keyboard.url(`TX ${index + 1}`, `https://solscan.io/tx/${record.txSignature}`);
    });
    return keyboard;
}
