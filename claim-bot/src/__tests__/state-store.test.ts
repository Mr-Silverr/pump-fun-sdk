/**
 * Durable state mirror.
 *
 * The contract that matters on Cloud Run: whatever the bot wrote to DATA_DIR
 * comes back after the container is replaced. These tests drive the mirror
 * through a fake backend so they exercise the hydrate/upload/retry paths
 * without a bucket.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// DATA_DIR is read at import time, so the temp dir has to exist first.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'claim-bot-state-'));

const {
    DATA_DIR,
    STATE_FILES,
    flushStateMirror,
    hydrateState,
    mirrorNowForTest,
    mirrorState,
    resetStateBackendForTest,
    setStateBackendForTest,
    stateBackendName,
} = await import('../state-store.js');

interface FakeBackend {
    objects: Map<string, string>;
    uploads: string[];
    failNext: number;
    backend: Parameters<typeof setStateBackendForTest>[0];
}

function makeBackend(): FakeBackend {
    const state: FakeBackend = {
        objects: new Map(),
        uploads: [],
        failNext: 0,
        backend: null,
    };

    state.backend = {
        describe: () => 'gs://test-bucket/claim-bot/',
        async download(name) {
            return state.objects.get(name);
        },
        async upload(name, contents) {
            if (state.failNext > 0) {
                state.failNext--;
                throw new Error('simulated upload failure');
            }
            state.objects.set(name, contents);
            state.uploads.push(name);
        },
    };

    return state;
}

beforeEach(() => {
    for (const name of STATE_FILES) {
        const path = join(DATA_DIR, name);
        if (existsSync(path)) rmSync(path);
    }
    resetStateBackendForTest();
});

afterEach(() => {
    resetStateBackendForTest();
});

describe('state mirror without a bucket', () => {
    it('reports local storage and never touches the network', async () => {
        expect(stateBackendName()).toBe('local');
        await hydrateState();
        mirrorState('tracked.json');
        await expect(flushStateMirror()).resolves.toBeUndefined();
    });
});

describe('hydrate', () => {
    it('restores state files that exist in the mirror', async () => {
        const fake = makeBackend();
        fake.objects.set('tracked.json', '[{"id":"t_1"}]');
        setStateBackendForTest(fake.backend);

        await hydrateState();

        expect(readFileSync(join(DATA_DIR, 'tracked.json'), 'utf-8')).toBe('[{"id":"t_1"}]');
    });

    it('leaves a file absent when the mirror has no object for it', async () => {
        const fake = makeBackend();
        setStateBackendForTest(fake.backend);

        await hydrateState();

        expect(existsSync(join(DATA_DIR, 'settings.json'))).toBe(false);
    });

    it('overwrites a stale local copy with the mirrored one', async () => {
        writeFileSync(join(DATA_DIR, 'settings.json'), '[{"chatId":1,"muted":true}]', 'utf-8');
        const fake = makeBackend();
        fake.objects.set('settings.json', '[{"chatId":1,"muted":false}]');
        setStateBackendForTest(fake.backend);

        await hydrateState();

        expect(readFileSync(join(DATA_DIR, 'settings.json'), 'utf-8')).toContain('"muted":false');
    });

    it('keeps going when one download fails', async () => {
        const fake = makeBackend();
        fake.objects.set('claims.json', '[]');
        const broken = {
            ...fake.backend!,
            download: async (name: string) => {
                if (name === 'tracked.json') throw new Error('network down');
                return fake.objects.get(name);
            },
        };
        setStateBackendForTest(broken);

        await hydrateState();

        expect(readFileSync(join(DATA_DIR, 'claims.json'), 'utf-8')).toBe('[]');
    });
});

describe('upload', () => {
    it('flush uploads what a write queued', async () => {
        const fake = makeBackend();
        setStateBackendForTest(fake.backend);
        writeFileSync(join(DATA_DIR, 'tracked.json'), '[{"id":"t_9"}]', 'utf-8');

        mirrorState('tracked.json');
        await flushStateMirror();

        expect(fake.objects.get('tracked.json')).toBe('[{"id":"t_9"}]');
    });

    it('coalesces a burst of writes into a single upload', async () => {
        const fake = makeBackend();
        setStateBackendForTest(fake.backend);
        writeFileSync(join(DATA_DIR, 'tracked.json'), '[]', 'utf-8');

        mirrorState('tracked.json');
        mirrorState('tracked.json');
        mirrorState('tracked.json');
        await flushStateMirror();

        expect(fake.uploads).toEqual(['tracked.json']);
    });

    it('uploads the file contents at flush time, not at queue time', async () => {
        const fake = makeBackend();
        setStateBackendForTest(fake.backend);
        writeFileSync(join(DATA_DIR, 'tracked.json'), '[]', 'utf-8');

        mirrorState('tracked.json');
        writeFileSync(join(DATA_DIR, 'tracked.json'), '[{"id":"t_late"}]', 'utf-8');
        await flushStateMirror();

        expect(fake.objects.get('tracked.json')).toContain('t_late');
    });

    it('skips a file that was never written locally', async () => {
        const fake = makeBackend();
        setStateBackendForTest(fake.backend);

        mirrorState('claims.json');
        await flushStateMirror();

        expect(fake.uploads).toEqual([]);
    });

    it('does not throw when the backend rejects', async () => {
        const fake = makeBackend();
        fake.failNext = 1;
        setStateBackendForTest(fake.backend);
        writeFileSync(join(DATA_DIR, 'claims.json'), '[]', 'utf-8');

        await expect(mirrorNowForTest('claims.json')).resolves.toBeUndefined();
        expect(fake.objects.has('claims.json')).toBe(false);
    });

    it('retries inline on shutdown, where a scheduled retry would never run', async () => {
        const fake = makeBackend();
        fake.failNext = 1;
        setStateBackendForTest(fake.backend);
        writeFileSync(join(DATA_DIR, 'tracked.json'), '[{"id":"t_exit"}]', 'utf-8');

        mirrorState('tracked.json');
        await flushStateMirror();

        expect(fake.objects.get('tracked.json')).toContain('t_exit');
    });

    it('a later write still lands after an earlier failure', async () => {
        const fake = makeBackend();
        fake.failNext = 1;
        setStateBackendForTest(fake.backend);
        writeFileSync(join(DATA_DIR, 'claims.json'), '[1]', 'utf-8');

        await mirrorNowForTest('claims.json');
        await mirrorNowForTest('claims.json');

        expect(fake.objects.get('claims.json')).toBe('[1]');
    });
});
