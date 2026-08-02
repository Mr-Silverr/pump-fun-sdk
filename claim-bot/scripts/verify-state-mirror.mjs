#!/usr/bin/env node
/**
 * Verify the durable state bucket the bot mirrors to.
 *
 *   node scripts/verify-state-mirror.mjs
 *   STATE_BUCKET=my-bucket STATE_PREFIX=claim-bot/ node scripts/verify-state-mirror.mjs
 *
 * Writes a probe object at the exact path the bot uses, reads it back, and
 * deletes it. That answers the question a deploy actually depends on: can this
 * identity write and read the state objects, at this prefix, in this bucket.
 *
 * Uses the Cloud Storage JSON API with a gcloud access token, so it works from
 * a workstation with `gcloud auth login` and no application-default credentials.
 * The bot itself uses @google-cloud/storage with the Cloud Run service
 * account's metadata credentials.
 */

import { execFileSync } from 'node:child_process';

const BUCKET = process.env.STATE_BUCKET || 'pumpfun-bot-state';
const PREFIX = (process.env.STATE_PREFIX ?? 'claim-bot/').replace(/^\/+/, '');
const OBJECT = `${PREFIX}.mirror-probe.json`;
const API = 'https://storage.googleapis.com';

function accessToken() {
    try {
        return execFileSync('gcloud', ['auth', 'print-access-token'], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
    } catch (err) {
        console.error('Could not get a gcloud access token. Run: gcloud auth login');
        console.error(String(err.stderr || err.message).trim());
        process.exit(2);
    }
}

async function main() {
    const token = accessToken();
    const auth = { Authorization: `Bearer ${token}` };
    const payload = JSON.stringify({ probe: 'claim-bot state mirror', at: new Date().toISOString() });
    const encoded = encodeURIComponent(OBJECT);

    console.log(`Bucket:  gs://${BUCKET}`);
    console.log(`Object:  ${OBJECT}`);

    const upload = await fetch(
        `${API}/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encoded}`,
        { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: payload },
    );
    if (!upload.ok) {
        console.error(`Write failed: ${upload.status} ${await upload.text()}`);
        process.exit(1);
    }
    console.log('Write:   ok');

    const download = await fetch(`${API}/storage/v1/b/${BUCKET}/o/${encoded}?alt=media`, { headers: auth });
    const body = await download.text();
    if (!download.ok || body !== payload) {
        console.error(`Read failed: ${download.status} ${body}`);
        process.exit(1);
    }
    console.log('Read:    ok (byte-identical)');

    const remove = await fetch(`${API}/storage/v1/b/${BUCKET}/o/${encoded}`, { method: 'DELETE', headers: auth });
    if (!remove.ok && remove.status !== 404) {
        console.error(`Cleanup failed: ${remove.status} ${await remove.text()}`);
        process.exit(1);
    }
    console.log('Cleanup: ok');
    console.log('\nState mirror verified. Tracked items survive a redeploy.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
