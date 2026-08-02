/**
 * PumpFun Claim Bot — Entry Point
 *
 * Interactive Telegram bot that lets users track PumpFun tokens (by CA)
 * and X accounts (by handle). Monitors the Solana blockchain for fee claim
 * transactions and notifies users when their tracked items are involved.
 *
 * Inspired by Bags.fm Fee Tracker Bot.
 *
 * Run:
 *   npm run dev          (hot reload)
 *   npm run build && npm start  (production)
 */

import { loadConfig } from './config.js';
import { createBot, createClaimHandler, registerStatusCommand } from './bot.js';
import { loadHistory, startHistoryFlush, stopHistoryFlush, totalRecords } from './claim-history.js';
import { DeliveryQueue } from './delivery.js';
import { startHealthServer, stopHealthServer } from './health.js';
import { loadSettings } from './settings.js';
import { ClaimMonitor } from './monitor.js';
import { RpcClaimMonitor } from './rpc-monitor.js';
import { fetchTokenInfo } from './pump-client.js';
import { flushStateMirror, hydrateState, stateBackendName } from './state-store.js';
import { getAllTrackedTokens, loadTracked, setCreatorWalletForMint } from './store.js';
import { log, setLogLevel } from './logger.js';

/**
 * Fill in creator wallets for tokens tracked before the wallet was recorded, or
 * whose lookup failed at /add time. Without one, a token can only be matched on
 * the claim types that name a mint, which is a small minority of claims.
 */
async function backfillCreatorWallets(): Promise<void> {
    const pending = getAllTrackedTokens().filter((item) => !item.creatorWallet);
    if (pending.length === 0) return;

    const mints = [...new Set(pending.map((item) => item.value))];
    log.info('Backfilling creator wallets for %d tracked token(s)...', mints.length);

    let resolved = 0;
    for (const mint of mints) {
        const info = await fetchTokenInfo(mint);
        if (info?.creator) {
            setCreatorWalletForMint(mint, info.creator);
            resolved++;
        }
    }
    log.info('Creator wallets resolved: %d/%d', resolved, mints.length);
}

/** Published to Telegram so the client shows a command menu. */
const BOT_COMMANDS = [
    { command: 'add', description: 'Track a token CA, a wallet, or an @handle' },
    { command: 'remove', description: 'Stop tracking something' },
    { command: 'list', description: 'Everything this chat tracks' },
    { command: 'history', description: 'Recent claims for a tracked item' },
    { command: 'top', description: 'Biggest claimers, default last 24h' },
    { command: 'settings', description: 'Show alert settings' },
    { command: 'minsol', description: 'Skip claims below an amount' },
    { command: 'whale', description: 'Alert on any claim over a USD value' },
    { command: 'mute', description: 'Pause alerts' },
    { command: 'unmute', description: 'Resume alerts' },
    { command: 'status', description: 'Monitor status and stats' },
    { command: 'help', description: 'Full command list' },
];

async function main(): Promise<void> {
    const startedAt = Date.now();
    const config = loadConfig();
    setLogLevel(config.logLevel);

    log.info('PumpFun Claim Bot starting...');

    // Pull state back from the durable mirror before anything reads local disk.
    // On Cloud Run the container filesystem is scratch space, so without this a
    // redeploy would drop every user's tracked list.
    await hydrateState();

    // Load persisted state: tracked items, per-chat alert settings, claim history
    loadTracked();
    loadSettings();
    loadHistory();
    startHistoryFlush();
    await backfillCreatorWallets();

    // Create bot
    const bot = createBot(config);

    // Every outbound alert goes through the delivery queue, which keeps the bot
    // inside Telegram's per-chat rate limit and folds bursts into digests.
    const delivery = new DeliveryQueue(async (chatId, html, replyMarkup) => {
        await bot.api.sendMessage(chatId, html, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...(replyMarkup ? { reply_markup: replyMarkup as never } : {}),
        });
    });

    // Wire claim handler
    const claimHandler = createClaimHandler(config, delivery);

    // Create claim monitor — use direct RPC if SOLANA_RPC_URL is set, otherwise relay
    const onClaimEvent = (event: Parameters<typeof claimHandler>[0]) => {
        claimHandler(event).catch((err) => log.error('Claim handler error: %s', err));
    };

    let monitor: ClaimMonitor | RpcClaimMonitor;
    if (config.solanaRpcUrl) {
        log.info('Mode: Direct RPC monitoring');
        log.info('  RPC: %s', config.solanaRpcUrl.replace(/api-key=[\w-]+/, 'api-key=***'));
        if (config.solanaWsUrl) {
            log.info('  WS:  %s', config.solanaWsUrl.replace(/api-key=[\w-]+/, 'api-key=***'));
        }
        monitor = new RpcClaimMonitor(config, onClaimEvent);
    } else {
        log.info('Mode: WebSocket relay');
        log.info('  Relay: %s', config.relayWsUrl);
        monitor = new ClaimMonitor(config, onClaimEvent);
    }

    // Wire status command (needs monitor reference)
    registerStatusCommand(bot, monitor);

    // Start monitor
    await monitor.start();

    // Health endpoint: liveness for Cloud Run / Railway / Docker probes, and a
    // way to answer "is it still seeing claims?" without reading logs.
    startHealthServer({
        startedAt,
        getStats: () => ({
            ...(monitor instanceof RpcClaimMonitor
                ? monitor.getMetrics()
                : { mode: monitor.getMode(), claimsDetected: monitor.claimsDetected }),
            trackedTokens: getAllTrackedTokens().length,
            state: stateBackendName(),
            delivery: delivery.getMetrics(),
        }),
    });

    // Check the token before long polling starts. Without this, a wrong or
    // revoked token surfaces as a raw getMe stack trace from a crash-looping
    // container, which says nothing about what to fix.
    try {
        const me = await bot.api.getMe();
        log.info('Authenticated with Telegram as @%s (id %d)', me.username, me.id);
    } catch (err) {
        const detail = (err as { description?: string }).description ?? String(err);
        log.error('Telegram rejected TELEGRAM_BOT_TOKEN: %s', detail);
        log.error('Get a fresh token from @BotFather (/mybots -> API Token) and redeploy.');
        process.exit(1);
    }

    // Publish the command list so Telegram's menu shows every command.
    await bot.api.setMyCommands(BOT_COMMANDS).catch((err) => {
        log.warn('Could not publish command menu: %s', err);
    });

    log.info('Claim history: %d records loaded', totalRecords());

    // Start bot (long polling)
    log.info('Starting Telegram bot (long polling)...');
    bot.start({
        onStart: () => {
            log.info('✅ PumpFun Claim Bot is running!');
        },
    }).catch((err) => {
        log.error('Telegram long polling stopped: %s', err);
        process.exit(1);
    });

    // Graceful shutdown
    const shutdown = async () => {
        log.info('Shutting down...');
        // Anything still queued goes out as a digest rather than being dropped.
        await delivery.flushAll().catch((err) => log.warn('Delivery flush failed: %s', err));
        stopHistoryFlush();
        // stopHistoryFlush wrote the last claims to disk; push everything still
        // debounced to the mirror before the container goes away.
        await flushStateMirror().catch((err) => log.warn('State mirror flush failed: %s', err));
        stopHealthServer();
        monitor.stop();
        await bot.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
