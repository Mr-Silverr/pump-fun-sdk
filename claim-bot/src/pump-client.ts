/**
 * PumpFun Claim Bot — PumpFun API Client
 *
 * Fetches token info from the PumpFun public HTTP API
 * for enriching claim notifications.
 */

import { log } from './logger.js';
import type { TwitterUserInfo } from './types.js';

const PUMPFUN_API = 'https://frontend-api-v3.pump.fun';

// ============================================================================
// Types
// ============================================================================

export interface TokenInfo {
    mint: string;
    name: string;
    symbol: string;
    description: string;
    imageUri: string;
    creator: string;
    complete: boolean;
    usdMarketCap: number;
    marketCapSol: number;
    twitter?: string;
    twitterUserInfo?: TwitterUserInfo;
}

// ============================================================================
// Cache
// ============================================================================

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

const TOKEN_CACHE_TTL = 60_000;
const tokenCache = new Map<string, CacheEntry<TokenInfo>>();

/**
 * Creator lookups change far more slowly than market caps, and every wallet-level
 * claim triggers one, so they get their own longer-lived cache.
 */
const CREATOR_CACHE_TTL = 10 * 60_000;
const creatorCoinsCache = new Map<string, CacheEntry<TokenInfo[]>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T, ttl: number): void {
    cache.set(key, { data, expiresAt: Date.now() + ttl });
    if (cache.size > 500) {
        const now = Date.now();
        for (const [k, v] of cache) {
            if (now > v.expiresAt) cache.delete(k);
        }
    }
}

// ============================================================================
// API
// ============================================================================

function toTokenInfo(raw: Record<string, unknown>, fallbackMint: string): TokenInfo {
    return {
        mint: String(raw.mint ?? fallbackMint),
        name: String(raw.name ?? 'Unknown'),
        symbol: String(raw.symbol ?? '???'),
        description: String(raw.description ?? ''),
        imageUri: String(raw.image_uri ?? ''),
        creator: String(raw.creator ?? ''),
        complete: Boolean(raw.complete),
        usdMarketCap: Number(raw.usd_market_cap ?? 0),
        marketCapSol: Number(raw.market_cap ?? 0),
        twitter: typeof raw.twitter === 'string' ? raw.twitter : undefined,
    };
}

export async function fetchTokenInfo(mint: string): Promise<TokenInfo | null> {
    if (!mint) return null;
    const cached = getCached(tokenCache, mint);
    if (cached) return cached;

    try {
        const resp = await fetch(
            `${PUMPFUN_API}/coins/${encodeURIComponent(mint)}`,
            {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(10_000),
            },
        );

        if (!resp.ok) {
            if (resp.status === 404) return null;
            log.warn('PumpFun API %d for mint %s', resp.status, mint.slice(0, 8));
            return null;
        }

        const raw = (await resp.json()) as Record<string, unknown>;
        const info = toTokenInfo(raw, mint);

        setCache(tokenCache, mint, info, TOKEN_CACHE_TTL);
        return info;
    } catch (err) {
        log.warn('Failed to fetch token info for %s: %s', mint.slice(0, 8), err);
        return null;
    }
}

/**
 * Coins created by a wallet, newest first.
 *
 * This is the reverse lookup the tracker needs: `collect_creator_fee` and
 * `collect_coin_creator_fee` are wallet-level claims that carry no mint, so the
 * only way to tell which token a claim belongs to is to ask which tokens the
 * claiming wallet created.
 */
export async function fetchCoinsByCreator(wallet: string, limit = 20): Promise<TokenInfo[]> {
    if (!wallet) return [];
    const cached = getCached(creatorCoinsCache, wallet);
    if (cached) return cached;

    try {
        const resp = await fetch(
            `${PUMPFUN_API}/coins?creator=${encodeURIComponent(wallet)}&limit=${limit}`,
            {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(10_000),
            },
        );

        if (!resp.ok) {
            log.warn('PumpFun API %d for creator %s', resp.status, wallet.slice(0, 8));
            return [];
        }

        const raw = (await resp.json()) as unknown;
        if (!Array.isArray(raw)) return [];

        const coins = raw
            .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
            .map((c) => toTokenInfo(c, ''))
            .filter((c) => c.mint.length > 0);

        setCache(creatorCoinsCache, wallet, coins, CREATOR_CACHE_TTL);
        for (const coin of coins) {
            setCache(tokenCache, coin.mint, coin, TOKEN_CACHE_TTL);
        }
        return coins;
    } catch (err) {
        log.warn('Failed to fetch coins for creator %s: %s', wallet.slice(0, 8), err);
        return [];
    }
}

/** Every X handle associated with the coins a wallet created (lowercase, no @). */
export async function fetchXHandlesForWallet(wallet: string): Promise<Set<string>> {
    const coins = await fetchCoinsByCreator(wallet);
    const handles = new Set<string>();
    for (const coin of coins) {
        const handle = getXHandleFromToken(coin);
        if (handle) handles.add(handle);
    }
    return handles;
}

/**
 * Try to match a token's creator X handle against the PumpFun API metadata.
 * Returns the X handle (without @) if associated with the token, or null.
 */
export function getXHandleFromToken(token: TokenInfo): string | null {
    if (!token.twitter) return null;
    // Twitter field might be a URL or a handle
    const match = token.twitter.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/);
    if (match) return match[1]?.toLowerCase() ?? null;
    // Might just be a handle
    const handle = token.twitter.replace(/^@/, '').trim();
    return handle.length > 0 ? handle.toLowerCase() : null;
}
