/**
 * PumpFun All-Claims Bot - Claim Enrichment
 *
 * A raw claim event is nearly content-free: an amount, a signer, and usually no
 * mint at all, because creator fees pool in a per-creator vault rather than per
 * coin. This module turns that into something a reader can act on.
 *
 * The chain of resolution, in order of confidence:
 *   1. The mint named by the event (fee distributions, resolved social claims).
 *   2. The creator pubkey carried inside the claim event, which resolves to a
 *      pump.fun profile and every coin that creator launched.
 *   3. The signer, when the event carried no creator.
 *
 * Every lookup fails open. A card with a missing section still posts; a card
 * that waits on a dead API does not. Instant cards get the full treatment,
 * digest lines get one cheap lookup each, which bounds API traffic to the
 * number of lines that actually ship.
 */

import {
    fetchCreatorProfile,
    fetchPoolLiquidity,
    fetchTokenInfo,
    fetchTokenTrades,
    fetchTopHolders,
    type CreatorCoin,
    type TokenInfo,
} from './pump-client.js';
import {
    fetchGitHubUserById,
    fetchGitHubUserFromUrls,
    fetchRepoFromUrls,
} from './github-client.js';
import { log } from './logger.js';
import type { ClaimCard, DigestSubject, TradeLinks } from './formatters.js';
import type { FeeClaimEvent } from './types.js';

/** Referral handles for the trade links on a card. */
export interface AffiliateRefs {
    axiom: string;
    gmgn: string;
    padre: string;
}

/** Run a lookup that must never take the card down with it. */
async function soft<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
        return await fn();
    } catch (err) {
        log.debug('Enrichment step %s failed: %s', label, err);
        return null;
    }
}

/**
 * The wallet that actually earned the fees.
 *
 * `creatorWallet` comes from the claim event itself and is authoritative: claim
 * bots routinely sign on a creator's behalf, so the signer is the weakest of
 * the three candidates and is only used when nothing better exists.
 */
export function subjectWallet(event: FeeClaimEvent): string {
    return event.creatorWallet || event.recipientWallet || event.claimerWallet;
}

function tradeLinks(mint: string, refs: AffiliateRefs | null): TradeLinks | null {
    if (!refs) return null;
    return {
        axiom: `https://axiom.trade/t/${mint}${refs.axiom ? `?ref=${encodeURIComponent(refs.axiom)}` : ''}`,
        gmgn: `https://gmgn.ai/sol/token/${mint}${refs.gmgn ? `?ref=${encodeURIComponent(refs.gmgn)}` : ''}`,
        padre: refs.padre
            ? `https://trade.padre.gg/rk/${encodeURIComponent(refs.padre)}`
            : `https://t.me/padre_bot?start=${mint}`,
    };
}

/**
 * Build the full card for a claim big enough to post on its own.
 *
 * Lookups run in two waves: everything that only needs the event fires at once,
 * then the follow-ups that need the token or creator that came back.
 */
export async function buildClaimCard(
    event: FeeClaimEvent,
    usd: number,
    solUsdPrice: number,
    refs: AffiliateRefs | null,
): Promise<ClaimCard> {
    const wallet = subjectWallet(event);

    const [token, creator] = await Promise.all([
        event.tokenMint ? soft('token', () => fetchTokenInfo(event.tokenMint)) : Promise.resolve(null),
        soft('creator', () => fetchCreatorProfile(wallet)),
    ]);

    // A vault claim names no coin. Credit the creator's biggest one, and let the
    // formatter say plainly that it is attribution rather than the exact source.
    const attributedCoin: CreatorCoin | null = token ? null : creator?.topCoins[0] ?? null;
    const cardMint = token?.mint ?? attributedCoin?.mint ?? '';

    const githubUrls = token?.githubUrls ?? [];
    const [holders, githubUser, repo, linkedTokens, trades, liquidity] = await Promise.all([
        cardMint ? soft('holders', () => fetchTopHolders(cardMint, token?.pumpSwapPool)) : Promise.resolve(null),
        event.githubUserId
            ? soft('github-user', () => fetchGitHubUserById(event.githubUserId!))
            : githubUrls.length
                ? soft('github-owner', () => fetchGitHubUserFromUrls(githubUrls))
                : Promise.resolve(null),
        githubUrls.length ? soft('github-repo', () => fetchRepoFromUrls(githubUrls)) : Promise.resolve(null),
        resolveLinkedTokens(event),
        cardMint ? soft('trades', () => fetchTokenTrades(cardMint)) : Promise.resolve(null),
        cardMint
            ? soft('liquidity', () => fetchPoolLiquidity(cardMint, token?.usdMarketCap ?? 0))
            : Promise.resolve(null),
    ]);

    return {
        affiliates: cardMint ? tradeLinks(cardMint, refs) : null,
        attributedCoin,
        creator,
        event,
        githubUser,
        holders,
        linkedTokens,
        liquidity,
        repo,
        solUsdPrice,
        token,
        trades,
        usd,
    };
}

/**
 * Coins sharing a social fee PDA. Several coins on one PDA is a known scam
 * vector, so the card shows all of them rather than silently picking one.
 */
async function resolveLinkedTokens(event: FeeClaimEvent): Promise<TokenInfo[] | null> {
    const candidates = event.allCandidateMints;
    if (!candidates || candidates.length < 2) return null;
    const infos = await Promise.all(
        candidates.slice(0, 5).map((mint) => soft('linked-token', () => fetchTokenInfo(mint))),
    );
    const found = infos.filter((t): t is TokenInfo => t !== null);
    return found.length > 1 ? found : null;
}

/**
 * One cheap lookup for a digest line: enough to name a person and a coin.
 *
 * Resolution mirrors the card but stops early. When the event names a mint that
 * is the whole answer; otherwise the creator profile supplies both the display
 * name and the coin to credit.
 */
export async function resolveDigestSubject(event: FeeClaimEvent): Promise<DigestSubject> {
    const wallet = subjectWallet(event);
    const fallback: DigestSubject = {
        mint: null,
        symbol: null,
        usdMarketCap: 0,
        who: shortWallet(wallet),
    };

    if (event.tokenMint) {
        const token = await soft('digest-token', () => fetchTokenInfo(event.tokenMint));
        if (token) {
            return {
                mint: token.mint,
                symbol: token.symbol,
                usdMarketCap: token.usdMarketCap,
                who: shortWallet(wallet),
            };
        }
        return fallback;
    }

    const creator = await soft('digest-creator', () => fetchCreatorProfile(wallet));
    if (!creator) return fallback;

    const coin = creator.topCoins[0] ?? null;
    return {
        mint: coin?.mint ?? null,
        symbol: coin?.symbol ?? null,
        usdMarketCap: coin?.usdMarketCap ?? 0,
        who: creator.username || shortWallet(wallet),
    };
}

function shortWallet(addr: string): string {
    return addr.length <= 12 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
