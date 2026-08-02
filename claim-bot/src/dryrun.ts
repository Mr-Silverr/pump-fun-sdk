/**
 * PumpFun Claim Bot - Monitor Dry Run
 *
 * Runs the chain monitor with no Telegram bot attached and prints every claim
 * it detects. This is how you verify detection against live mainnet before a
 * bot token exists, and how you check that a new RPC lane actually serves
 * `logsSubscribe`.
 *
 *   npm run dryrun              # 120 seconds, then a summary
 *   DRYRUN_SECONDS=300 npm run dryrun
 *
 * Nothing is mocked: it subscribes to the real programs on mainnet.
 */

import { loadConfig } from './config.js';
import { RpcClaimMonitor } from './rpc-monitor.js';
import { log, setLogLevel } from './logger.js';
import type { FeeClaimEvent } from './types.js';

const DEFAULT_SECONDS = 120;

async function main(): Promise<void> {
    const config = loadConfig({ requireTelegramToken: false });
    setLogLevel(config.logLevel);

    if (!config.solanaRpcUrl) {
        throw new Error('Dry run needs SOLANA_RPC_URL (direct RPC mode), not RELAY_WS_URL.');
    }

    const seconds = Number.parseInt(process.env.DRYRUN_SECONDS || String(DEFAULT_SECONDS), 10);
    const claims: FeeClaimEvent[] = [];

    const monitor = new RpcClaimMonitor(config, (event) => {
        claims.push(event);
        const target = event.tokenMint
            ? `mint ${event.tokenMint.slice(0, 8)}`
            : `wallet ${event.claimerWallet.slice(0, 8)}`;
        log.info(
            '  #%d %s %s SOL  %s  %s%s',
            claims.length,
            event.claimType.padEnd(29),
            event.amountSol.toFixed(4).padStart(10),
            target,
            event.txSignature.slice(0, 12),
            event.isFake ? '  (empty PDA)' : '',
        );
    });

    log.info('Dry run: monitoring mainnet for %ds (no Telegram bot attached)', seconds);
    await monitor.start();

    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

    monitor.stop();

    const byType = new Map<string, { count: number; sol: number }>();
    for (const claim of claims) {
        const entry = byType.get(claim.claimType) ?? { count: 0, sol: 0 };
        entry.count++;
        entry.sol += claim.amountSol;
        byType.set(claim.claimType, entry);
    }

    log.info('');
    log.info('Dry run complete: %d claims in %ds', claims.length, seconds);
    for (const [type, { count, sol }] of [...byType.entries()].sort((a, b) => b[1].count - a[1].count)) {
        log.info('  %s  %d claims, %s SOL', type.padEnd(30), count, sol.toFixed(4));
    }
    log.info('Monitor metrics: %s', JSON.stringify(monitor.getMetrics()));

    // A run that detected nothing means the log filter or the WS lane is broken,
    // so it must not look like a pass.
    process.exit(claims.length > 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('Dry run failed:', err);
    process.exit(1);
});
