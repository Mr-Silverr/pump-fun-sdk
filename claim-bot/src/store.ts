/**
 * PumpFun Claim Bot — Track Store
 *
 * In-memory store for tracked tokens and X handles.
 * Persisted to a local JSON file so tracking survives restarts.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { log } from './logger.js';
import { DATA_DIR, ensureDataDir, mirrorState } from './state-store.js';
import type { TrackedItem, TrackType } from './types.js';

const STATE_NAME = 'tracked.json';
const DATA_FILE = join(DATA_DIR, STATE_NAME);

// ============================================================================
// In-memory store
// ============================================================================

const tracked = new Map<string, TrackedItem>();

// ============================================================================
// Persistence
// ============================================================================

export function loadTracked(): void {
    try {
        ensureDataDir();
        if (!existsSync(DATA_FILE)) {
            log.info('No existing tracking data found — starting fresh');
            return;
        }
        const raw = readFileSync(DATA_FILE, 'utf-8');
        const entries: TrackedItem[] = JSON.parse(raw);
        for (const entry of entries) {
            tracked.set(entry.id, entry);
        }
        log.info('Loaded %d tracked items from disk', entries.length);
    } catch (err) {
        log.warn('Failed to load tracked items: %s', err);
    }
}

function saveTracked(): void {
    try {
        ensureDataDir();
        const entries = Array.from(tracked.values());
        writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2), 'utf-8');
        mirrorState(STATE_NAME);
    } catch (err) {
        log.error('Failed to save tracked items: %s', err);
    }
}

// ============================================================================
// CRUD
// ============================================================================

let idCounter = Date.now();

export function addTrackedItem(
    chatId: number,
    addedBy: number,
    type: TrackType,
    value: string,
    label?: string,
    creatorWallet?: string,
): TrackedItem {
    const id = `t_${++idCounter}`;
    const entry: TrackedItem = {
        addedBy,
        chatId,
        createdAt: Date.now(),
        creatorWallet,
        id,
        label,
        type,
        value: value.trim(),
    };
    tracked.set(id, entry);
    saveTracked();
    log.info('Tracked: %s → %s:%s (chat %d)', id, type, value, chatId);
    return entry;
}

/** Look up one tracked item, scoped to the chat that owns it. */
export function getTrackedItem(id: string, chatId: number): TrackedItem | undefined {
    const entry = tracked.get(id);
    if (!entry || entry.chatId !== chatId) return undefined;
    return entry;
}

export function removeTrackedItem(id: string, chatId: number): boolean {
    const entry = tracked.get(id);
    if (!entry || entry.chatId !== chatId) return false;
    tracked.delete(id);
    saveTracked();
    log.info('Untracked: %s', id);
    return true;
}

export function removeTrackedByValue(value: string, chatId: number): boolean {
    const lower = value.toLowerCase();
    for (const [id, entry] of tracked) {
        if (entry.value.toLowerCase() === lower && entry.chatId === chatId) {
            tracked.delete(id);
            saveTracked();
            log.info('Untracked by value: %s (%s)', id, value);
            return true;
        }
    }
    return false;
}

export function getTrackedForChat(chatId: number): TrackedItem[] {
    return Array.from(tracked.values()).filter((t) => t.chatId === chatId);
}

export function getTrackedTokensForChat(chatId: number): TrackedItem[] {
    return Array.from(tracked.values()).filter(
        (t) => t.chatId === chatId && t.type === 'token',
    );
}

export function getTrackedXHandlesForChat(chatId: number): TrackedItem[] {
    return Array.from(tracked.values()).filter(
        (t) => t.chatId === chatId && t.type === 'xhandle',
    );
}

/** Get all tracked token mints across all chats. */
export function getAllTrackedTokenMints(): Set<string> {
    const mints = new Set<string>();
    for (const entry of tracked.values()) {
        if (entry.type === 'token') {
            mints.add(entry.value.toLowerCase());
        }
    }
    return mints;
}

/** Get every tracked token item across all chats. */
export function getAllTrackedTokens(): TrackedItem[] {
    return Array.from(tracked.values()).filter((t) => t.type === 'token');
}

/** Get all tracked X handles across all chats (lowercase, no @). */
export function getAllTrackedXHandles(): Set<string> {
    const handles = new Set<string>();
    for (const entry of tracked.values()) {
        if (entry.type === 'xhandle') {
            handles.add(entry.value.toLowerCase().replace(/^@/, ''));
        }
    }
    return handles;
}

/** Find all tracked items that match a given token mint. */
export function findMatchingTokenTracks(mint: string): TrackedItem[] {
    const lower = mint.toLowerCase();
    return Array.from(tracked.values()).filter(
        (t) => t.type === 'token' && t.value.toLowerCase() === lower,
    );
}

/**
 * Find all tracked tokens whose creator wallet is the given address.
 *
 * This is how wallet-level claims (collect_creator_fee, collect_coin_creator_fee)
 * reach a tracked token: those instructions sweep a creator vault and name no
 * mint at all, so the claimer wallet is the only link back to the token.
 */
export function findTracksByCreatorWallet(wallet: string): TrackedItem[] {
    if (!wallet) return [];
    return Array.from(tracked.values()).filter(
        (t) => t.type === 'token' && t.creatorWallet === wallet,
    );
}

/**
 * Find tracked wallets matching an address.
 *
 * Separate from the creator-wallet lookup above: this is the user saying "tell
 * me what this wallet claims", regardless of which token the fees came from.
 */
export function findTracksByWallet(wallet: string): TrackedItem[] {
    if (!wallet) return [];
    return Array.from(tracked.values()).filter(
        (t) => t.type === 'wallet' && t.value === wallet,
    );
}

/** Every wallet address tracked directly, across all chats. */
export function getAllTrackedWallets(): Set<string> {
    const wallets = new Set<string>();
    for (const entry of tracked.values()) {
        if (entry.type === 'wallet') wallets.add(entry.value);
    }
    return wallets;
}

/** Every creator wallet across tracked tokens, mapped to the items that use it. */
export function getTrackedCreatorWallets(): Set<string> {
    const wallets = new Set<string>();
    for (const entry of tracked.values()) {
        if (entry.type === 'token' && entry.creatorWallet) {
            wallets.add(entry.creatorWallet);
        }
    }
    return wallets;
}

/** Backfill the creator wallet on every tracked token that shares this mint. */
export function setCreatorWalletForMint(mint: string, creatorWallet: string): void {
    const lower = mint.toLowerCase();
    let changed = false;
    for (const entry of tracked.values()) {
        if (entry.type !== 'token') continue;
        if (entry.value.toLowerCase() !== lower) continue;
        if (entry.creatorWallet === creatorWallet) continue;
        entry.creatorWallet = creatorWallet;
        changed = true;
    }
    if (changed) saveTracked();
}

/** Find all tracked items that match a given X handle (for creator lookup). */
export function findMatchingXHandleTracks(handle: string): TrackedItem[] {
    const lower = handle.toLowerCase().replace(/^@/, '');
    return Array.from(tracked.values()).filter(
        (t) => t.type === 'xhandle' && t.value.toLowerCase().replace(/^@/, '') === lower,
    );
}

/** Check if a value is already tracked in a chat. */
export function isAlreadyTracked(value: string, chatId: number): boolean {
    const lower = value.toLowerCase().replace(/^@/, '');
    return Array.from(tracked.values()).some(
        (t) =>
            t.chatId === chatId &&
            t.value.toLowerCase().replace(/^@/, '') === lower,
    );
}
