/**
 * PumpFun Claim Bot - Health Endpoint
 *
 * A single HTTP port so the bot can run as a Cloud Run service or pass a
 * Railway/Docker health check, and so "is it actually seeing claims?" is
 * answerable without reading logs.
 *
 *   GET /health   liveness plus monitor transport, claim counts, tracked items
 *   GET /stats    the same payload (alias, for symmetry with the other bots)
 *   GET /claims   recent claims as JSON (?limit=50), the same data /history reads
 *   GET /top      leaderboard over a window (?hours=24&limit=10)
 *
 * The bot is reported degraded when the monitor has fallen back to polling,
 * because in that mode it silently misses most claims.
 */

import { createServer, type Server, type ServerResponse } from 'node:http';

import { recentClaims, topClaimers, totalRecords, windowSummary } from './claim-history.js';
import { log } from './logger.js';

const DEFAULT_PORT = 3000;
const MAX_CLAIMS_PAGE = 200;
const MAX_LEADERBOARD_HOURS = 168;

export interface HealthOptions {
    /** Unix ms when the process started. */
    startedAt: number;
    /** Snapshot of monitor and store state, evaluated per request. */
    getStats: () => Record<string, unknown>;
}

let server: Server | null = null;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(body));
}

export function startHealthServer(opts: HealthOptions): void {
    const port = Number(process.env.PORT || process.env.HEALTH_PORT || DEFAULT_PORT);

    server = createServer((req, res) => {
        const path = (req.url ?? '/').split('?')[0]!.replace(/\/+$/, '') || '/';

        if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'method not allowed' });
            return;
        }

        const url = new URL(req.url ?? '/', 'http://localhost');

        if (path === '/claims') {
            const requested = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
            const limit = Number.isFinite(requested)
                ? Math.min(Math.max(requested, 1), MAX_CLAIMS_PAGE)
                : 50;
            sendJson(res, 200, {
                total: totalRecords(),
                limit,
                claims: recentClaims(limit),
            });
            return;
        }

        if (path === '/top') {
            const rawHours = Number.parseFloat(url.searchParams.get('hours') ?? '24');
            const hours = Number.isFinite(rawHours)
                ? Math.min(Math.max(rawHours, 1), MAX_LEADERBOARD_HOURS)
                : 24;
            const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '10', 10);
            const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 10;
            sendJson(res, 200, {
                hours,
                summary: windowSummary(hours),
                leaders: topClaimers(hours, limit),
            });
            return;
        }

        if (path === '/' || path === '/health' || path === '/stats') {
            const stats = opts.getStats();
            const degraded = stats.mode === 'polling' || stats.mode === 'stopped';
            const uptimeMs = Date.now() - opts.startedAt;
            sendJson(res, degraded ? 503 : 200, {
                status: degraded ? 'degraded' : 'ok',
                uptimeMs,
                uptime: `${Math.floor(uptimeMs / 1000)}s`,
                ...stats,
                historyRecords: totalRecords(),
            });
            return;
        }

        sendJson(res, 404, { error: 'not found' });
    });

    server.listen(port, () => {
        log.info('HTTP endpoint listening on port %d (/health, /stats, /claims, /top)', port);
    });

    server.on('error', (err) => {
        log.warn('Health endpoint error: %s', err);
    });
}

export function stopHealthServer(): void {
    server?.close();
    server = null;
}
