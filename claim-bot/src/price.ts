/**
 * PumpFun Claim Bot - SOL Price
 *
 * One cached USD price for SOL, used to show what a claim is actually worth and
 * to run whale alerts on a single comparable scale.
 *
 * Two independent sources: PumpFun's own price endpoint (the same number their
 * UI shows, so our figures match what a user sees on the coin page) and
 * Coinbase spot as a failover. A price is never invented: when both fail the
 * caller gets null and every USD line is simply omitted.
 */

import { log } from './logger.js';

const PUMPFUN_PRICE_URL = 'https://frontend-api-v3.pump.fun/sol-price';
const COINBASE_PRICE_URL = 'https://api.coinbase.com/v2/prices/SOL-USD/spot';

/** SOL moves slowly enough that a minute-old price is fine for alert copy. */
const CACHE_TTL_MS = 60_000;
/** Past this age a cached price is worse than no price at all. */
const MAX_STALE_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

/** Sanity bounds. A source returning 0 or 6 digits is broken, not newsworthy. */
const MIN_PLAUSIBLE_USD = 0.5;
const MAX_PLAUSIBLE_USD = 100_000;

interface CachedPrice {
    usd: number;
    fetchedAt: number;
    source: string;
}

let cached: CachedPrice | null = null;
let inFlight: Promise<number | null> | null = null;

function plausible(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && value >= MIN_PLAUSIBLE_USD
        && value <= MAX_PLAUSIBLE_USD;
}

async function fetchFromPumpFun(): Promise<number | null> {
    const resp = await fetch(PUMPFUN_PRICE_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { solPrice?: unknown; stale?: unknown };
    // The endpoint flags its own staleness; honor it rather than publishing a
    // number the source itself does not stand behind.
    if (body.stale === true) return null;
    return plausible(body.solPrice) ? body.solPrice : null;
}

async function fetchFromCoinbase(): Promise<number | null> {
    const resp = await fetch(COINBASE_PRICE_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as { data?: { amount?: unknown } };
    const parsed = Number.parseFloat(String(body.data?.amount ?? ''));
    return plausible(parsed) ? parsed : null;
}

/**
 * Current SOL price in USD, or null when no source could be reached.
 *
 * Concurrent callers share one request: a burst of claims must not become a
 * burst of price lookups.
 */
export async function getSolPriceUsd(): Promise<number | null> {
    const now = Date.now();
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.usd;
    if (inFlight) return inFlight;

    inFlight = (async () => {
        for (const [source, fetcher] of [
            ['pump.fun', fetchFromPumpFun],
            ['coinbase', fetchFromCoinbase],
        ] as const) {
            try {
                const usd = await fetcher();
                if (usd !== null) {
                    cached = { usd, fetchedAt: Date.now(), source };
                    return usd;
                }
                log.debug('SOL price source %s returned nothing usable', source);
            } catch (err) {
                log.debug('SOL price source %s failed: %s', source, err);
            }
        }

        // Both sources are down. A recent cached price still beats nothing, but
        // only for so long: a 15-minute-old price would mislabel a whale alert.
        if (cached && Date.now() - cached.fetchedAt < MAX_STALE_MS) {
            log.warn('SOL price sources unreachable, using cached price from %ds ago',
                Math.floor((Date.now() - cached.fetchedAt) / 1000));
            return cached.usd;
        }

        log.warn('No SOL price available: USD figures will be omitted');
        return null;
    })();

    try {
        return await inFlight;
    } finally {
        inFlight = null;
    }
}

/**
 * Convert a claim to USD, or null when it cannot be valued.
 *
 * A stablecoin claim is already denominated in dollars, so it needs no price
 * and is never blocked by an outage.
 */
export async function claimUsdValue(amount: number, isStableQuote: boolean): Promise<number | null> {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (isStableQuote) return amount;
    const price = await getSolPriceUsd();
    return price === null ? null : amount * price;
}

/** Compact USD for message copy: $1.2K, $340, $12.5M. */
export function formatUsd(value: number): string {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    if (value >= 1) return `$${value.toFixed(0)}`;
    return `$${value.toFixed(2)}`;
}

/** Test seam: drop the cached price. */
export function resetPriceCacheForTest(): void {
    cached = null;
    inFlight = null;
}
