/**
 * Cross-check the monitor's parsed claim amounts against on-chain balance
 * deltas, live. Run from claim-bot/ after `npm run build`:
 *
 *   VERIFY_SECONDS=180 node scripts/verify-amounts.mjs
 */
import { Connection } from '@solana/web3.js';

import { loadConfig } from '../dist/config.js';
import { RpcClaimMonitor } from '../dist/rpc-monitor.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const config = loadConfig({ requireTelegramToken: false });
const conn = new Connection(config.solanaRpcUrl, 'confirmed');
const seconds = Number(process.env.VERIFY_SECONDS || 180);

const rows = [];
const monitor = new RpcClaimMonitor(config, (event) => rows.push(event));

await monitor.start();
await new Promise((r) => setTimeout(r, seconds * 1000));
monitor.stop();

console.log(`\nVerifying ${rows.length} claims against chain state...\n`);

for (const event of rows) {
    const tx = await conn.getParsedTransaction(event.txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta) continue;

    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const target = event.recipientWallet || event.claimerWallet;
    const idx = keys.indexOf(target);
    const solDelta = idx >= 0
        ? (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9
        : null;

    const tokenRows = [];
    for (const post of tx.meta.postTokenBalances ?? []) {
        if (post.owner !== target) continue;
        const pre = (tx.meta.preTokenBalances ?? []).find((p) => p.accountIndex === post.accountIndex);
        const delta = Number(post.uiTokenAmount.uiAmount ?? 0) - Number(pre?.uiTokenAmount.uiAmount ?? 0);
        if (delta !== 0) {
            const label = post.mint === USDC ? 'USDC' : post.mint === WSOL ? 'WSOL' : post.mint.slice(0, 8);
            tokenRows.push(`${label}:${delta}`);
        }
    }

    console.log(
        [
            event.claimType.padEnd(30),
            `parsed=${event.amountSol.toFixed(4)}SOL`.padEnd(24),
            `raw=${event.amountLamports}`.padEnd(24),
            `solDelta=${solDelta === null ? 'n/a' : solDelta.toFixed(4)}`.padEnd(22),
            `tokenDelta=${tokenRows.join(',') || 'none'}`.padEnd(26),
            event.txSignature.slice(0, 16),
        ].join(' '),
    );
}

process.exit(0);
