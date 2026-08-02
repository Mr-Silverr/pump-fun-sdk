/**
 * PumpFun Claim Bot - Per-chat Settings
 *
 * Alert preferences that belong to a chat rather than to a tracked item:
 * a minimum claim size, and a mute switch.
 *
 * Kept in its own file (and its own JSON) so a settings write can never
 * corrupt the tracking store, and so muting is not the same thing as untracking.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { log } from './logger.js';
import { DATA_DIR, ensureDataDir, mirrorState } from './state-store.js';
import { DEFAULT_CHAT_SETTINGS, type ChatSettings } from './types.js';

const STATE_NAME = 'settings.json';
const SETTINGS_FILE = join(DATA_DIR, STATE_NAME);

/** Highest accepted minimum. Above this a user has effectively muted the chat. */
export const MAX_MIN_AMOUNT = 10_000;
/** Whale alerts cover the whole chain, so the floor keeps the firehose sane. */
export const MIN_WHALE_USD = 100;
export const MAX_WHALE_USD = 10_000_000;

const settings = new Map<number, ChatSettings>();

export function loadSettings(): void {
    try {
        ensureDataDir();
        if (!existsSync(SETTINGS_FILE)) {
            log.info('No saved chat settings, using defaults');
            return;
        }
        const entries: ChatSettings[] = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
        for (const entry of entries) {
            settings.set(entry.chatId, entry);
        }
        log.info('Loaded settings for %d chat(s)', entries.length);
    } catch (err) {
        log.warn('Failed to load chat settings: %s', err);
    }
}

function saveSettings(): void {
    try {
        ensureDataDir();
        writeFileSync(SETTINGS_FILE, JSON.stringify([...settings.values()], null, 2), 'utf-8');
        mirrorState(STATE_NAME);
    } catch (err) {
        log.error('Failed to save chat settings: %s', err);
    }
}

export function getSettings(chatId: number): ChatSettings {
    return settings.get(chatId) ?? { chatId, ...DEFAULT_CHAT_SETTINGS };
}

function update(chatId: number, patch: Partial<ChatSettings>): ChatSettings {
    const next: ChatSettings = { ...getSettings(chatId), ...patch, chatId, updatedAt: Date.now() };
    settings.set(chatId, next);
    saveSettings();
    return next;
}

/**
 * Set the minimum claim size for a chat.
 *
 * The threshold is compared in the claim's own quote currency, so "0.5" means
 * 0.5 SOL on a SOL-quoted claim and 0.5 USDC on a USDC-quoted one. Comparing
 * across currencies would need a live price feed, and a wrong conversion here
 * silently drops alerts the user asked for.
 */
export function setMinAmount(chatId: number, minAmount: number): ChatSettings {
    if (!Number.isFinite(minAmount) || minAmount < 0 || minAmount > MAX_MIN_AMOUNT) {
        throw new RangeError(`Minimum must be between 0 and ${MAX_MIN_AMOUNT}`);
    }
    return update(chatId, { minAmount });
}

/**
 * Subscribe a chat to claims above a USD value anywhere on PumpFun, tracked or
 * not. Pass 0 to turn it off.
 */
export function setWhaleThreshold(chatId: number, whaleMinUsd: number): ChatSettings {
    if (!Number.isFinite(whaleMinUsd) || whaleMinUsd < 0) {
        throw new RangeError('Whale threshold must be a positive number, or 0 to disable');
    }
    if (whaleMinUsd > 0 && (whaleMinUsd < MIN_WHALE_USD || whaleMinUsd > MAX_WHALE_USD)) {
        throw new RangeError(`Whale threshold must be between $${MIN_WHALE_USD} and $${MAX_WHALE_USD}`);
    }
    return update(chatId, { whaleMinUsd });
}

/** Chats that asked for whale alerts, with their thresholds. Muted chats excluded. */
export function whaleSubscribers(): ChatSettings[] {
    return [...settings.values()].filter((chat) => chat.whaleMinUsd > 0 && !chat.muted);
}

export function setMuted(chatId: number, muted: boolean): ChatSettings {
    return update(chatId, { muted });
}

/** Whether a claim of this size should reach this chat. */
export function shouldNotify(chatId: number, amount: number): boolean {
    const chat = getSettings(chatId);
    if (chat.muted) return false;
    return amount >= chat.minAmount;
}

/** Test seam: drop in-memory state without touching disk. */
export function resetSettingsForTest(): void {
    settings.clear();
}
