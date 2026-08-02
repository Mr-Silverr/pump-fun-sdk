/**
 * PumpFun Claim Bot — Telegram Bot & Command Handlers
 *
 * Interactive bot with /add, /remove, /list, /status, /help commands.
 * Users track tokens (by CA) or X accounts (by handle) and get
 * notified when fee claims are detected.
 */

import { Bot } from 'grammy';
import type { Context } from 'grammy';

import type { BotConfig, FeeClaimEvent, TrackedItem } from './types.js';
import {
    escapeHtml,
    formatClaimNotification,
    formatHelp,
    formatDigestLine,
    formatHistory,
    formatLeaderboard,
    formatSettings,
    formatWhaleAlert,
    formatStatus,
    formatTrackedList,
    formatWelcome,
    type MonitorStatus,
} from './formatters.js';
import {
    claimsFor,
    recordClaim,
    topClaimers,
    windowSummary,
} from './claim-history.js';
import {
    claimKeyboard,
    decodeCallback,
    historyKeyboard,
    trackedListKeyboard,
} from './keyboards.js';
import {
    MAX_MIN_AMOUNT,
    MAX_WHALE_USD,
    MIN_WHALE_USD,
    getSettings,
    setMinAmount,
    setMuted,
    setWhaleThreshold,
    shouldNotify,
    whaleSubscribers,
} from './settings.js';
import { DeliveryQueue } from './delivery.js';
import { claimUsdValue } from './price.js';
import { fetchTokenInfo, fetchXHandlesForWallet, getXHandleFromToken } from './pump-client.js';
import { fetchTwitterUserInfo } from './twitter-client.js';
import {
    addTrackedItem,
    findMatchingTokenTracks,
    findMatchingXHandleTracks,
    findTracksByCreatorWallet,
    findTracksByWallet,
    getAllTrackedXHandles,
    getTrackedForChat,
    getTrackedItem,
    getTrackedTokensForChat,
    getTrackedXHandlesForChat,
    isAlreadyTracked,
    removeTrackedByValue,
    removeTrackedItem,
} from './store.js';
import { log } from './logger.js';
import type { ClaimMonitor } from './monitor.js';
import type { RpcClaimMonitor } from './rpc-monitor.js';

// ============================================================================
// Bot Factory
// ============================================================================

export function createBot(config: BotConfig): Bot {
    const bot = new Bot(config.telegramToken);

    bot.catch((err) => {
        log.error('Bot error:', err.error);
    });

    // ── Commands ──────────────────────────────────────────────────────
    bot.command('start', handleStart);
    bot.command('help', handleHelp);
    bot.command('add', adminOnly(handleAdd));
    bot.command('remove', adminOnly(handleRemove));
    bot.command('list', handleList);
    bot.command('history', handleHistory);
    bot.command('top', handleTop);
    bot.command('settings', handleSettings);
    bot.command('minsol', adminOnly(handleMinAmount));
    bot.command('whale', adminOnly(handleWhale));
    bot.command('mute', adminOnly((ctx) => handleMute(ctx, true)));
    bot.command('unmute', adminOnly((ctx) => handleMute(ctx, false)));
    bot.on('callback_query:data', handleCallback);
    // /status is wired in index.ts after monitor is created

    // ── Fallback ─────────────────────────────────────────────────────
    bot.on('message:text', async (ctx) => {
        if (ctx.chat.type === 'private') {
            await ctx.reply(
                '💡 Use /help to see available commands.',
                { parse_mode: 'HTML' },
            );
        }
    });

    return bot;
}

// ============================================================================
// Permissions
// ============================================================================

/**
 * Commands that change a chat's tracking or alert settings.
 *
 * In a group, one member's /remove or /mute affects everyone, so those are
 * limited to admins. In a private chat the user is the only stakeholder, and in
 * a channel there is no per-user membership to check, so both pass through.
 * Read-only commands (/list, /history, /top, /settings, /status) are never gated.
 */
async function canModify(ctx: Context): Promise<boolean> {
    const chat = ctx.chat;
    if (!chat || chat.type === 'private' || chat.type === 'channel') return true;
    if (!ctx.from) return false;

    try {
        const member = await ctx.getChatMember(ctx.from.id);
        return member.status === 'creator' || member.status === 'administrator';
    } catch (err) {
        // Telegram would not tell us. Refusing here is the safe default: a
        // failed check must not silently become an open door.
        log.warn('Could not verify admin status in chat %d: %s', chat.id, err);
        return false;
    }
}

/** Wrap a handler so it only runs for someone allowed to change this chat. */
function adminOnly(handler: (ctx: Context) => Promise<void>): (ctx: Context) => Promise<void> {
    return async (ctx: Context) => {
        if (await canModify(ctx)) {
            await handler(ctx);
            return;
        }
        await ctx.reply(
            '🔒 Only group admins can change what this chat tracks or how it alerts.\n\n' +
            'Anyone can use /list, /history, /top and /settings.',
        );
    };
}

// ============================================================================
// /start
// ============================================================================

async function handleStart(ctx: Context): Promise<void> {
    const name = ctx.from?.first_name || ctx.from?.username || 'there';
    await ctx.reply(formatWelcome(name), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
    });
}

// ============================================================================
// /help
// ============================================================================

async function handleHelp(ctx: Context): Promise<void> {
    await ctx.reply(formatHelp(), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
    });
}

// ============================================================================
// /add <token CA> or /add @handle
// ============================================================================

async function handleAdd(ctx: Context): Promise<void> {
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/).slice(1);

    if (parts.length === 0) {
        await ctx.reply(
            '📌 <b>Track a Token or X Account</b>\n\n' +
            'Usage:\n' +
            '<code>/add &lt;token CA&gt;</code> — Track a token\n' +
            '<code>/add @handle</code> — Track an X account\n\n' +
            'Examples:\n' +
            '<code>/add HN7c...4xYz</code>\n' +
            '<code>/add @elonmusk</code>',
            { parse_mode: 'HTML' },
        );
        return;
    }

    const value = parts[0]!;
    const label = parts.slice(1).join(' ') || undefined;

    // Determine type: X handle starts with @, otherwise it's a token CA
    if (value.startsWith('@')) {
        // X handle
        const handle = value.slice(1).trim();
        if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
            await ctx.reply(
                '❌ Invalid X handle. Must be 1-15 characters (letters, numbers, underscores).',
            );
            return;
        }

        if (isAlreadyTracked(handle, ctx.chat!.id)) {
            await ctx.reply(`⚠️ <b>@${escapeHtml(handle)}</b> is already being tracked.`, {
                parse_mode: 'HTML',
            });
            return;
        }

        const item = addTrackedItem(ctx.chat!.id, ctx.from!.id, 'xhandle', handle, label);
        await ctx.reply(
            `✅ <b>Now tracking X account</b>\n\n` +
            `🐦 <b>Handle:</b> @${escapeHtml(handle)}\n` +
            `🔔 You'll be notified when this account claims fees on any PumpFun token.\n\n` +
            `ID: <code>${item.id}</code>`,
            { parse_mode: 'HTML' },
        );
    } else {
        // Token CA or wallet — validate as a Solana address either way
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
            await ctx.reply(
                '❌ Invalid Solana address. Must be a base58-encoded public key (32-44 characters).\n\n' +
                '💡 To track an X account, prefix with @: <code>/add @handle</code>',
                { parse_mode: 'HTML' },
            );
            return;
        }

        if (isAlreadyTracked(value, ctx.chat!.id)) {
            await ctx.reply(`⚠️ <code>${escapeHtml(value)}</code> is already being tracked.`, {
                parse_mode: 'HTML',
            });
            return;
        }

        // A mint and a wallet are both base58 pubkeys, so ask PumpFun which one
        // this is rather than guessing from the string. Unknown to PumpFun means
        // it is a wallet, and wallet tracking needs no metadata to work.
        const tokenInfo = await fetchTokenInfo(value);

        if (!tokenInfo) {
            const item = addTrackedItem(ctx.chat!.id, ctx.from!.id, 'wallet', value, label);
            await ctx.reply(
                `✅ <b>Now tracking wallet</b>\n\n` +
                `👤 <b>Wallet:</b> <code>${escapeHtml(value)}</code>\n` +
                `🔔 You'll be notified on every fee claim this wallet signs or receives.\n\n` +
                `<i>Not a PumpFun token, so it was added as a wallet. If you meant a ` +
                `token, check the contract address.</i>`,
                { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
            );
            return;
        }

        // Resolve the creator wallet up front. Wallet-level claims name no mint,
        // so without this the token can only be matched on the rarer claim types.
        addTrackedItem(
            ctx.chat!.id,
            ctx.from!.id,
            'token',
            value,
            label,
            tokenInfo.creator || undefined,
        );

        const tokenDesc = `🪙 <b>Token:</b> ${escapeHtml(tokenInfo.symbol)} (${escapeHtml(tokenInfo.name)})`;
        const creatorLine = tokenInfo.creator
            ? `👤 <b>Creator:</b> <code>${tokenInfo.creator.slice(0, 6)}…${tokenInfo.creator.slice(-4)}</code>\n`
            : '';
        const mcapLine = tokenInfo.usdMarketCap > 0
            ? `📈 <b>Market cap:</b> $${Math.round(tokenInfo.usdMarketCap).toLocaleString('en-US')}\n`
            : '';

        await ctx.reply(
            `✅ <b>Now tracking token</b>\n\n` +
            `${tokenDesc}\n` +
            `${creatorLine}` +
            `${mcapLine}` +
            `🔔 You'll be notified when anyone claims fees for this token.`,
            { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
        );
    }
}

// ============================================================================
// /remove <token CA or @handle>
// ============================================================================

async function handleRemove(ctx: Context): Promise<void> {
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/).slice(1);

    if (parts.length === 0) {
        await ctx.reply(
            '🗑️ <b>Stop Tracking</b>\n\n' +
            'Usage: <code>/remove &lt;token CA or @handle&gt;</code>\n\n' +
            'Examples:\n' +
            '<code>/remove HN7c...4xYz</code>\n' +
            '<code>/remove @elonmusk</code>',
            { parse_mode: 'HTML' },
        );
        return;
    }

    const value = parts[0]!;
    const removed = removeTrackedByValue(value, ctx.chat!.id);

    if (removed) {
        await ctx.reply(`✅ Stopped tracking <code>${escapeHtml(value)}</code>`, {
            parse_mode: 'HTML',
        });
    } else {
        await ctx.reply(
            `❌ <code>${escapeHtml(value)}</code> is not being tracked.\n\n` +
            `Use /list to see your tracked items.`,
            { parse_mode: 'HTML' },
        );
    }
}

// ============================================================================
// /list
// ============================================================================

async function handleList(ctx: Context): Promise<void> {
    const items = getTrackedForChat(ctx.chat!.id);
    await ctx.reply(formatTrackedList(items), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: trackedListKeyboard(items),
    });
}

// ============================================================================
// /history [CA, wallet or @handle]
// ============================================================================

/**
 * Resolve what a user typed into the addresses history is keyed by.
 *
 * A tracked token's claims are recorded against its creator wallet, not its
 * mint, so looking up the mint alone would return nothing for the most common
 * claim types.
 */
function historyTargets(value: string, chatId: number): { label: string; keys: string[] } {
    const bare = value.replace(/^@/, '').toLowerCase();

    const matches = getTrackedForChat(chatId).filter(
        (item) => item.value.toLowerCase() === bare,
    );

    const keys = new Set<string>([value]);
    for (const item of matches) {
        keys.add(item.value);
        if (item.creatorWallet) keys.add(item.creatorWallet);
    }

    return { label: value, keys: [...keys] };
}

async function handleHistory(ctx: Context): Promise<void> {
    const parts = (ctx.message?.text || '').split(/\s+/).slice(1);
    const chatId = ctx.chat!.id;

    // No argument: history across everything this chat tracks.
    if (parts.length === 0) {
        const items = getTrackedForChat(chatId);
        if (items.length === 0) {
            await ctx.reply(
                '📜 <b>Nothing tracked yet</b>\n\n' +
                'Add something with <code>/add &lt;token CA&gt;</code>, then /history shows its claims.\n' +
                'Or try /top for the biggest claimers across all of PumpFun.',
                { parse_mode: 'HTML' },
            );
            return;
        }

        const keys = new Set<string>();
        for (const item of items) {
            keys.add(item.value);
            if (item.creatorWallet) keys.add(item.creatorWallet);
        }

        const records = [...keys]
            .flatMap((key) => claimsFor(key, 10))
            .filter((record, i, all) => all.findIndex((r) => r.txSignature === record.txSignature) === i)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 10);

        await ctx.reply(formatHistory(records, 'your tracked items'), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: historyKeyboard(records),
        });
        return;
    }

    const { label, keys } = historyTargets(parts[0]!, chatId);
    const records = keys
        .flatMap((key) => claimsFor(key, 10))
        .filter((record, i, all) => all.findIndex((r) => r.txSignature === record.txSignature) === i)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10);

    await ctx.reply(formatHistory(records, label), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: historyKeyboard(records),
    });
}

// ============================================================================
// /top [hours]
// ============================================================================

const MAX_LEADERBOARD_HOURS = 168;

async function handleTop(ctx: Context): Promise<void> {
    const raw = (ctx.message?.text || '').split(/\s+/)[1];
    const parsed = raw ? Number.parseFloat(raw.replace(/h$/i, '')) : 24;

    if (raw && (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_LEADERBOARD_HOURS)) {
        await ctx.reply(
            `❌ Window must be between 1 and ${MAX_LEADERBOARD_HOURS} hours.\n\n` +
            `Examples: <code>/top</code>, <code>/top 6</code>, <code>/top 168</code>`,
            { parse_mode: 'HTML' },
        );
        return;
    }

    const hours = parsed;
    await ctx.reply(formatLeaderboard(topClaimers(hours), windowSummary(hours), hours), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
    });
}

// ============================================================================
// /settings, /minsol, /mute, /unmute
// ============================================================================

async function handleSettings(ctx: Context): Promise<void> {
    const chatId = ctx.chat!.id;
    await ctx.reply(formatSettings(getSettings(chatId), getTrackedForChat(chatId).length), {
        parse_mode: 'HTML',
    });
}

async function handleMinAmount(ctx: Context): Promise<void> {
    const raw = (ctx.message?.text || '').split(/\s+/)[1];
    if (!raw) {
        await ctx.reply(
            '📉 <b>Minimum claim size</b>\n\n' +
            'Usage: <code>/minsol &lt;amount&gt;</code>\n\n' +
            `Current: <b>${getSettings(ctx.chat!.id).minAmount}</b>\n\n` +
            'The threshold applies in each claim\'s own currency, so <code>0.5</code> ' +
            'means 0.5 SOL on a SOL claim and 0.5 USDC on a USDC claim. ' +
            'Use <code>/minsol 0</code> to receive everything.',
            { parse_mode: 'HTML' },
        );
        return;
    }

    try {
        const updated = setMinAmount(ctx.chat!.id, Number.parseFloat(raw));
        await ctx.reply(
            updated.minAmount > 0
                ? `✅ Alerts now require a claim of <b>${updated.minAmount}</b> or more.`
                : '✅ Alerting on every claim, no minimum.',
            { parse_mode: 'HTML' },
        );
    } catch {
        await ctx.reply(
            `❌ Enter a number between 0 and ${MAX_MIN_AMOUNT}. Example: <code>/minsol 0.5</code>`,
            { parse_mode: 'HTML' },
        );
    }
}

async function handleWhale(ctx: Context): Promise<void> {
    const raw = (ctx.message?.text || '').split(/\s+/)[1];
    const current = getSettings(ctx.chat!.id).whaleMinUsd;

    if (!raw) {
        await ctx.reply(
            '🐋 <b>Whale alerts</b>\n\n' +
            'Alert on <b>any</b> claim above a USD value, anywhere on PumpFun, ' +
            'whether or not you track it.\n\n' +
            `Current: <b>${current > 0 ? `$${current.toLocaleString('en-US')}` : 'off'}</b>\n\n` +
            'Usage:\n' +
            '<code>/whale 5000</code> — alert on claims over $5,000\n' +
            '<code>/whale off</code> — turn it off\n\n' +
            `<i>Minimum $${MIN_WHALE_USD.toLocaleString('en-US')}: below that the whole chain is noise.</i>`,
            { parse_mode: 'HTML' },
        );
        return;
    }

    const normalized = raw.toLowerCase();
    const value = ['off', '0', 'none'].includes(normalized)
        ? 0
        : Number.parseFloat(normalized.replace(/[$,]/g, ''));

    try {
        const updated = setWhaleThreshold(ctx.chat!.id, value);
        await ctx.reply(
            updated.whaleMinUsd > 0
                ? `🐋 <b>Whale alerts on.</b> You'll hear about any claim over ` +
                  `$${updated.whaleMinUsd.toLocaleString('en-US')}, tracked or not.`
                : '🐋 <b>Whale alerts off.</b> Only your tracked items will alert.',
            { parse_mode: 'HTML' },
        );
    } catch {
        await ctx.reply(
            `❌ Enter a dollar amount between $${MIN_WHALE_USD.toLocaleString('en-US')} and ` +
            `$${MAX_WHALE_USD.toLocaleString('en-US')}, or <code>off</code>.\n\n` +
            'Example: <code>/whale 5000</code>',
            { parse_mode: 'HTML' },
        );
    }
}

async function handleMute(ctx: Context, muted: boolean): Promise<void> {
    setMuted(ctx.chat!.id, muted);
    await ctx.reply(
        muted
            ? '🔕 <b>Alerts paused.</b> Your tracked items are untouched. Resume with /unmute.'
            : '🔔 <b>Alerts resumed.</b>',
        { parse_mode: 'HTML' },
    );
}

// ============================================================================
// Inline button presses
// ============================================================================

async function handleCallback(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data;
    const chatId = ctx.chat?.id;
    if (!data || chatId === undefined) return;

    const decoded = decodeCallback(data);
    if (!decoded) {
        await ctx.answerCallbackQuery({ text: 'Unrecognized button' });
        return;
    }

    // Buttons mutate state too, so they get the same gate as the commands.
    if (decoded.action === 'untrack' && !(await canModify(ctx))) {
        await ctx.answerCallbackQuery({ text: 'Only group admins can untrack items' });
        return;
    }

    const item = getTrackedItem(decoded.id, chatId);
    if (!item) {
        await ctx.answerCallbackQuery({ text: 'That item is no longer tracked' });
        return;
    }

    if (decoded.action === 'untrack') {
        removeTrackedItem(item.id, chatId);
        await ctx.answerCallbackQuery({ text: `Untracked ${item.label || item.value.slice(0, 8)}` });
        await ctx.reply(
            `🔕 Stopped tracking <code>${escapeHtml(item.value)}</code>`,
            { parse_mode: 'HTML' },
        );
        return;
    }

    const keys = item.creatorWallet ? [item.value, item.creatorWallet] : [item.value];
    const records = keys
        .flatMap((key) => claimsFor(key, 10))
        .filter((record, i, all) => all.findIndex((r) => r.txSignature === record.txSignature) === i)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10);

    await ctx.answerCallbackQuery();
    await ctx.reply(formatHistory(records, item.label || item.value), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: historyKeyboard(records),
    });
}

// ============================================================================
// Status handler factory (needs monitor reference)
// ============================================================================

export function registerStatusCommand(bot: Bot, monitor: ClaimMonitor | RpcClaimMonitor): void {
    bot.command('status', async (ctx) => {
        const tokens = getTrackedTokensForChat(ctx.chat!.id);
        const handles = getTrackedXHandlesForChat(ctx.chat!.id);

        const status: MonitorStatus = {
            isRunning: true,
            mode: monitor.getMode(),
            claimsDetected: monitor.claimsDetected,
            uptimeMs: monitor.getUptimeMs(),
            trackedTokens: tokens.length,
            trackedXHandles: handles.length,
        };

        await ctx.reply(formatStatus(status), {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
        });
    });
}

// ============================================================================
// Claim handler factory — notifies relevant chats
// ============================================================================

/**
 * Which tracked items a claim belongs to.
 *
 * Only two claim types name a mint on chain: distribute_creator_fees, and
 * social fee claims once their PDA is resolved. Everything else sweeps a
 * creator vault and identifies nobody but the signer, so the match has to run
 * through the creator wallet: tracked token -> its creator -> this claimer.
 */
export async function findMatchingTracks(event: FeeClaimEvent): Promise<TrackedItem[]> {
    const matches = new Map<string, TrackedItem>();
    const add = (items: TrackedItem[]) => {
        for (const item of items) matches.set(item.id, item);
    };

    if (event.tokenMint) {
        add(findMatchingTokenTracks(event.tokenMint));
    }

    // Wallet-level claims: the signer, or the recipient of a social fee claim.
    // Two lookups per address: tokens whose creator this is, and the address
    // itself if someone tracked the wallet directly.
    for (const wallet of [event.claimerWallet, event.recipientWallet]) {
        if (!wallet) continue;
        add(findTracksByCreatorWallet(wallet));
        add(findTracksByWallet(wallet));
    }

    const trackedHandles = getAllTrackedXHandles();
    if (trackedHandles.size > 0) {
        const claimHandles = new Set<string>();

        if (event.tokenMint) {
            const info = await fetchTokenInfo(event.tokenMint);
            const handle = info ? getXHandleFromToken(info) : null;
            if (handle) claimHandles.add(handle);
        }

        // No mint on the claim, so ask which coins this wallet created and take
        // their X handles. Cached for 10 minutes per wallet.
        for (const wallet of [event.claimerWallet, event.recipientWallet]) {
            if (!wallet) continue;
            for (const handle of await fetchXHandlesForWallet(wallet)) {
                claimHandles.add(handle);
            }
        }

        for (const handle of claimHandles) {
            if (trackedHandles.has(handle)) {
                add(findMatchingXHandleTracks(handle));
            }
        }
    }

    return [...matches.values()];
}

export function createClaimHandler(
    config: BotConfig,
    delivery: DeliveryQueue,
): (event: FeeClaimEvent) => Promise<void> {
    return async (event: FeeClaimEvent) => {
        try {
            // Recorded whether or not anyone tracks it: /top and the /claims feed
            // report the whole chain, and a claim only tracked later still counts.
            recordClaim(event);

            const amount = event.amountQuote ?? event.amountSol;

            // Priced once per claim, then reused: the price module caches, but a
            // busy chain would still make this the most-called function here.
            const whaleChats = whaleSubscribers();
            const usdValue = whaleChats.length > 0 || amount > 0
                ? await claimUsdValue(amount, Boolean(event.isStableQuote))
                : null;

            const matches = await findMatchingTracks(event);

            // Deduplicate by chat: one wallet-level claim can hit several of a
            // chat's tracked items at once, and it is still one event.
            const notified = new Set<number>();

            for (const item of matches) {
                if (notified.has(item.chatId)) continue;
                // Muted chats and sub-threshold claims are skipped here rather
                // than earlier, so history still records everything.
                if (!shouldNotify(item.chatId, amount)) continue;
                notified.add(item.chatId);

                // Show the token the user is tracking. For an X-handle match with
                // no mint on the claim there is no single token to show.
                const displayMint = item.type === 'token' ? item.value : event.tokenMint;
                const tokenInfo = displayMint ? await fetchTokenInfo(displayMint) : null;

                if (tokenInfo) {
                    event.tokenName = tokenInfo.name;
                    event.tokenSymbol = tokenInfo.symbol;
                }

                if (tokenInfo && config.twitterBearerToken) {
                    const creatorHandle = getXHandleFromToken(tokenInfo);
                    if (creatorHandle) {
                        const twitterInfo = await fetchTwitterUserInfo(
                            creatorHandle,
                            config.twitterBearerToken,
                            config.twitterInfluencerIds,
                        );
                        if (twitterInfo) {
                            tokenInfo.twitterUserInfo = twitterInfo;
                        }
                    }
                }

                await delivery.deliver(item.chatId, {
                    html: formatClaimNotification(event, item, tokenInfo, usdValue),
                    digestLine: formatDigestLine(event, usdValue),
                    replyMarkup: claimKeyboard(event, item),
                });
            }

            // Whale alerts: size alone, no tracking required. Chats already
            // notified above are skipped so one claim is never two messages.
            if (usdValue !== null) {
                const whaleToken = event.tokenMint ? await fetchTokenInfo(event.tokenMint) : null;
                for (const chat of whaleChats) {
                    if (notified.has(chat.chatId)) continue;
                    if (usdValue < chat.whaleMinUsd) continue;
                    notified.add(chat.chatId);

                    await delivery.deliver(chat.chatId, {
                        html: formatWhaleAlert(event, whaleToken, usdValue, chat.whaleMinUsd),
                        digestLine: formatDigestLine(event, usdValue),
                    });
                }
            }

            if (notified.size > 0) {
                log.info(
                    'Notified %d chat(s) for %s by %s',
                    notified.size,
                    event.claimType,
                    event.claimerWallet.slice(0, 8),
                );
            }
        } catch (err) {
            log.error('Claim handler error: %s', err);
        }
    };
}
