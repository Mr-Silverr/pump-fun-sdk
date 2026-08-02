/**
 * PumpFun Claim Bot — Message Formatters
 *
 * Rich HTML message formatting for Telegram.
 */

import type { ChatSettings, ClaimRecord, FeeClaimEvent, TrackedItem } from './types.js';
import type { LeaderboardRow } from './claim-history.js';
import type { TokenInfo } from './pump-client.js';
import { formatUsd } from './price.js';
import { formatFollowerCount } from './twitter-client.js';

// ============================================================================
// Helpers
// ============================================================================

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function shortAddr(addr: string): string {
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTime(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toUTCString().replace('GMT', 'UTC');
}

/** Compact relative time for list rows: 12s, 4m, 3h, 2d. */
export function timeAgo(unixSeconds: number): string {
    const seconds = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

// ============================================================================
// Welcome / Help
// ============================================================================

export function formatWelcome(name: string): string {
    return (
        `🔔 <b>Welcome to PumpFun Fee Tracker, ${escapeHtml(name)}!</b>\n\n` +
        `I monitor PumpFun fee claims and notify you instantly when:\n` +
        `• Anyone claims fees for a token you're tracking\n` +
        `• A tracked X account claims fees on any token\n` +
        `• A tracked wallet claims anything at all\n\n` +
        `<b>Get started:</b>\n` +
        `/add &lt;token CA&gt; — Track a token\n` +
        `/add &lt;wallet&gt; — Track a wallet\n` +
        `/add @handle — Track an X account\n` +
        `/top — Biggest claimers of the last 24h\n` +
        `/help — Full command list\n\n` +
        `Stay ahead of the fee claims! 💰`
    );
}

export function formatHelp(): string {
    return (
        `🤖 <b>PumpFun Fee Claim Tracker</b>\n\n` +
        `<b>📌 Tracking:</b>\n` +
        `/add <code>&lt;token CA&gt;</code> — Track a token by contract address\n` +
        `/add <code>&lt;wallet&gt;</code> — Track every claim by a wallet\n` +
        `/add <code>@handle</code> — Track an X (Twitter) account\n` +
        `/remove <code>&lt;CA, wallet or @handle&gt;</code> — Stop tracking\n` +
        `/list — View all tracked items\n\n` +
        `<b>📊 Info:</b>\n` +
        `/history <code>[CA, wallet or @handle]</code> — Recent claims\n` +
        `/top <code>[hours]</code> — Biggest claimers, default 24h\n` +
        `/status — Monitor status &amp; stats\n\n` +
        `<b>⚙️ Alerts:</b>\n` +
        `/settings — Show your alert settings\n` +
        `/minsol <code>&lt;amount&gt;</code> — Skip claims below this size\n` +
        `/whale <code>&lt;usd&gt;</code> — Alert on any claim over this, tracked or not\n` +
        `/mute · /unmute — Pause or resume alerts\n\n` +
        `<b>How it works:</b>\n` +
        `• <b>Token tracking:</b> most fee claims name no mint on chain, so I match ` +
        `them through the token's creator wallet. Add a CA and it just works.\n` +
        `• <b>Wallet tracking:</b> every claim signed by, or paid to, that address.\n` +
        `• <b>X handle tracking:</b> I resolve the coins a claiming wallet created ` +
        `and match their X handles against yours.\n\n` +
        `💡 <i>Tip: /minsol filters out dust so only claims worth your attention ` +
        `reach you.</i>`
    );
}

// ============================================================================
// Tracked Item List
// ============================================================================

export function formatTrackedList(items: TrackedItem[]): string {
    if (items.length === 0) {
        return (
            `📋 <b>No tracked items</b>\n\n` +
            `Add items with:\n` +
            `<code>/add &lt;token CA&gt;</code> — Track a token\n` +
            `<code>/add &lt;wallet&gt;</code> — Track a wallet\n` +
            `<code>/add @handle</code> — Track an X account`
        );
    }

    const tokens = items.filter((i) => i.type === 'token');
    const wallets = items.filter((i) => i.type === 'wallet');
    const handles = items.filter((i) => i.type === 'xhandle');

    let text = `📋 <b>Tracked Items (${items.length})</b>\n`;

    if (tokens.length > 0) {
        text += `\n🪙 <b>Tokens (${tokens.length}):</b>\n`;
        for (const t of tokens) {
            const label = t.label ? ` — ${escapeHtml(t.label)}` : '';
            text += `  • <code>${shortAddr(t.value)}</code>${label}\n`;
        }
    }

    if (wallets.length > 0) {
        text += `\n👤 <b>Wallets (${wallets.length}):</b>\n`;
        for (const w of wallets) {
            const label = w.label ? ` — ${escapeHtml(w.label)}` : '';
            text += `  • <code>${shortAddr(w.value)}</code>${label}\n`;
        }
    }

    if (handles.length > 0) {
        text += `\n🐦 <b>X Accounts (${handles.length}):</b>\n`;
        for (const h of handles) {
            const label = h.label ? ` — ${escapeHtml(h.label)}` : '';
            const handle = h.value.startsWith('@') ? h.value : `@${h.value}`;
            text += `  • ${escapeHtml(handle)}${label}\n`;
        }
    }

    text += `\nTap a button below to untrack, or use <code>/remove &lt;value&gt;</code>`;
    return text;
}

// ============================================================================
// Claim Notification
// ============================================================================

export function formatClaimNotification(
    event: FeeClaimEvent,
    item: TrackedItem,
    token: TokenInfo | null,
    usdValue?: number | null,
): string {
    const emoji = event.isCashback ? '💸' : '🏦';
    const typeLabel = event.claimLabel || (event.isCashback ? 'Cashback Claim' : 'Creator Fee Claim');

    const shortWallet = shortAddr(event.claimerWallet);
    // Claims can be quoted in USDC as well as SOL. amountSol is zero for a
    // stable quote on purpose, so render the quote amount and its ticker.
    const ticker = event.quoteTicker ?? 'SOL';
    const amountValue = event.amountQuote ?? event.amountSol;
    // USD is appended only when a price was actually available: a claim shown
    // with an invented dollar value is worse than one shown without it.
    const usdSuffix = typeof usdValue === 'number' && usdValue > 0 && !event.isStableQuote
        ? ` (≈${formatUsd(usdValue)})`
        : '';
    const claimAmount = `${amountValue.toFixed(event.isStableQuote ? 2 : 4)} ${ticker}${usdSuffix}`;

    // Token info line
    let tokenLine: string;
    if (token) {
        tokenLine = `<b>Token:</b> ${escapeHtml(token.symbol)} (${escapeHtml(token.name)})`;
        if (token.usdMarketCap > 0) {
            tokenLine += ` · $${formatNumber(token.usdMarketCap)} mcap`;
        }
    } else if (event.tokenSymbol) {
        // Fall back to whatever the event carries rather than dropping the name.
        tokenLine = event.tokenName
            ? `<b>Token:</b> ${escapeHtml(event.tokenSymbol)} (${escapeHtml(event.tokenName)})`
            : `<b>Token:</b> ${escapeHtml(event.tokenSymbol)}`;
    } else {
        tokenLine = `<b>Token:</b> <code>${shortAddr(event.tokenMint)}</code>`;
    }

        // Twitter info line (if available)
        let twitterLine = '';
        if (token?.twitterUserInfo) {
            const { username, followersCount, followedByInfluencers } = token.twitterUserInfo;
            const formattedFollowers = formatFollowerCount(followersCount);
            twitterLine = `🐦 <b>X Account:</b> @${escapeHtml(username)} · ${formattedFollowers} followers`;
        
            if (followedByInfluencers.length > 0) {
                twitterLine += ` · ⭐ Followed by ${followedByInfluencers.length} tracked influencer(s)`;
            }
            twitterLine += '\n';
        }

    // What triggered this notification
    let matchLine: string;
    if (item.type === 'token') {
        matchLine = `📌 <b>Matched:</b> Tracked token <code>${shortAddr(item.value)}</code>`;
    } else if (item.type === 'wallet') {
        matchLine = `📌 <b>Matched:</b> Tracked wallet <code>${shortAddr(item.value)}</code>`;
    } else {
        const handle = item.value.startsWith('@') ? item.value : `@${item.value}`;
        matchLine = `📌 <b>Matched:</b> Tracked X account ${escapeHtml(handle)}`;
    }
    if (item.label) {
        matchLine += ` (${escapeHtml(item.label)})`;
    }

    const programLabel = event.programId.includes('pAMM') ? 'PumpSwap AMM' : 'Pump';

    // CA line
    const mint = event.tokenMint?.trim() || '';
    let caLine = '';
    if (mint) {
        caLine = `🧬 <b>CA:</b> <code>${mint}</code>\n`;
    } else if (event.claimType === 'claim_social_fee_pda' || event.claimType === 'claim_cashback' || event.claimType === 'collect_creator_fee') {
        caLine = `🧬 <b>CA:</b> <i>N/A (wallet-level claim)</i>\n`;
    }
    if (event.socialFeePda) {
        caLine += `🧾 <b>Social PDA:</b> <code>${shortAddr(event.socialFeePda)}</code>\n`;
    }

    const solscanTx = `https://solscan.io/tx/${encodeURIComponent(event.txSignature)}`;
    const solscanWallet = `https://solscan.io/account/${encodeURIComponent(event.claimerWallet)}`;
    const pumpfunToken = mint ? `https://pump.fun/coin/${encodeURIComponent(mint)}` : null;

    const links = pumpfunToken
        ? `🔗 <a href="${solscanTx}">TX</a> · <a href="${solscanWallet}">Wallet</a> · <a href="${pumpfunToken}">pump.fun</a>`
        : `🔗 <a href="${solscanTx}">TX</a> · <a href="${solscanWallet}">Wallet</a>`;

    return (
        `${emoji} <b>${typeLabel} Detected!</b>\n\n` +
        `👤 <b>Claimer:</b> <code>${shortWallet}</code>\n` +
        `💰 <b>Amount:</b> ${claimAmount}\n` +
        `${tokenLine}\n` +
            `${twitterLine}` +
        `${caLine}` +
        `⚙️ <b>Program:</b> ${programLabel}\n` +
        `🕐 <b>Time:</b> ${formatTime(event.timestamp)}\n` +
        `${matchLine}\n\n` +
        `${links}`
    );
}

// ============================================================================
// Settings
// ============================================================================

export function formatSettings(settings: ChatSettings, trackedCount: number): string {
    const threshold = settings.minAmount > 0
        ? `${settings.minAmount} (in each claim's own currency)`
        : 'off (every claim)';

    const whale = settings.whaleMinUsd > 0
        ? `on, ${formatUsd(settings.whaleMinUsd)}+`
        : 'off';

    return (
        `⚙️ <b>Alert Settings</b>\n\n` +
        `🔔 <b>Notifications:</b> ${settings.muted ? '🔕 muted' : '✅ on'}\n` +
        `📉 <b>Minimum claim:</b> ${threshold}\n` +
        `🐋 <b>Whale alerts:</b> ${whale}\n` +
        `📌 <b>Tracked items:</b> ${trackedCount}\n\n` +
        `<b>Change them:</b>\n` +
        `<code>/minsol 0.5</code> — only alert on claims of 0.5 or more\n` +
        `<code>/minsol 0</code> — alert on every claim\n` +
        `<code>/whale 5000</code> — alert on any claim over $5K, tracked or not\n` +
        `<code>/whale off</code> — turn whale alerts off\n` +
        `/mute — pause alerts, keep your tracked items\n` +
        `/unmute — resume alerts`
    );
}

// ============================================================================
// History
// ============================================================================

function claimLine(record: ClaimRecord): string {
    const amount = `${record.amount.toFixed(record.isStableQuote ? 2 : 4)} ${record.ticker}`;
    const who = shortAddr(record.recipientWallet || record.claimerWallet);
    const label = record.claimType.replace(/_/g, ' ');
    return `• <b>${amount}</b> · ${escapeHtml(label)} · <code>${who}</code> · ${timeAgo(record.timestamp)}`;
}

export function formatHistory(records: ClaimRecord[], target: string): string {
    if (records.length === 0) {
        return (
            `📜 <b>No claims recorded for ${escapeHtml(target)}</b>\n\n` +
            `History only covers claims seen since the bot last started. ` +
            `If this was just added, give it time: the next claim will appear here.`
        );
    }

    const lines = records.map(claimLine).join('\n');
    const totals = new Map<string, number>();
    for (const record of records) {
        totals.set(record.ticker, (totals.get(record.ticker) ?? 0) + record.amount);
    }
    const totalLine = [...totals.entries()]
        .map(([ticker, sum]) => `${sum.toFixed(ticker === 'SOL' ? 4 : 2)} ${ticker}`)
        .join(' + ');

    return (
        `📜 <b>Recent claims for ${escapeHtml(target)}</b>\n\n` +
        `${lines}\n\n` +
        `💰 <b>Total shown:</b> ${totalLine}`
    );
}

// ============================================================================
// Leaderboard
// ============================================================================

export function formatLeaderboard(
    rows: LeaderboardRow[],
    summary: { claims: number; totals: Record<string, number>; wallets: number },
    hours: number,
): string {
    if (rows.length === 0) {
        return (
            `🏆 <b>Top claimers (last ${hours}h)</b>\n\n` +
            `Nothing recorded yet in this window. The bot logs every claim it sees ` +
            `on chain, tracked or not, so this fills in as claims land.`
        );
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((row, i) => {
        const rank = medals[i] ?? `${i + 1}.`;
        const totals = Object.entries(row.totals)
            .map(([ticker, sum]) => `${sum.toFixed(ticker === 'SOL' ? 3 : 2)} ${ticker}`)
            .join(' + ');
        const link = `https://solscan.io/account/${encodeURIComponent(row.wallet)}`;
        return `${rank} <a href="${link}">${shortAddr(row.wallet)}</a> · <b>${totals}</b> · ${row.claims} claim${row.claims === 1 ? '' : 's'}`;
    }).join('\n');

    const summaryTotals = Object.entries(summary.totals)
        .map(([ticker, sum]) => `${sum.toFixed(ticker === 'SOL' ? 3 : 2)} ${ticker}`)
        .join(' + ');

    return (
        `🏆 <b>Top claimers (last ${hours}h)</b>\n\n` +
        `${lines}\n\n` +
        `📊 ${summary.claims} claims · ${summary.wallets} wallets · ${summaryTotals}`
    );
}

// ============================================================================
// Whale Alert
// ============================================================================

/**
 * A claim nobody in this chat tracks, surfaced because of its size.
 *
 * Deliberately different copy from a tracked alert: the user should never have
 * to work out why a wallet they never added just messaged them.
 */
export function formatWhaleAlert(
    event: FeeClaimEvent,
    token: TokenInfo | null,
    usdValue: number,
    thresholdUsd: number,
): string {
    const ticker = event.quoteTicker ?? 'SOL';
    const amountValue = event.amountQuote ?? event.amountSol;
    const amount = `${amountValue.toFixed(event.isStableQuote ? 2 : 4)} ${ticker}`;
    const who = event.recipientWallet || event.claimerWallet;

    const tokenLine = token
        ? `🪙 <b>Token:</b> ${escapeHtml(token.symbol)} (${escapeHtml(token.name)})\n`
        : '';

    const solscanTx = `https://solscan.io/tx/${encodeURIComponent(event.txSignature)}`;
    const solscanWallet = `https://solscan.io/account/${encodeURIComponent(who)}`;
    const mint = event.tokenMint?.trim();
    const links = mint
        ? `🔗 <a href="${solscanTx}">TX</a> · <a href="${solscanWallet}">Wallet</a> · <a href="https://pump.fun/coin/${encodeURIComponent(mint)}">pump.fun</a>`
        : `🔗 <a href="${solscanTx}">TX</a> · <a href="${solscanWallet}">Wallet</a>`;

    return (
        `🐋 <b>Whale Claim</b> ${formatUsd(usdValue)}\n\n` +
        `💰 <b>Amount:</b> ${amount}\n` +
        `👤 <b>Wallet:</b> <code>${shortAddr(who)}</code>\n` +
        `${tokenLine}` +
        `⚙️ <b>Type:</b> ${escapeHtml(event.claimLabel)}\n` +
        `🕐 <b>Time:</b> ${formatTime(event.timestamp)}\n` +
        `📌 <b>Matched:</b> whale alerts over ${formatUsd(thresholdUsd)}\n\n` +
        `${links}`
    );
}

/** One-line form of a claim, used when a burst collapses into a digest. */
export function formatDigestLine(event: FeeClaimEvent, usdValue?: number | null): string {
    const ticker = event.quoteTicker ?? 'SOL';
    const amountValue = event.amountQuote ?? event.amountSol;
    const usd = typeof usdValue === 'number' && usdValue > 0 && !event.isStableQuote
        ? ` (≈${formatUsd(usdValue)})`
        : '';
    const who = shortAddr(event.recipientWallet || event.claimerWallet);
    const link = `https://solscan.io/tx/${encodeURIComponent(event.txSignature)}`;
    const symbol = event.tokenSymbol ? ` · ${escapeHtml(event.tokenSymbol)}` : '';
    return `• <b>${amountValue.toFixed(event.isStableQuote ? 2 : 4)} ${ticker}</b>${usd}${symbol} · <code>${who}</code> · <a href="${link}">tx</a>`;
}

// ============================================================================
// Status
// ============================================================================

export interface MonitorStatus {
    isRunning: boolean;
    mode: string;
    claimsDetected: number;
    uptimeMs: number;
    trackedTokens: number;
    trackedXHandles: number;
}

export function formatStatus(status: MonitorStatus): string {
    const uptime = formatDuration(status.uptimeMs);

    return (
        `📊 <b>PumpFun Fee Claim Tracker Status</b>\n\n` +
        `⚡ <b>Running:</b> ${status.isRunning ? '✅ Yes' : '❌ No'}\n` +
        `🔌 <b>Mode:</b> ${status.mode}\n` +
        `🪙 <b>Tracked Tokens:</b> ${status.trackedTokens}\n` +
        `🐦 <b>Tracked X Accounts:</b> ${status.trackedXHandles}\n` +
        `🔔 <b>Claims Detected:</b> ${status.claimsDetected}\n` +
        `⏱️ <b>Uptime:</b> ${uptime}`
    );
}

// ============================================================================
// Utilities
// ============================================================================

function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toFixed(0);
}
