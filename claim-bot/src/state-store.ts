/**
 * PumpFun Claim Bot - Durable State Mirror
 *
 * The bot keeps its state in small JSON files under DATA_DIR: tracked items,
 * per-chat alert settings, and the claim log. On a laptop or a VM that is
 * durable storage. On Cloud Run it is not: the container filesystem is scratch
 * space, so a redeploy, a crash, or an instance replacement would silently drop
 * every user's tracked list and every muted chat's preference.
 *
 * This module mirrors those files to a Cloud Storage bucket when STATE_BUCKET
 * is set. Local disk stays the working copy, so every read and write elsewhere
 * in the bot stays synchronous and unchanged; the bucket is hydrated once at
 * boot and updated on a short debounce after each write.
 *
 * With STATE_BUCKET unset there is no backend, no dependency is loaded, and the
 * bot behaves exactly as it did before: local files only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { log } from './logger.js';

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

/** State files the bot owns. Hydrated at boot, mirrored after every write. */
export const STATE_FILES = ['tracked.json', 'settings.json', 'claims.json'] as const;
export type StateFile = (typeof STATE_FILES)[number];

/** Writes are coalesced: a burst of /add commands is one upload, not five. */
const MIRROR_DEBOUNCE_MS = 2_000;
/** A failed upload backs off and retries rather than being lost until the next write. */
const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];
/** Cloud Run allows a short grace period on SIGTERM, so shutdown retries fast and few. */
const SHUTDOWN_ATTEMPTS = 3;
const SHUTDOWN_RETRY_MS = 500;

export interface StateBackend {
    /** Object contents, or undefined when the object does not exist yet. */
    download(name: string): Promise<string | undefined>;
    upload(name: string, contents: string): Promise<void>;
    /** Human-readable location, surfaced on /health. */
    describe(): string;
}

let backend: StateBackend | null = null;
let backendResolved = false;

interface PendingWrite {
    timer: ReturnType<typeof setTimeout>;
    attempt: number;
}

const pending = new Map<string, PendingWrite>();
/** Uploads are chained so two writes of the same file can never land out of order. */
let uploadChain: Promise<void> = Promise.resolve();

export function ensureDataDir(): void {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}

// ============================================================================
// Backend selection
// ============================================================================

async function createGcsBackend(bucketName: string, prefix: string): Promise<StateBackend> {
    const { Storage } = await import('@google-cloud/storage');
    const bucket = new Storage().bucket(bucketName);

    return {
        describe: () => `gs://${bucketName}/${prefix}`,

        async download(name) {
            const file = bucket.file(`${prefix}${name}`);
            try {
                const [buf] = await file.download();
                return buf.toString('utf-8');
            } catch (err) {
                if ((err as { code?: number }).code === 404) return undefined;
                throw err;
            }
        },

        async upload(name, contents) {
            await bucket.file(`${prefix}${name}`).save(contents, {
                contentType: 'application/json',
                resumable: false,
            });
        },
    };
}

/**
 * Resolve the mirror backend once. Returns null when STATE_BUCKET is unset, or
 * when the Cloud Storage client cannot be loaded: a missing mirror degrades the
 * bot to local-only state, it never stops it from serving users.
 */
async function getBackend(): Promise<StateBackend | null> {
    if (backendResolved) return backend;
    backendResolved = true;

    const bucketName = process.env.STATE_BUCKET?.trim();
    if (!bucketName) return null;

    const prefix = normalizePrefix(process.env.STATE_PREFIX ?? 'claim-bot/');
    try {
        backend = await createGcsBackend(bucketName, prefix);
        log.info('Durable state: %s', backend.describe());
    } catch (err) {
        log.error('Durable state unavailable (%s), falling back to local disk only', err);
        backend = null;
    }
    return backend;
}

function normalizePrefix(raw: string): string {
    const trimmed = raw.trim().replace(/^\/+/, '');
    if (!trimmed) return '';
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/** Where state is mirrored, for /health and /status. Empty until hydrate runs. */
export function stateBackendName(): string {
    return backend ? backend.describe() : 'local';
}

// ============================================================================
// Boot hydration
// ============================================================================

/**
 * Pull every state file from the mirror into DATA_DIR before the loaders read
 * it. A local file that already exists is overwritten: the bucket is the source
 * of truth, and on Cloud Run the local copy is either absent or a stale layer
 * baked into the image.
 */
export async function hydrateState(files: readonly string[] = STATE_FILES): Promise<void> {
    const store = await getBackend();
    if (!store) return;

    ensureDataDir();
    for (const name of files) {
        try {
            const contents = await store.download(name);
            if (contents === undefined) continue;
            writeFileSync(join(DATA_DIR, name), contents, 'utf-8');
            log.info('Restored %s from %s (%d bytes)', name, store.describe(), contents.length);
        } catch (err) {
            log.error('Could not restore %s from durable state: %s', name, err);
        }
    }
}

// ============================================================================
// Write mirroring
// ============================================================================

/**
 * Queue a mirror upload for a file that was just written to DATA_DIR.
 *
 * Fire and forget by design: the local write already succeeded, so the caller
 * (a Telegram command handler) must not wait on network I/O to reply.
 */
export function mirrorState(name: string): void {
    if (!backend && backendResolved) return;
    schedule(name, 0, MIRROR_DEBOUNCE_MS);
}

function schedule(name: string, attempt: number, delayMs: number): void {
    const existing = pending.get(name);
    if (existing) {
        // A fresh write supersedes a pending retry: reset the backoff.
        clearTimeout(existing.timer);
        if (attempt === 0) existing.attempt = 0;
    }

    const timer = setTimeout(() => {
        pending.delete(name);
        uploadChain = uploadChain.then(() => upload(name, attempt)).catch(() => undefined);
    }, delayMs);
    timer.unref?.();

    pending.set(name, { attempt, timer });
}

/** One upload attempt. Resolves to the error on failure, undefined on success. */
async function attemptUpload(name: string): Promise<unknown> {
    const store = await getBackend();
    if (!store) return undefined;

    const path = join(DATA_DIR, name);
    if (!existsSync(path)) return undefined;

    try {
        await store.upload(name, readFileSync(path, 'utf-8'));
        return undefined;
    } catch (err) {
        return err;
    }
}

async function upload(name: string, attempt: number): Promise<void> {
    const err = await attemptUpload(name);
    if (!err) return;

    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
        log.error('Durable state: %s could not be mirrored: %s', name, err);
        return;
    }
    log.warn('Durable state: %s upload failed (%s), retrying in %ds', name, err, delay / 1000);
    schedule(name, attempt + 1, delay);
}

/**
 * Shutdown-path upload: retries inline instead of on a timer, because the
 * process is about to exit and a scheduled retry would never run.
 */
async function uploadBeforeExit(name: string): Promise<void> {
    for (let attempt = 0; attempt < SHUTDOWN_ATTEMPTS; attempt++) {
        const err = await attemptUpload(name);
        if (!err) return;
        if (attempt === SHUTDOWN_ATTEMPTS - 1) {
            log.error('Durable state: %s lost on shutdown: %s', name, err);
            return;
        }
        log.warn('Durable state: %s upload failed on shutdown (%s), retrying', name, err);
        await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_RETRY_MS));
    }
}

/**
 * Flush every pending mirror upload now. Called on shutdown, where the two
 * seconds of debounce are exactly the window in which state would be lost.
 */
export async function flushStateMirror(): Promise<void> {
    const store = await getBackend();
    if (!store) return;

    const names = [...pending.keys()];
    for (const [, entry] of pending) clearTimeout(entry.timer);
    pending.clear();

    for (const name of names) {
        uploadChain = uploadChain.then(() => uploadBeforeExit(name)).catch(() => undefined);
    }
    await uploadChain;
}

// ============================================================================
// Test seam
// ============================================================================

export function setStateBackendForTest(next: StateBackend | null): void {
    backend = next;
    backendResolved = true;
    for (const [, entry] of pending) clearTimeout(entry.timer);
    pending.clear();
    uploadChain = Promise.resolve();
}

export function resetStateBackendForTest(): void {
    backend = null;
    backendResolved = false;
    for (const [, entry] of pending) clearTimeout(entry.timer);
    pending.clear();
    uploadChain = Promise.resolve();
}

/** Test seam: run the debounced upload immediately instead of waiting. */
export async function mirrorNowForTest(name: string): Promise<void> {
    await upload(name, RETRY_DELAYS_MS.length);
}
