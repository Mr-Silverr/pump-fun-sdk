/**
 * PumpFun Claim Bot - Delivery Queue
 *
 * Telegram accepts roughly 20 messages per minute to a given chat and about 30
 * per second overall. A wallet that claims in a loop, or one popular token
 * tracked by many chats, will exceed that, and the punishment for trying is a
 * 429 with a retry_after that applies to every message the bot sends.
 *
 * So delivery is budgeted rather than immediate:
 *
 *  - Each chat has a rolling per-minute budget. Inside it, alerts go out one by
 *    one, as they happen.
 *  - Past it, alerts are not dropped: they collapse into a digest that goes out
 *    when the window reopens, so a burst costs one message instead of fifty.
 *  - A 429 pauses that chat for exactly the retry_after it asked for, and the
 *    pending alerts wait rather than being lost.
 *
 * The sender is injected, so this is testable without a Telegram token.
 */

import { log } from './logger.js';

export interface DeliveryMessage {
    /** Full HTML message, used when the chat has budget. */
    html: string;
    /** One-line summary, used when the alert has to be folded into a digest. */
    digestLine: string;
    /** Inline keyboard, dropped in digests (buttons cannot address many claims). */
    replyMarkup?: unknown;
}

export interface DeliveryOptions {
    /** Messages per chat per window. Telegram's ceiling is about 20. */
    maxPerWindow?: number;
    windowMs?: number;
    /** Minimum spacing between any two sends, for the global rate limit. */
    minSpacingMs?: number;
    /** Digest lines shown before the rest are summarized as a count. */
    digestMaxLines?: number;
}

export type SendFn = (chatId: number, html: string, replyMarkup?: unknown) => Promise<void>;

interface ChatState {
    /** Send timestamps inside the current window. */
    recent: number[];
    /** Alerts that did not fit, waiting to go out as one digest. */
    pending: string[];
    /** Set when Telegram told us to back off. */
    blockedUntil: number;
    flushTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULTS: Required<DeliveryOptions> = {
    maxPerWindow: 15,
    windowMs: 60_000,
    minSpacingMs: 50,
    digestMaxLines: 12,
};

/** Seconds Telegram asked us to wait, if this error says so. */
export function retryAfterSeconds(err: unknown): number | null {
    const candidate = err as { parameters?: { retry_after?: unknown }; retry_after?: unknown };
    const value = candidate?.parameters?.retry_after ?? candidate?.retry_after;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export class DeliveryQueue {
    private chats = new Map<number, ChatState>();
    private lastSendAt = 0;
    private opts: Required<DeliveryOptions>;

    public sent = 0;
    public digested = 0;
    public rateLimitHits = 0;

    constructor(private send: SendFn, options: DeliveryOptions = {}) {
        this.opts = { ...DEFAULTS, ...options };
    }

    private state(chatId: number): ChatState {
        let state = this.chats.get(chatId);
        if (!state) {
            state = { recent: [], pending: [], blockedUntil: 0 };
            this.chats.set(chatId, state);
        }
        return state;
    }

    private budgetLeft(state: ChatState, now: number): number {
        state.recent = state.recent.filter((at) => now - at < this.opts.windowMs);
        return this.opts.maxPerWindow - state.recent.length;
    }

    /** When the oldest send in the window expires, freeing a slot. */
    private nextFreeSlotMs(state: ChatState, now: number): number {
        const oldest = state.recent[0];
        if (oldest === undefined) return 0;
        return Math.max(0, this.opts.windowMs - (now - oldest));
    }

    async deliver(chatId: number, message: DeliveryMessage): Promise<void> {
        const state = this.state(chatId);
        const now = Date.now();

        if (now < state.blockedUntil || this.budgetLeft(state, now) <= 0) {
            state.pending.push(message.digestLine);
            this.digested++;
            this.scheduleFlush(chatId);
            return;
        }

        state.recent.push(now);
        await this.dispatch(chatId, message.html, message.replyMarkup);
    }

    private async dispatch(chatId: number, html: string, replyMarkup?: unknown): Promise<void> {
        const state = this.state(chatId);

        // Global spacing, so many chats receiving at once still stay under the
        // per-second ceiling.
        const sinceLast = Date.now() - this.lastSendAt;
        if (sinceLast < this.opts.minSpacingMs) {
            await new Promise((r) => setTimeout(r, this.opts.minSpacingMs - sinceLast));
        }
        this.lastSendAt = Date.now();

        try {
            await this.send(chatId, html, replyMarkup);
            this.sent++;
        } catch (err) {
            const retryAfter = retryAfterSeconds(err);
            if (retryAfter !== null) {
                this.rateLimitHits++;
                state.blockedUntil = Date.now() + retryAfter * 1000;
                // Do not lose it: it goes out in the digest once the block lifts.
                state.pending.push(html.split('\n')[0] ?? 'claim alert');
                this.scheduleFlush(chatId);
                log.warn('Chat %d rate limited, backing off %ds', chatId, retryAfter);
                return;
            }
            log.error('Failed to deliver to chat %d: %s', chatId, err);
        }
    }

    private scheduleFlush(chatId: number): void {
        const state = this.state(chatId);
        if (state.flushTimer) return;

        const now = Date.now();
        const waitForBlock = Math.max(0, state.blockedUntil - now);
        const waitForSlot = this.nextFreeSlotMs(state, now);
        const delay = Math.max(waitForBlock, waitForSlot, 1_000);

        state.flushTimer = setTimeout(() => {
            state.flushTimer = undefined;
            void this.flush(chatId);
        }, delay);
        state.flushTimer.unref?.();
    }

    /** Send one chat's pending alerts as a single digest. */
    async flush(chatId: number): Promise<void> {
        const state = this.state(chatId);
        if (state.pending.length === 0) return;

        const now = Date.now();
        if (now < state.blockedUntil || this.budgetLeft(state, now) <= 0) {
            this.scheduleFlush(chatId);
            return;
        }

        const lines = state.pending.splice(0, state.pending.length);
        const shown = lines.slice(0, this.opts.digestMaxLines);
        const hidden = lines.length - shown.length;

        const html =
            `🔔 <b>${lines.length} more claim${lines.length === 1 ? '' : 's'}</b> ` +
            `while alerts were rate limited\n\n` +
            shown.join('\n') +
            (hidden > 0 ? `\n\n<i>and ${hidden} more</i>` : '');

        state.recent.push(now);
        await this.dispatch(chatId, html);
    }

    /** Flush every chat, for shutdown. */
    async flushAll(): Promise<void> {
        for (const [chatId, state] of this.chats) {
            if (state.flushTimer) {
                clearTimeout(state.flushTimer);
                state.flushTimer = undefined;
            }
            if (state.pending.length > 0) {
                await this.flush(chatId);
            }
        }
    }

    getMetrics(): Record<string, number> {
        let pending = 0;
        for (const state of this.chats.values()) pending += state.pending.length;
        return {
            sent: this.sent,
            digested: this.digested,
            pending,
            rateLimitHits: this.rateLimitHits,
            chats: this.chats.size,
        };
    }
}
