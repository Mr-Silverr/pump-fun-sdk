/**
 * PumpFun Claim Bot - Direct Solana RPC Monitor
 *
 * Monitors the Pump, PumpSwap, and PumpFees programs directly via Solana RPC.
 * WebSocket log subscriptions when a WS endpoint is available, HTTP polling as
 * a loud fallback. No relay server needed.
 *
 * Claim amounts and metadata come from the Anchor event data on the
 * "Program data:" log lines rather than from balance diffing: a creator fee
 * claim routed through a CPI moves lamports the signer never sees.
 */

import {
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    type Logs,
    type ParsedInstruction,
    type ParsedTransactionWithMeta,
    type PartiallyDecodedInstruction,
    type SignaturesForAddressOptions,
} from '@solana/web3.js';
import bs58 from 'bs58';

import { classifyClaimLogs } from './claim-logs.js';
import { deriveWsUrl } from './config.js';
import { log } from './logger.js';
import { RpcFallback, maskUrl } from './rpc-fallback.js';
import type { BotConfig, FeeClaimEvent, InstructionDef } from './types.js';
import { CLAIM_INSTRUCTIONS, MONITORED_PROGRAM_IDS, QUOTE_MINT_INFO, WSOL_MINT } from './types.js';

// ── Tuning ──────────────────────────────────────────────────────────

/** Queue depth before new signatures are dropped rather than delaying live ones. */
const MAX_QUEUE = 50;
/** Minimum spacing between transaction fetches, to stay inside free-lane rate limits. */
const MIN_INTERVAL_MS = 1_000;
/** Signatures fetched per program per poll tick (polling mode only). */
const POLL_SIGNATURE_LIMIT = 20;
const WS_HEARTBEAT_INTERVAL_MS = 60_000;
const WS_SILENCE_TIMEOUT_MS = 90_000;
const MAX_PROCESSED_CACHE = 10_000;
/** Below this, the amount is rounding dust from a partially parsed event. */
const MIN_CLAIM_LAMPORTS = 1_000;

// ── Event discriminators (hex of the first 8 bytes of a Program data: line) ──

const COLLECT_CREATOR_FEE_EVENT = '7a027f010ebf0caf';
const DISTRIBUTE_CREATOR_FEES_EVENT = 'a537817004b3ca28';
const CLAIM_CASHBACK_EVENT = 'e2d6f62107f293e5';
const COLLECT_COIN_CREATOR_FEE_EVENT = 'e8f5c2eeeada3a59';
const SOCIAL_FEE_PDA_CLAIMED_EVENT = '3212c141edd2eaec';

// ── Rate-limited queue ──────────────────────────────────────────────

class TxQueue {
    private queue: string[] = [];
    private processing = false;
    private lastTime = 0;
    public drops = 0;

    constructor(private processFn: (sig: string) => Promise<void>) {}

    enqueue(sig: string): void {
        if (this.queue.length >= MAX_QUEUE) {
            this.drops++;
            return;
        }
        this.queue.push(sig);
        void this.drain();
    }

    private async drain(): Promise<void> {
        if (this.processing) return;
        this.processing = true;
        while (this.queue.length > 0) {
            const elapsed = Date.now() - this.lastTime;
            if (elapsed < MIN_INTERVAL_MS) {
                await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
            }
            const sig = this.queue.shift();
            if (!sig) break;
            this.lastTime = Date.now();
            try {
                await this.processFn(sig);
            } catch (e) {
                log.error('Queue error: %s', e instanceof Error ? e.message : e);
            }
        }
        this.processing = false;
    }
}

// ============================================================================
// RpcClaimMonitor
// ============================================================================

export class RpcClaimMonitor {
    private rpc: RpcFallback;
    private wsConnection?: Connection;
    private wsSubscriptionIds: number[] = [];
    private wsHeartbeatTimer?: ReturnType<typeof setInterval>;
    private lastWsEventTime = 0;
    private wsEventsReceived = 0;
    private claimTxSeen = 0;
    private pollTimer?: ReturnType<typeof setTimeout>;
    private lastSignatures = new Map<string, string | undefined>();
    private processedSigs = new Set<string>();
    private txQueue: TxQueue;
    private programPubkeys: PublicKey[];
    private alive = false;
    private startedAt = 0;
    private transport: 'websocket' | 'polling' | 'stopped' = 'stopped';
    private pollIntervalMs: number;

    public claimsDetected = 0;

    constructor(
        private config: BotConfig,
        private onClaim: (event: FeeClaimEvent) => void,
    ) {
        const urls = config.solanaRpcUrls.length > 0
            ? config.solanaRpcUrls
            : [config.solanaRpcUrl!];
        this.rpc = new RpcFallback(urls, {
            commitment: 'confirmed',
            disableRetryOnRateLimit: true,
        });
        this.pollIntervalMs = (config.pollIntervalSeconds ?? 15) * 1000;
        this.programPubkeys = MONITORED_PROGRAM_IDS.map((id) => new PublicKey(id));
        this.txQueue = new TxQueue((sig) => this.processTransaction(sig));
    }

    async start(): Promise<void> {
        if (this.alive) return;
        this.alive = true;
        this.startedAt = Date.now();

        log.info('Starting RPC claim monitor (%d programs)', this.programPubkeys.length);
        log.info('  RPC: %s (%d endpoint(s) in rotation)', maskUrl(this.rpc.currentUrl), this.rpc.size);

        // Use whatever WS URL the config resolved (explicit or derived). Gating
        // this on the raw env var leaves a derived URL permanently unreachable.
        if (this.config.solanaWsUrl) {
            try {
                this.subscribeLogs();
                this.startHeartbeat();
                this.transport = 'websocket';
                log.info('RPC monitor: WebSocket mode (%s)', maskUrl(this.currentWsUrl()));
                return;
            } catch (err) {
                log.warn('WS failed, falling back to polling: %s', err);
            }
        }

        this.startPolling();
        this.transport = 'polling';
        log.warn(
            'RPC monitor: POLLING mode (every %ds). Polling samples only the %d most recent signatures ' +
            'per program per tick, so on a busy chain it WILL miss claims. Set SOLANA_WS_URL to a ' +
            'WebSocket-capable RPC for complete coverage.',
            this.pollIntervalMs / 1000,
            POLL_SIGNATURE_LIMIT,
        );
    }

    stop(): void {
        this.alive = false;
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
            this.wsHeartbeatTimer = undefined;
        }
        this.teardownWebSocket();
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
        this.transport = 'stopped';
        log.info('RPC claim monitor stopped');
    }

    getMode(): string {
        switch (this.transport) {
            case 'websocket':
                return `rpc-ws (${maskUrl(this.currentWsUrl())})`;
            case 'polling':
                return `rpc-poll (every ${this.pollIntervalMs / 1000}s)`;
            default:
                return 'stopped';
        }
    }

    getUptimeMs(): number {
        return this.startedAt ? Date.now() - this.startedAt : 0;
    }

    getMetrics(): Record<string, unknown> {
        return {
            mode: this.transport,
            claimsDetected: this.claimsDetected,
            claimTxSeen: this.claimTxSeen,
            wsEventsReceived: this.wsEventsReceived,
            queueDrops: this.txQueue.drops,
            activeRpc: maskUrl(this.rpc.currentUrl),
            rpcEndpoints: this.rpc.size,
            uptimeMs: this.getUptimeMs(),
        };
    }

    // ── WebSocket subscription ──────────────────────────────────────

    /**
     * WebSocket endpoint for the lane currently in use. An explicit
     * SOLANA_WS_URL pins the endpoint; otherwise it follows the rotating HTTP
     * lane, so a rotation actually moves the log stream too.
     */
    private currentWsUrl(): string | undefined {
        if (process.env.SOLANA_WS_URL) return process.env.SOLANA_WS_URL;
        return deriveWsUrl(this.rpc.currentUrl) ?? this.config.solanaWsUrl;
    }

    private subscribeLogs(): void {
        this.wsConnection = new Connection(this.rpc.currentUrl, {
            commitment: 'confirmed',
            wsEndpoint: this.currentWsUrl(),
            disableRetryOnRateLimit: true,
        });
        this.lastWsEventTime = Date.now();

        for (const programId of this.programPubkeys) {
            const subId = this.wsConnection.onLogs(
                programId,
                (logInfo: Logs) => {
                    this.lastWsEventTime = Date.now();
                    this.wsEventsReceived++;
                    this.handleLogEvent(logInfo);
                },
                'confirmed',
            );
            this.wsSubscriptionIds.push(subId);
        }
    }

    private startHeartbeat(): void {
        this.wsHeartbeatTimer = setInterval(() => {
            if (!this.alive) return;
            const silentMs = Date.now() - this.lastWsEventTime;
            if (silentMs > WS_SILENCE_TIMEOUT_MS) {
                // A lane that accepts the socket but never delivers logs raises no
                // RPC error, so nothing else would ever move us off it.
                log.warn(
                    'WS silent for %ds on %s, rotating lane and reconnecting...',
                    Math.floor(silentMs / 1000),
                    maskUrl(this.rpc.currentUrl),
                );
                this.rpc.rotateNow();
                this.reconnectWebSocket();
                return;
            }
            log.info(
                'WS heartbeat: %d log events, %d claim txs seen, %d claims parsed, %d queue drops',
                this.wsEventsReceived,
                this.claimTxSeen,
                this.claimsDetected,
                this.txQueue.drops,
            );
        }, WS_HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Decide whether a signature is worth fetching.
     *
     * Cashback is excluded on purpose: it is a trader refund with no mint and no
     * creator, so it can never match a tracked token or X handle, and it is the
     * highest-volume claim on chain. Fetching it would starve the queue of the
     * creator claims users actually asked for.
     */
    private handleLogEvent(logInfo: Logs): void {
        if (logInfo.err) return;
        const sig = logInfo.signature;
        if (this.processedSigs.has(sig)) return;

        const { hasClaim } = classifyClaimLogs(logInfo.logs);
        if (!hasClaim) return;

        this.processedSigs.add(sig);
        this.trimProcessedCache();
        this.claimTxSeen++;
        this.txQueue.enqueue(sig);
    }

    private teardownWebSocket(): void {
        if (!this.wsConnection) return;
        for (const id of this.wsSubscriptionIds) {
            this.wsConnection.removeOnLogsListener(id).catch(() => {});
        }
        this.wsSubscriptionIds = [];
        this.wsConnection = undefined;
    }

    private reconnectWebSocket(): void {
        if (!this.alive) return;
        this.teardownWebSocket();
        try {
            this.subscribeLogs();
        } catch (err) {
            log.warn('WS reconnect failed, falling back to polling: %s', err);
            if (this.wsHeartbeatTimer) {
                clearInterval(this.wsHeartbeatTimer);
                this.wsHeartbeatTimer = undefined;
            }
            this.transport = 'polling';
            this.startPolling();
        }
    }

    // ── HTTP polling ────────────────────────────────────────────────

    private startPolling(): void {
        const poll = async () => {
            if (!this.alive) return;
            try {
                await this.pollAll();
            } catch (err) {
                log.warn('Poll error: %s', err instanceof Error ? err.message : err);
            }
            if (this.alive) {
                this.pollTimer = setTimeout(() => void poll(), this.pollIntervalMs);
            }
        };
        void poll();
    }

    private async pollAll(): Promise<void> {
        for (const programId of this.programPubkeys) {
            const key = programId.toBase58();
            const opts: SignaturesForAddressOptions = { limit: POLL_SIGNATURE_LIMIT };
            const lastSig = this.lastSignatures.get(key);
            if (lastSig) opts.until = lastSig;

            const sigs = await this.rpc.withFallback((conn) =>
                conn.getSignaturesForAddress(programId, opts),
            );
            if (sigs.length === 0) continue;
            this.lastSignatures.set(key, sigs[0]!.signature);

            for (const info of sigs) {
                if (info.err) continue;
                if (this.processedSigs.has(info.signature)) continue;
                this.processedSigs.add(info.signature);
                this.txQueue.enqueue(info.signature);
            }
        }
        this.trimProcessedCache();
    }

    // ── Transaction processing ──────────────────────────────────────

    private async processTransaction(signature: string): Promise<void> {
        const tx = await this.rpc.withFallback((conn) =>
            conn.getParsedTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            }),
        );
        if (!tx?.meta || tx.meta.err) return;

        // Inner instructions count. A claim invoked through a router or a trading
        // bot never appears at the top level, and on mainnet that is roughly half
        // of all claim transactions.
        const instructions = [
            ...tx.transaction.message.instructions,
            ...(tx.meta.innerInstructions ?? []).flatMap((inner) => inner.instructions),
        ];

        // One payout often shows up as two instructions in the same transaction:
        // the AMM collect that moves fees into the creator vault, and the Pump
        // collect that empties it. Same wallet, same lamports, one notification.
        const emitted = new Set<string>();

        for (const ix of instructions) {
            if (!('data' in ix) || !ix.data) continue;
            const matched = this.matchClaimInstruction(ix.data, ix.programId.toBase58());
            if (!matched) continue;

            const event = this.buildClaimEvent(signature, tx, matched, ix);
            if (!event) continue;

            const payoutKey = `${event.claimerWallet}:${event.amountLamports}:${event.tokenMint}`;
            if (emitted.has(payoutKey)) continue;
            emitted.add(payoutKey);

            this.claimsDetected++;
            log.info(
                'Claim: %s %s %s (%s)',
                event.claimType,
                (event.amountQuote ?? event.amountSol).toFixed(event.isStableQuote ? 2 : 4),
                event.quoteTicker ?? 'SOL',
                event.tokenMint ? event.tokenMint.slice(0, 8) : 'wallet-level',
            );
            this.onClaim(event);
        }
    }

    private matchClaimInstruction(data: string, programId: string): InstructionDef | undefined {
        try {
            const bytes = bs58.decode(data);
            if (bytes.length < 8) return undefined;
            const disc = Buffer.from(bytes.subarray(0, 8)).toString('hex');
            return CLAIM_INSTRUCTIONS.find(
                (def) => def.discriminator === disc && def.programId === programId,
            );
        } catch {
            return undefined;
        }
    }

    private buildClaimEvent(
        signature: string,
        tx: ParsedTransactionWithMeta,
        def: InstructionDef,
        ix: ParsedInstruction | PartiallyDecodedInstruction,
    ): FeeClaimEvent | null {
        const accountKeys = tx.transaction.message.accountKeys;
        const claimerWallet = accountKeys.find((a) => a.signer)?.pubkey?.toBase58();
        if (!claimerWallet) return null;

        let tokenMint = '';
        let amountLamports = 0;
        let githubUserId: string | undefined;
        let socialPlatform: number | undefined;
        let recipientWallet: string | undefined;
        let socialFeePda: string | undefined;
        let quoteMint: string | undefined;

        // distribute_creator_fees passes the mint as its first account.
        if (def.claimType === 'distribute_creator_fees' && 'accounts' in ix && ix.accounts?.length) {
            tokenMint = ix.accounts[0]!.toBase58();
        }

        for (const line of tx.meta?.logMessages ?? []) {
            if (!line.includes('Program data:')) continue;
            const b64 = line.split('Program data: ')[1]?.trim();
            if (!b64) continue;
            try {
                const bytes = Buffer.from(b64, 'base64');
                if (bytes.length < 8) continue;
                const disc = Buffer.from(bytes.subarray(0, 8)).toString('hex');
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

                // DistributeCreatorFeesEvent:
                // disc(8) timestamp(8) mint(32) bondingCurve(32) sharingConfig(32)
                // admin(32) shareholders(4 + n*34) distributed(8) [quoteMint(32) in V2]
                if (disc === DISTRIBUTE_CREATOR_FEES_EVENT && def.claimType === 'distribute_creator_fees') {
                    if (bytes.length >= 48) {
                        tokenMint = new PublicKey(bytes.subarray(16, 48)).toBase58();
                    }
                    // Walk the shareholder vector to find `distributed`. Reading
                    // from the end would misread the V2 trailing quote_mint.
                    const shareVecOffset = 144;
                    if (bytes.length >= shareVecOffset + 4) {
                        const shareCount = bytes.readUInt32LE(shareVecOffset);
                        const distributedOffset = shareVecOffset + 4 + shareCount * 34;
                        if (bytes.length >= distributedOffset + 8) {
                            amountLamports = Number(view.getBigUint64(distributedOffset, true));
                        }
                        const quoteOffset = distributedOffset + 8;
                        if (bytes.length >= quoteOffset + 32) {
                            quoteMint = new PublicKey(bytes.subarray(quoteOffset, quoteOffset + 32)).toBase58();
                        }
                    }
                }

                // CollectCreatorFeeEvent: disc(8) timestamp(8) creator(32) creatorFee(8)
                // [quoteMint(32) in V2]
                if (disc === COLLECT_CREATOR_FEE_EVENT && bytes.length >= 56) {
                    amountLamports = Number(view.getBigUint64(48, true));
                    if (bytes.length >= 88) {
                        quoteMint = new PublicKey(bytes.subarray(56, 88)).toBase58();
                    }
                }

                // CollectCoinCreatorFeeEvent: disc(8) timestamp(8) coinCreator(32) fee(8)
                // [quoteMint(32) in V2]
                if (disc === COLLECT_COIN_CREATOR_FEE_EVENT && bytes.length >= 56) {
                    amountLamports = Number(view.getBigUint64(48, true));
                    if (bytes.length >= 88) {
                        quoteMint = new PublicKey(bytes.subarray(56, 88)).toBase58();
                    }
                }

                // ClaimCashbackEvent: disc(8) user(32) amount(8) ...
                if (disc === CLAIM_CASHBACK_EVENT && bytes.length >= 48) {
                    amountLamports = Number(view.getBigUint64(40, true));
                }

                // SocialFeePdaClaimed: disc(8) timestamp(8) userId(4+n) platform(1)
                // socialFeePda(32) recipient(32) claimAuthority(32) amountClaimed(8) ...
                if (disc === SOCIAL_FEE_PDA_CLAIMED_EVENT && def.claimType === 'claim_social_fee_pda') {
                    let offset = 16;
                    if (bytes.length >= offset + 4) {
                        const uidLen = bytes.readUInt32LE(offset);
                        offset += 4;
                        if (uidLen > 0 && uidLen <= 64 && bytes.length >= offset + uidLen) {
                            githubUserId = Buffer.from(bytes.subarray(offset, offset + uidLen)).toString('utf8');
                            offset += uidLen;
                        }
                    }
                    if (bytes.length >= offset + 1) {
                        socialPlatform = bytes[offset]!;
                        offset += 1;
                    }
                    if (bytes.length >= offset + 32) {
                        socialFeePda = new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
                        offset += 32;
                    }
                    if (bytes.length >= offset + 32) {
                        recipientWallet = new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
                        offset += 32;
                    }
                    offset += 32; // social_claim_authority
                    if (bytes.length >= offset + 8) {
                        amountLamports = Number(view.getBigUint64(offset, true));
                        offset += 8;
                    }
                    // claimable_before(8) + lifetime_claimed(8), then V2 adds
                    // recipient_balance_before(8) + recipient_balance_after(8) + quote_mint(32)
                    offset += 16;
                    if (bytes.length >= offset + 16 + 32) {
                        offset += 16;
                        quoteMint = new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
                    }
                }
            } catch {
                // Unparseable log line, ignore it.
            }
        }

        // Fallback: the signer's balance increase, for a claim whose event layout
        // this build does not know yet.
        if (amountLamports === 0) {
            const pre = tx.meta?.preBalances ?? [];
            const post = tx.meta?.postBalances ?? [];
            const signerIdx = accountKeys.findIndex((a) => a.pubkey.toBase58() === claimerWallet);
            if (signerIdx >= 0) {
                const diff = (post[signerIdx] ?? 0) - (pre[signerIdx] ?? 0);
                if (diff > 0) amountLamports = diff;
            }
        }

        // A social claim that emitted no event moved nothing: the PDA was empty.
        const isFake = def.claimType === 'claim_social_fee_pda' && amountLamports === 0;
        if (!isFake && amountLamports < MIN_CLAIM_LAMPORTS) return null;

        if (isFake && !socialFeePda && 'accounts' in ix && ix.accounts && ix.accounts.length >= 2) {
            socialFeePda = ix.accounts[1]?.toBase58();
        }

        // Coins can be quoted in USDC as well as SOL, and the event amount is in
        // base units of that quote mint. Dividing a USDC amount by 1e9 would
        // report a claim a thousand times smaller, in the wrong currency.
        const resolvedQuoteMint = quoteMint && quoteMint in QUOTE_MINT_INFO ? quoteMint : WSOL_MINT;
        const quoteInfo = QUOTE_MINT_INFO[resolvedQuoteMint]!;
        const amountQuote = amountLamports / 10 ** quoteInfo.decimals;

        return {
            txSignature: signature,
            slot: tx.slot,
            timestamp: tx.blockTime ?? Math.floor(Date.now() / 1000),
            claimerWallet,
            tokenMint,
            // Only meaningful for SOL-quoted claims; the formatter branches on
            // isStableQuote rather than assuming this is the amount.
            amountSol: quoteInfo.isStable ? 0 : amountLamports / LAMPORTS_PER_SOL,
            amountLamports,
            quoteMint: resolvedQuoteMint,
            quoteTicker: quoteInfo.ticker,
            isStableQuote: quoteInfo.isStable,
            amountQuote,
            claimType: def.claimType,
            isCashback: !def.isCreatorClaim,
            programId: def.programId,
            claimLabel: def.label,
            githubUserId,
            socialPlatform,
            recipientWallet,
            socialFeePda,
            isFake,
        };
    }

    private trimProcessedCache(): void {
        if (this.processedSigs.size > MAX_PROCESSED_CACHE) {
            const arr = [...this.processedSigs];
            this.processedSigs = new Set(arr.slice(-5_000));
        }
    }
}
