/**
 * PumpFun Claim Bot - Claim History
 *
 * A bounded, persisted log of every claim the monitor detected, whether or not
 * anyone was tracking it. That is what makes `/history`, `/top`, and the
 * `/claims` HTTP feed answerable: the chain has the data, but reconstructing a
 * day of it per query would take thousands of RPC calls.
 *
 * Bounded on purpose. Claims run a few per minute, so an unbounded file would
 * grow without limit on a long-lived deployment.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { log } from './logger.js';
import { DATA_DIR, ensureDataDir, mirrorState } from './state-store.js';
import type { ClaimRecord, FeeClaimEvent } from './types.js';

const STATE_NAME = 'claims.json';
const HISTORY_FILE = join(DATA_DIR, STATE_NAME);

/** Roughly a day of mainnet claim volume. */
export const MAX_RECORDS = 5_000;
/** Writes are batched: a claim every few seconds should not mean a write every few seconds. */
const FLUSH_INTERVAL_MS = 30_000;

let records: ClaimRecord[] = [];
let dirty = false;
let flushTimer: ReturnType<typeof setInterval> | undefined;

export function loadHistory(): void {
    try {
        ensureDataDir();
        if (!existsSync(HISTORY_FILE)) {
            log.info('No claim history on disk, starting fresh');
            return;
        }
        const parsed: ClaimRecord[] = JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'));
        records = parsed.slice(-MAX_RECORDS);
        log.info('Loaded %d historical claims', records.length);
    } catch (err) {
        log.warn('Failed to load claim history: %s', err);
    }
}

export function flushHistory(): void {
    if (!dirty) return;
    try {
        ensureDataDir();
        writeFileSync(HISTORY_FILE, JSON.stringify(records), 'utf-8');
        dirty = false;
        mirrorState(STATE_NAME);
    } catch (err) {
        log.error('Failed to save claim history: %s', err);
    }
}

export function startHistoryFlush(): void {
    if (flushTimer) return;
    flushTimer = setInterval(flushHistory, FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
}

export function stopHistoryFlush(): void {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = undefined;
    }
    flushHistory();
}

export function recordClaim(event: FeeClaimEvent): ClaimRecord {
    const record: ClaimRecord = {
        txSignature: event.txSignature,
        timestamp: event.timestamp,
        claimerWallet: event.claimerWallet,
        recipientWallet: event.recipientWallet,
        tokenMint: event.tokenMint,
        tokenSymbol: event.tokenSymbol,
        claimType: event.claimType,
        amount: event.amountQuote ?? event.amountSol,
        ticker: event.quoteTicker ?? 'SOL',
        isStableQuote: Boolean(event.isStableQuote),
    };

    records.push(record);
    if (records.length > MAX_RECORDS) {
        records = records.slice(-MAX_RECORDS);
    }
    dirty = true;
    return record;
}

export function totalRecords(): number {
    return records.length;
}

/** Most recent claims first. */
export function recentClaims(limit = 20): ClaimRecord[] {
    return records.slice(-limit).reverse();
}

/** Claims involving a mint, a claimer, or a recipient, most recent first. */
export function claimsFor(target: string, limit = 10): ClaimRecord[] {
    const needle = target.toLowerCase();
    const out: ClaimRecord[] = [];
    for (let i = records.length - 1; i >= 0 && out.length < limit; i--) {
        const record = records[i]!;
        if (
            record.tokenMint.toLowerCase() === needle ||
            record.claimerWallet.toLowerCase() === needle ||
            record.recipientWallet?.toLowerCase() === needle
        ) {
            out.push(record);
        }
    }
    return out;
}

export interface LeaderboardRow {
    wallet: string;
    claims: number;
    /** Totals per ticker, because SOL and USDC cannot be summed without a price. */
    totals: Record<string, number>;
    lastSeen: number;
}

/** Top claimers over a window, ranked by SOL claimed then by claim count. */
export function topClaimers(hours = 24, limit = 10): LeaderboardRow[] {
    const cutoff = Date.now() / 1000 - hours * 3600;
    const byWallet = new Map<string, LeaderboardRow>();

    for (const record of records) {
        if (record.timestamp < cutoff) continue;
        const wallet = record.recipientWallet || record.claimerWallet;
        const row = byWallet.get(wallet) ?? { wallet, claims: 0, totals: {}, lastSeen: 0 };
        row.claims++;
        row.totals[record.ticker] = (row.totals[record.ticker] ?? 0) + record.amount;
        row.lastSeen = Math.max(row.lastSeen, record.timestamp);
        byWallet.set(wallet, row);
    }

    return [...byWallet.values()]
        .sort((a, b) => (b.totals.SOL ?? 0) - (a.totals.SOL ?? 0) || b.claims - a.claims)
        .slice(0, limit);
}

/** Aggregate totals over a window, for /top headers and the HTTP feed. */
export function windowSummary(hours = 24): { claims: number; totals: Record<string, number>; wallets: number } {
    const cutoff = Date.now() / 1000 - hours * 3600;
    const totals: Record<string, number> = {};
    const wallets = new Set<string>();
    let claims = 0;

    for (const record of records) {
        if (record.timestamp < cutoff) continue;
        claims++;
        totals[record.ticker] = (totals[record.ticker] ?? 0) + record.amount;
        wallets.add(record.recipientWallet || record.claimerWallet);
    }

    return { claims, totals, wallets: wallets.size };
}

/** Test seam: drop in-memory state without touching disk. */
export function resetHistoryForTest(): void {
    records = [];
    dirty = false;
}
