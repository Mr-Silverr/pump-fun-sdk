/**
 * PumpFun All-Claims Bot — Message Formatters
 *
 * Two message shapes, both HTML for Telegram:
 *   - Instant: one claim big enough to deserve its own message
 *   - Digest: a batch of sub-threshold claims from one window
 */

import type { TokenInfo } from './pump-client.js';
import type { FeeClaimEvent, ClaimType } from './types.js';

/** A claim annotated with its USD value at detection time. */
export interface ValuedClaim {
    event: FeeClaimEvent;
    /** USD value of the claim (stable quotes pass through; SOL quotes use spot price) */
    usd: number;
}

export const CLAIM_TYPE_SHORT: Record<ClaimType, string> = {
    claim_cashback: 'cashback',
    claim_social_fee_pda: 'social (GitHub)',
    collect_coin_creator_fee: 'creator fee (AMM)',
    collect_creator_fee: 'creator fee',
    distribute_creator_fees: 'fee distribution',
    transfer_creator_fees_to_pump: 'fees to pump',
};

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function shortAddr(addr: string): string {
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Value of a claim in USD. Stable quotes are already USD; SOL quotes use spot. */
export function claimUsd(event: FeeClaimEvent, solUsdPrice: number): number {
    const amount = event.amountQuote ?? event.amountSol;
    if (event.isStableQuote) return amount;
    return amount * solUsdPrice;
}

/** "0.42 SOL ($63.10)" or "12.50 USDC" depending on the quote currency. */
export function fmtAmount(event: FeeClaimEvent, solUsdPrice: number): string {
    const amount = event.amountQuote ?? event.amountSol;
    const ticker = event.quoteTicker ?? 'SOL';
    if (event.isStableQuote) {
        return `${amount.toFixed(2)} ${ticker}`;
    }
    const usd = amount * solUsdPrice;
    const usdPart = usd > 0 ? ` ($${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)})` : '';
    const digits = amount < 0.01 ? 5 : amount < 1 ? 4 : 2;
    return `${amount.toFixed(digits)} ${ticker}${usdPart}`;
}

function fmtUsd(usd: number): string {
    if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
    if (usd >= 10) return `$${usd.toFixed(0)}`;
    return `$${usd.toFixed(2)}`;
}

function tokenLabel(event: FeeClaimEvent, token: TokenInfo | null): string {
    if (token) return `${escapeHtml(token.name)} <b>$${escapeHtml(token.symbol)}</b>`;
    if (event.tokenMint) return `<code>${shortAddr(event.tokenMint)}</code>`;
    return 'wallet-level claim';
}

function txLink(sig: string, label = 'TX'): string {
    return `<a href="https://solscan.io/tx/${sig}">${label}</a>`;
}

function walletLink(addr: string): string {
    return `<a href="https://solscan.io/account/${addr}">${shortAddr(addr)}</a>`;
}

function pumpLink(mint: string, label = 'Pump'): string {
    return `<a href="https://pump.fun/coin/${mint}">${label}</a>`;
}

// ============================================================================
// Instant message — one claim, one post
// ============================================================================

export function formatInstantClaim(
    event: FeeClaimEvent,
    token: TokenInfo | null,
    solUsdPrice: number,
): string {
    const lines: string[] = [];
    const typeLabel = CLAIM_TYPE_SHORT[event.claimType] ?? event.claimType;

    lines.push(`💸 <b>FEE CLAIM</b> · ${escapeHtml(typeLabel)}`);
    lines.push('');
    lines.push(`🪙 ${tokenLabel(event, token)}`);
    lines.push(`💰 <b>${fmtAmount(event, solUsdPrice)}</b>`);

    if (token && token.usdMarketCap > 0) {
        lines.push(`💎 Mcap: ${fmtUsd(token.usdMarketCap)}${token.complete ? ' · 🎓 graduated' : ''}`);
    }

    if (event.githubUserId) {
        lines.push(`🐙 GitHub user <code>${escapeHtml(event.githubUserId)}</code>`);
    }

    lines.push(`👤 ${walletLink(event.claimerWallet)}`);

    if (event.lifetimeClaimedQuote != null && event.lifetimeClaimedQuote > 0) {
        const ticker = event.quoteTicker ?? 'SOL';
        lines.push(`📈 Lifetime claimed: ${event.lifetimeClaimedQuote.toFixed(event.isStableQuote ? 2 : 4)} ${ticker}`);
    }

    const links = [txLink(event.txSignature)];
    if (event.tokenMint) links.push(pumpLink(event.tokenMint));
    lines.push('');
    lines.push(`🔗 ${links.join(' · ')}`);

    return lines.join('\n');
}

// ============================================================================
// Digest message — everything below the instant threshold, one window
// ============================================================================

export interface DigestStats {
    windowSeconds: number;
    totalClaims: number;
    totalUsd: number;
    droppedBelowMin: number;
}

export function formatDigest(
    claims: ValuedClaim[],
    tokens: Map<string, TokenInfo | null>,
    stats: DigestStats,
    maxLines: number,
): string {
    const sorted = [...claims].sort((a, b) => b.usd - a.usd);
    const shown = sorted.slice(0, maxLines);
    const rest = sorted.slice(maxLines);

    const lines: string[] = [];
    const windowLabel = stats.windowSeconds >= 60
        ? `${Math.round(stats.windowSeconds / 60)}m`
        : `${stats.windowSeconds}s`;
    const claimLabel = stats.totalClaims === 1 ? 'claim' : 'claims';
    lines.push(`🧾 <b>CLAIMS DIGEST</b> · last ${windowLabel} · ${stats.totalClaims} ${claimLabel} · ${fmtUsd(stats.totalUsd)} total`);
    lines.push('');

    for (const { event, usd } of shown) {
        const token = event.tokenMint ? tokens.get(event.tokenMint) ?? null : null;
        const sym = token
            ? `$${escapeHtml(token.symbol)}`
            : event.tokenMint
                ? `<code>${shortAddr(event.tokenMint)}</code>`
                : 'wallet';
        const typeLabel = CLAIM_TYPE_SHORT[event.claimType] ?? event.claimType;
        lines.push(`• ${fmtUsd(usd)} · ${sym} · ${escapeHtml(typeLabel)} · ${txLink(event.txSignature, 'tx')}`);
    }

    if (rest.length > 0) {
        const restUsd = rest.reduce((sum, c) => sum + c.usd, 0);
        lines.push(`… +${rest.length} more (${fmtUsd(restUsd)})`);
    }

    if (stats.droppedBelowMin > 0) {
        lines.push(`<i>${stats.droppedBelowMin} dust claims below the minimum were not counted</i>`);
    }

    return lines.join('\n');
}
