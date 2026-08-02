/**
 * PumpFun All-Claims Bot - Message Formatters
 *
 * Two message shapes, both Telegram HTML:
 *   - Instant: one claim big enough to deserve its own card, with the coin
 *     artwork attached, a one-tap contract address, and the creator behind it.
 *   - Digest: a batch of sub-threshold claims from one window, one line each.
 *
 * The design rule for both: a reader should understand what happened from the
 * first line, and be able to act (copy the CA, open the chart, judge the
 * creator) without leaving Telegram.
 *
 * Most claims are creator-vault claims that name no mint on chain. Those are
 * not anonymous: the claim event carries the creator pubkey, which resolves to
 * a pump.fun profile and the coins that earned the fees. A card says
 * "wallet-level claim" only when every one of those lookups came back empty.
 */

import type {
    CreatorCoin,
    CreatorProfile,
    HolderDetails,
    PoolLiquidityInfo,
    TokenInfo,
    TokenTradeInfo,
} from './pump-client.js';
import type { GitHubRepoInfo, GitHubUserInfo } from './github-client.js';
import { scoreCredibility } from './credibility.js';
import type { FeeClaimEvent, ClaimType } from './types.js';

/** A claim annotated with its USD value at detection time. */
export interface ValuedClaim {
    event: FeeClaimEvent;
    /** USD value of the claim (stable quotes pass through; SOL quotes use spot price) */
    usd: number;
}

/** Everything an instant card can render. Every field beyond the claim is optional: enrichment fails open. */
export interface ClaimCard {
    event: FeeClaimEvent;
    usd: number;
    solUsdPrice: number;
    /** Recent trade flow for the coin on the card. */
    trades?: TokenTradeInfo | null;
    /** Pool liquidity, when the coin has graduated to an indexed pool. */
    liquidity?: PoolLiquidityInfo | null;
    /** The coin this claim is about, when the event names a mint. */
    token: TokenInfo | null;
    /** The coin credited for a vault claim: the creator's biggest coin. */
    attributedCoin: CreatorCoin | null;
    /** pump.fun profile of the creator who earned the fees. */
    creator: CreatorProfile | null;
    /** Holder distribution for the coin on the card. */
    holders: HolderDetails | null;
    /** GitHub identity behind a social fee claim. */
    githubUser: GitHubUserInfo | null;
    /** Repo linked from the coin's own metadata. */
    repo: GitHubRepoInfo | null;
    /** Every coin sharing this claim's social fee PDA. */
    linkedTokens: TokenInfo[] | null;
    /** Referral-tagged trade links, when configured. */
    affiliates: TradeLinks | null;
}

export interface TradeLinks {
    axiom: string;
    gmgn: string;
    padre: string;
}

/** What the digest needs to name a claim without a second round of lookups. */
export interface DigestSubject {
    /** Display name for who claimed: pump username, else a short wallet. */
    who: string;
    /** Ticker of the coin credited, without the leading $. */
    symbol: string | null;
    /** Mint used for the coin link. */
    mint: string | null;
    /** Market cap of that coin, when known. */
    usdMarketCap: number;
}

export const CLAIM_TYPE_SHORT: Record<ClaimType, string> = {
    claim_cashback: 'cashback',
    claim_social_fee_pda: 'social (GitHub)',
    collect_coin_creator_fee: 'creator fee (AMM)',
    collect_creator_fee: 'creator fee',
    distribute_creator_fees: 'fee distribution',
    transfer_creator_fees_to_pump: 'fees to pump',
};

const CLAIM_TYPE_ICON: Record<ClaimType, string> = {
    claim_cashback: '🎁',
    claim_social_fee_pda: '🐙',
    collect_coin_creator_fee: '🏊',
    collect_creator_fee: '💸',
    distribute_creator_fees: '📤',
    transfer_creator_fees_to_pump: '🏦',
};

// ============================================================================
// Primitives
// ============================================================================

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
    // Dust that rounds to $0.00 reads as a broken conversion. Show the SOL alone.
    const usdPart = usd >= 0.005 ? ` ($${usd < 10 ? usd.toFixed(2) : usd.toFixed(0)})` : '';
    const digits = amount < 0.01 ? 5 : amount < 1 ? 4 : 2;
    return `${amount.toFixed(digits)} ${ticker}${usdPart}`;
}

export function fmtUsd(usd: number): string {
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
    if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
    if (usd >= 10) return `$${usd.toFixed(0)}`;
    return `$${usd.toFixed(2)}`;
}

export function timeAgo(unixSeconds: number): string {
    if (!unixSeconds) return '';
    const diff = Math.floor(Date.now() / 1000) - unixSeconds;
    if (diff < 0) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
    if (diff < 2_592_000) return `${Math.floor(diff / 604_800)}w ago`;
    return `${Math.floor(diff / 2_592_000)}mo ago`;
}

function link(url: string, label: string): string {
    return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

/**
 * A ticker rendered with exactly one leading $.
 *
 * Plenty of coins put the dollar sign in the symbol itself, and prefixing that
 * blindly shipped "$$BRUNO" onto live cards.
 */
export function tickerLabel(symbol: string): string {
    return `$${symbol.trim().replace(/^\$+/, '').trim()}`;
}

/** The same, escaped for direct insertion into card text. */
export function fmtTicker(symbol: string): string {
    return escapeHtml(tickerLabel(symbol));
}

// ============================================================================
// Subject resolution
// ============================================================================

/**
 * The coin a card is about. A vault claim names no mint on chain, so the
 * creator's biggest coin stands in and the card labels it as attribution
 * rather than passing it off as the exact source of the fees.
 */
export interface CardSubject {
    mint: string | null;
    name: string;
    symbol: string;
    imageUri: string;
    usdMarketCap: number;
    /** True when the mint came from the claim event itself. */
    exact: boolean;
    /** How many coins the creator has, for vault claims that span several. */
    creatorCoinCount: number;
}

export function resolveSubject(card: ClaimCard): CardSubject | null {
    const { token, attributedCoin, creator } = card;
    const coinCount = creator?.totalLaunches ?? 0;

    if (token) {
        return {
            mint: token.mint,
            name: token.name,
            symbol: token.symbol,
            imageUri: token.imageUri,
            usdMarketCap: token.usdMarketCap,
            exact: true,
            creatorCoinCount: coinCount,
        };
    }
    if (attributedCoin) {
        return {
            mint: attributedCoin.mint,
            name: attributedCoin.name,
            symbol: attributedCoin.symbol,
            imageUri: attributedCoin.imageUri,
            usdMarketCap: attributedCoin.usdMarketCap,
            // A creator with exactly one coin has only one possible fee source,
            // so the attribution is certain even though the event named no mint.
            exact: coinCount === 1,
            creatorCoinCount: coinCount,
        };
    }
    return null;
}

/** Collapse the blank lines left behind by sections that rendered nothing. */
function tidy(lines: string[]): string {
    const out: string[] = [];
    for (const line of lines) {
        if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
        out.push(line);
    }
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.join('\n');
}

/** The image Telegram should preview with the card: the coin, else the creator's avatar. */
export function cardImageUrl(card: ClaimCard): string | null {
    const subject = resolveSubject(card);
    if (subject?.imageUri) return subject.imageUri;
    if (card.creator?.profileImage) return card.creator.profileImage;
    return null;
}

/** Who to credit for a claim, preferring a human-readable pump.fun username. */
function claimant(card: ClaimCard): string {
    const wallet = card.event.creatorWallet ?? card.event.recipientWallet ?? card.event.claimerWallet;
    const username = card.creator?.username;
    if (username) return escapeHtml(username);
    if (card.githubUser?.login) return escapeHtml(card.githubUser.login);
    return shortAddr(wallet);
}

/** Size tier drives the header so the biggest claims are unmistakable in a busy feed. */
function header(card: ClaimCard): string {
    const type = CLAIM_TYPE_SHORT[card.event.claimType] ?? card.event.claimType;
    const icon = CLAIM_TYPE_ICON[card.event.claimType] ?? '💸';
    if (card.usd >= 10_000) return `🐋🐋🐋 <b>MASSIVE CLAIM</b> · ${escapeHtml(type)}`;
    if (card.usd >= 1_000) return `🐋 <b>WHALE CLAIM</b> · ${escapeHtml(type)}`;
    return `${icon} <b>FEE CLAIM</b> · ${escapeHtml(type)}`;
}

// ============================================================================
// Instant card
// ============================================================================

/**
 * A single claim, rendered for a reader who has never seen the feed before.
 *
 * The card is read top-down by someone deciding in two seconds whether to keep
 * scrolling, so it opens with a verdict (what happened, for how much, and how
 * much the evidence is worth) before any detail. Everything below that is
 * grouped into labelled sections with one fact per line, which survives
 * Telegram's narrow column far better than comma-separated runs.
 *
 * Trade and chart destinations are NOT in the text: they ride on the inline
 * keyboard (`buildClaimKeyboard`), which keeps the card free of a link wall.
 */
export function formatInstantClaim(card: ClaimCard): string {
    const { event, usd, solUsdPrice } = card;
    const L: string[] = [];
    const subject = resolveSubject(card);

    // ── Verdict ──────────────────────────────────────────────────────
    L.push(header(card));

    const cred = scoreCredibility({
        creator: card.creator,
        githubUser: card.githubUser,
        holders: card.holders,
        linkedTokenCount: card.linkedTokens?.length ?? 0,
        token: card.token,
    });
    L.push(`${cred.icon} <b>Credibility: ${cred.score}/100</b> · ${escapeHtml(cred.label)}`);
    if (cred.up.length) L.push(`↑ ${cred.up.slice(0, 3).map(escapeHtml).join(' · ')}`);
    if (cred.down.length) L.push(`↓ ${cred.down.slice(0, 3).map(escapeHtml).join(' · ')}`);
    L.push('');

    L.push(`<b>${fmtAmount(event, solUsdPrice)}</b> claimed by ${claimant(card)}`);
    L.push('');

    // ── The address to copy, first thing in the card ─────────────────
    if (subject?.mint) {
        L.push(`<code>${subject.mint}</code>`);
        L.push('');
    }

    // ── The coin ─────────────────────────────────────────────────────
    if (subject) {
        const tick = subject.symbol ? `<b>${fmtTicker(subject.symbol)}</b>` : '';
        const name = subject.name ? escapeHtml(subject.name) : '';
        L.push(`🪙 ${tick}${tick && name ? ' · ' : ''}${name}`);
        if (!subject.exact) {
            L.push(`<i>Vault claim: fees pool across this creator's ${subject.creatorCoinCount} coins. Biggest one shown.</i>`);
        }
    } else {
        L.push('🪙 <i>Wallet-level claim: no coin named on chain, creator unresolved.</i>');
    }

    if (card.token) {
        const t = card.token;
        if (t.usdMarketCap > 0) L.push(`💰 MC: ${fmtUsd(t.usdMarketCap)}`);
        else if (t.marketCapSol > 0) L.push(`💰 MC: ${t.marketCapSol.toFixed(1)} SOL`);
        if (t.priceSol > 0) {
            const priceUsd = solUsdPrice > 0 ? ` (${fmtPriceUsd(t.priceSol * solUsdPrice)})` : '';
            L.push(`💲 Price: ${fmtPriceSol(t.priceSol)} SOL${priceUsd}`);
        }
        if (t.complete) {
            L.push('🎓 Status: Graduated (AMM)');
        } else {
            L.push(`📈 Status: Bonding curve (${t.curveProgress >= 1 ? `${Math.round(t.curveProgress)}%` : '≤1%'})`);
        }
        if (t.athMarketCap > 0) L.push(`🏆 ATH: ${fmtUsd(t.athMarketCap)}`);
        if (card.liquidity) L.push(`💦 Liquidity: ${fmtUsd(card.liquidity.liquidityUsd)}`);
        if (t.createdTimestamp > 0) L.push(`⏱ Created: ${timeAgo(t.createdTimestamp)}`);
        if (t.lastTradeTimestamp > 0) L.push(`🕐 Last trade: ${timeAgo(t.lastTradeTimestamp)}`);
    } else if (subject && subject.usdMarketCap > 0) {
        L.push(`💰 MC: ${fmtUsd(subject.usdMarketCap)}`);
    }
    L.push('');

    // ── Claim stats ──────────────────────────────────────────────────
    L.push('💸 <b>Claim Stats</b>');
    L.push(fmtAmount(event, solUsdPrice));
    const lifetime = event.lifetimeClaimedQuote;
    if (lifetime != null && lifetime > 0) {
        const ticker = event.quoteTicker ?? 'SOL';
        const lifetimeUsd = event.isStableQuote ? lifetime : lifetime * solUsdPrice;
        L.push(`Lifetime claims: ${lifetime.toFixed(event.isStableQuote ? 2 : 4)} ${ticker} (${fmtUsd(lifetimeUsd)})`);
    }
    L.push(`Type: ${escapeHtml(event.claimLabel)}`);
    if (card.token && card.token.usdMarketCap > 0) {
        const pct = (usd / card.token.usdMarketCap) * 100;
        if (pct >= 0.01) L.push(`📐 ${pct.toFixed(pct >= 1 ? 1 : 2)}% of market cap`);
    }
    L.push('');

    // ── Who was paid ─────────────────────────────────────────────────
    const recipient = event.recipientWallet ?? event.creatorWallet ?? event.claimerWallet;
    if (recipient) {
        L.push('👛 <b>Claimed By</b>');
        L.push(`<code>${recipient}</code>`);
        L.push(`🔗 ${link(`https://pump.fun/profile/${recipient}`, `pump.fun/profile/${shortAddr(recipient)}`)}`);
        L.push('');
    }

    // ── Who earned it ────────────────────────────────────────────────
    const creator = card.creator;
    if (creator) {
        const uname = creator.username ? ` ${escapeHtml(creator.username)}` : '';
        L.push(`🧑‍💻 <b>Token Creator</b>${uname}`);
        const record: string[] = [];
        if (creator.totalLaunches > 0) {
            record.push(`🚀 ${creator.totalLaunches} ${creator.totalLaunches === 1 ? 'launch' : 'launches'}`);
        }
        if (creator.graduatedCount > 0) record.push(`🎓 ${creator.graduatedCount} graduated`);
        if (creator.scamEstimate > 0) record.push(`⚠️ ${creator.scamEstimate} dead`);
        if (creator.followers > 0) record.push(`👁 ${creator.followers} followers`);
        if (record.length) L.push(record.join(' · '));

        const others = creator.topCoins.filter((c) => c.mint !== subject?.mint).slice(0, 4);
        if (others.length) {
            const list = others
                .map((c) => `${link(`https://pump.fun/coin/${c.mint}`, tickerLabel(c.symbol))} ${fmtUsd(c.usdMarketCap)}`)
                .join(' · ');
            L.push(`🪙 ${list}`);
        }
        L.push('');
    }

    // ── GitHub identity, for social fee claims ───────────────────────
    if (card.githubUser) {
        const g = card.githubUser;
        L.push(`👨‍💻 <b>Linked Dev</b>`);
        L.push(`${link(g.htmlUrl, g.login)}${g.name ? ` (${escapeHtml(g.name)})` : ''}`);
        if (g.publicRepos > 0) L.push(`📦 Repos: ${g.publicRepos}`);
        if (g.followers > 0) L.push(`👁 Followers: ${g.followers}`);
        if (g.createdAt) L.push(`📅 Account age: ${timeAgo(new Date(g.createdAt).getTime() / 1000)}`);
        if (g.bio) L.push(`<i>${escapeHtml(g.bio.length > 100 ? `${g.bio.slice(0, 97)}...` : g.bio)}</i>`);
        if (card.repo) {
            const stars = card.repo.stars > 0 ? ` ⭐ ${card.repo.stars}` : '';
            L.push(`📂 ${link(card.repo.htmlUrl, card.repo.fullName)}${stars}`);
        }
        L.push('');
    } else if (event.githubUserId) {
        L.push(`👨‍💻 <b>Linked Dev</b>`);
        L.push(`GitHub id <code>${escapeHtml(event.githubUserId)}</code> (profile not resolved)`);
        L.push('');
    }

    // ── Every coin on the same social fee PDA ────────────────────────
    if (card.linkedTokens && card.linkedTokens.length > 1) {
        L.push(`🔗 <b>All Linked Coins (${card.linkedTokens.length})</b>`);
        for (const t of card.linkedTokens.slice(0, 6)) {
            const marker = t.mint === subject?.mint ? ' ◂' : '';
            L.push(`${t.complete ? '🎓' : '📈'} ${link(`https://pump.fun/coin/${t.mint}`, tickerLabel(t.symbol))} · ${fmtUsd(t.usdMarketCap)} · ${t.mint.slice(0, 6)}…${marker}`);
        }
        L.push('');
    }

    // ── Holders. Silence here would read as a clean bill of health. ──
    if (subject?.mint) {
        L.push('👥 <b>Holders</b>');
        const nonPool = card.holders?.topHolders.filter((h) => !h.isPool) ?? [];
        if (nonPool.length > 0) {
            if (card.holders!.totalHolders > 0) {
                L.push(`🤝 Total: ${card.holders!.totalHolders.toLocaleString()}`);
            }
            const top5 = nonPool.slice(0, 5).map((h) => h.pct.toFixed(1)).join('⋅');
            const conc = card.holders!.top10Pct > 0 ? ` [top10: ${card.holders!.top10Pct.toFixed(0)}%]` : '';
            L.push(`📊 Top5: ${top5}${conc}`);
        } else {
            L.push('⚪ Concentration unavailable: not yet indexed. Verify before buying.');
        }
        L.push('');
    }

    // ── Recent flow ──────────────────────────────────────────────────
    if (card.trades && (card.trades.buyCount > 0 || card.trades.sellCount > 0)) {
        const t = card.trades;
        L.push('📊 <b>Market</b>');
        if (t.recentVolumeSol > 0) {
            const vol = solUsdPrice > 0 ? fmtUsd(t.recentVolumeSol * solUsdPrice) : `${t.recentVolumeSol.toFixed(1)} SOL`;
            L.push(`Vol: ${vol}`);
        }
        L.push(`🅑 ${t.buyCount}  Ⓢ ${t.sellCount}`);
        const pressure = buyPressure(t);
        if (pressure) L.push(pressure);
        L.push('');
    }

    // ── Signals ──────────────────────────────────────────────────────
    const signals = collectSignals(card, subject);
    if (signals.length) {
        L.push('⚡ <b>Signals</b>');
        for (const s of signals) L.push(s);
        L.push('');
    }

    // ── Socials ──────────────────────────────────────────────────────
    if (card.token) {
        const t = card.token;
        const socials: string[] = [];
        if (t.twitter) socials.push(link(t.twitter, '𝕏'));
        if (t.telegram) socials.push(link(t.telegram, '💬 Telegram'));
        if (t.website) socials.push(link(t.website, '🌐 Website'));
        if (t.githubUrls?.[0]) socials.push(link(t.githubUrls[0], '🐙 GitHub'));
        if (socials.length) {
            L.push(socials.join(' · '));
            L.push('');
        }
    }

    // ── The address again, so it is one tap away from either end ─────
    if (subject?.mint) {
        L.push('━━━━━━━━━━━━━━━━');
        L.push(`CA: <code>${subject.mint}</code>`);
    }

    return tidy(L);
}

/** Below this many recent trades, a buy/sell split is noise rather than pressure. */
const MIN_TRADES_FOR_PRESSURE = 8;

/** Which side is in control right now, or null when there is too little flow to say. */
function buyPressure(trades: TokenTradeInfo): string | null {
    const total = trades.buyCount + trades.sellCount;
    if (total < MIN_TRADES_FOR_PRESSURE) return null;
    const buyPct = (trades.buyCount / total) * 100;
    const filled = Math.round(buyPct / 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
    let label: string;
    if (buyPct >= 70) label = '🟢 buyers in control';
    else if (buyPct >= 55) label = '🟢 buy-side leaning';
    else if (buyPct > 45) label = '⚪ balanced';
    else if (buyPct > 30) label = '🔴 sell-side leaning';
    else label = '🔴 sellers in control';
    return `⚖️ Flow: [${bar}] ${buyPct.toFixed(0)}% buys · ${label}`;
}

/** The warnings worth interrupting a reader for, strongest first. */
function collectSignals(card: ClaimCard, subject: CardSubject | null): string[] {
    const signals: string[] = [];
    const { token, githubUser, creator, holders } = card;

    if (githubUser && token) {
        const urls = token.githubUrls ?? [];
        if (urls.length === 0) {
            signals.push('⚠️ Unverified: coin has no GitHub link');
        } else {
            const owner = urls[0]!
                .replace(/^https?:\/\/github\.com\//, '')
                .replace(/\/+$/, '')
                .split('/')[0]
                ?.toLowerCase();
            if (owner === githubUser.login.toLowerCase()) {
                signals.push('✅ Verified: coin GitHub matches the claimer');
            } else if (owner) {
                signals.push(`🚩 Mismatch: coin GitHub is <b>${escapeHtml(owner)}</b>, claimer is <b>${escapeHtml(githubUser.login)}</b>`);
            }
        }
    }

    if (card.linkedTokens && card.linkedTokens.length > 1) {
        signals.push(`🚩 ${card.linkedTokens.length} coins share this fee PDA (a known scam shape)`);
    }
    if (holders && holders.top10Pct >= 40) {
        signals.push(`⚠️ Top10 hold ${holders.top10Pct.toFixed(0)}% of supply`);
    }
    if (creator && creator.scamEstimate > 0) {
        signals.push(`⚠️ Creator has ${creator.scamEstimate} dead launches`);
    }
    if (githubUser?.createdAt) {
        const ageDays = (Date.now() - new Date(githubUser.createdAt).getTime()) / 86_400_000;
        if (ageDays < 7) signals.push(`⚠️ New GitHub account (${Math.floor(ageDays)}d old)`);
    }
    if (card.repo?.isFork) {
        signals.push('⚠️ Claimed repo is a fork');
    }
    if (subject && !subject.exact && subject.creatorCoinCount > 1) {
        signals.push(`ℹ️ Vault claim: the coin shown is attribution, not the named source`);
    }

    return signals;
}

function fmtPriceSol(price: number): string {
    if (price >= 1) return price.toFixed(4);
    if (price >= 0.001) return price.toFixed(6);
    return price.toFixed(9);
}

function fmtPriceUsd(price: number): string {
    if (price >= 1) return `$${price.toFixed(2)}`;
    if (price >= 0.01) return `$${price.toFixed(4)}`;
    if (price >= 0.000_001) return `$${price.toFixed(8)}`;
    return `$${price.toExponential(2)}`;
}

// ============================================================================
// Digest
// ============================================================================

export interface DigestStats {
    windowSeconds: number;
    totalClaims: number;
    totalUsd: number;
    droppedBelowMin: number;
}

/**
 * One window of sub-threshold claims.
 *
 * Each line names a person and a coin rather than the word "wallet": the
 * subjects map is resolved at flush time for the lines that actually ship,
 * which bounds enrichment to `maxLines` lookups per window.
 */
export function formatDigest(
    claims: ValuedClaim[],
    subjects: Map<string, DigestSubject>,
    stats: DigestStats,
    maxLines: number,
): string {
    const sorted = [...claims].sort((a, b) => b.usd - a.usd);
    const shown = sorted.slice(0, maxLines);
    const rest = sorted.slice(maxLines);

    const L: string[] = [];
    const windowLabel = stats.windowSeconds >= 60
        ? `${Math.round(stats.windowSeconds / 60)}m`
        : `${stats.windowSeconds}s`;
    const claimLabel = stats.totalClaims === 1 ? 'claim' : 'claims';
    L.push(`🧾 <b>CLAIMS DIGEST</b> · last ${windowLabel} · ${stats.totalClaims} ${claimLabel} · ${fmtUsd(stats.totalUsd)} total`);
    L.push('');

    for (const { event, usd } of shown) {
        const subject = subjects.get(event.txSignature);
        const icon = CLAIM_TYPE_ICON[event.claimType] ?? '💸';
        const parts: string[] = [`<b>${fmtUsd(usd)}</b>`];

        if (subject?.symbol && subject.mint) {
            const mc = subject.usdMarketCap > 0 ? ` (${fmtUsd(subject.usdMarketCap)})` : '';
            parts.push(`${link(`https://pump.fun/coin/${subject.mint}`, tickerLabel(subject.symbol))}${mc}`);
        }
        if (subject?.who) parts.push(escapeHtml(subject.who));
        parts.push(link(`https://solscan.io/tx/${event.txSignature}`, 'tx'));

        L.push(`${icon} ${parts.join(' · ')}`);
    }

    if (rest.length > 0) {
        const restUsd = rest.reduce((sum, c) => sum + c.usd, 0);
        L.push(`… +${rest.length} more (${fmtUsd(restUsd)})`);
    }

    if (stats.droppedBelowMin > 0) {
        L.push('');
        L.push(`<i>${stats.droppedBelowMin} dust claims below the minimum were not listed</i>`);
    }

    return L.join('\n');
}
