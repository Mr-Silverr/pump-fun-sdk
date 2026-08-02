/**
 * PumpFun All-Claims Bot: Credibility Score
 *
 * A claim card carries a dozen facts. A reader scrolling a busy channel reads
 * the first two lines and moves on, so the card has to answer "is this worth my
 * attention" before it answers anything else.
 *
 * The score is a transparent sum of the evidence the card already fetched: the
 * creator's track record, the coin's stage, holder concentration, and the
 * GitHub identity behind a social claim. Every point moved is reported as a
 * reason, so nothing is a black box: the ↑ and ↓ lines under the score are the
 * whole model.
 *
 * Missing data never adds points and never subtracts them. A coin nobody has
 * indexed yet scores neutral and says so, because scoring silence as safety is
 * exactly the failure that gets readers hurt.
 */

import type { GitHubUserInfo } from './github-client.js';
import type { CreatorProfile, HolderDetails, TokenInfo } from './pump-client.js';

export interface CredibilityInput {
    token: TokenInfo | null;
    creator: CreatorProfile | null;
    holders: HolderDetails | null;
    githubUser: GitHubUserInfo | null;
    /** Coins sharing this claim's social fee PDA. More than one is a known scam shape. */
    linkedTokenCount: number;
}

export interface Credibility {
    /** 0-100. 50 is "nothing known either way". */
    score: number;
    /** Plain-language band for the score. */
    label: string;
    /** Traffic-light emoji matching the band. */
    icon: string;
    /** What pushed the score up, strongest first. */
    up: string[];
    /** What pushed it down, strongest first. */
    down: string[];
}

const NEUTRAL = 50;
const YEAR_MS = 365 * 86_400_000;

/** A coin that never graduated and is worth nothing now. */
const DEAD_MCAP_USD = 5_000;

interface Factor {
    points: number;
    reason: string;
}

export function scoreCredibility(input: CredibilityInput): Credibility {
    const factors: Factor[] = [];
    const { token, creator, holders, githubUser, linkedTokenCount } = input;

    // ── Coin stage ───────────────────────────────────────────────────
    if (token?.complete) {
        factors.push({ points: 12, reason: 'graduated to AMM' });
    }
    if (token && token.usdMarketCap >= 100_000) {
        factors.push({ points: 8, reason: `MC $${Math.round(token.usdMarketCap / 1000)}k` });
    } else if (token && token.usdMarketCap > 0 && token.usdMarketCap < DEAD_MCAP_USD && !token.complete) {
        factors.push({ points: -8, reason: `MC under $${DEAD_MCAP_USD / 1000}k` });
    }
    if (token && token.athMarketCap > 0 && token.usdMarketCap > 0) {
        const drawdown = 1 - token.usdMarketCap / token.athMarketCap;
        if (drawdown >= 0.9) {
            factors.push({ points: -10, reason: `${Math.round(drawdown * 100)}% off ATH` });
        }
    }

    // ── Creator track record ─────────────────────────────────────────
    if (creator) {
        if (creator.graduatedCount > 0) {
            factors.push({
                points: Math.min(15, creator.graduatedCount * 6),
                reason: `${creator.graduatedCount} graduated`,
            });
        }
        if (creator.scamEstimate > 0) {
            factors.push({
                points: -Math.min(24, creator.scamEstimate * 6),
                reason: `${creator.scamEstimate} dead launches`,
            });
        }
        if (creator.totalLaunches >= 20) {
            factors.push({ points: -8, reason: `${creator.totalLaunches} launches` });
        }
        if (creator.followers >= 1000) {
            factors.push({ points: 6, reason: `${formatCount(creator.followers)} followers` });
        }
    }

    // ── Holder distribution ──────────────────────────────────────────
    // Gated on the holder LIST, not on a holder count: concentration is read
    // from the chain's top-20 accounts, which never carries a census total. A
    // count-based gate silently skipped this whole section, and a coin whose
    // top 10 held 92% scored as "Moderate".
    if (holders && holders.topHolders.length > 0) {
        if (holders.totalHolders >= 500) {
            factors.push({ points: 8, reason: `${formatCount(holders.totalHolders)} holders` });
        }
        if (holders.top10Pct >= 60) {
            factors.push({ points: -18, reason: `top10 hold ${holders.top10Pct.toFixed(0)}%` });
        } else if (holders.top10Pct >= 40) {
            factors.push({ points: -10, reason: `top10 hold ${holders.top10Pct.toFixed(0)}%` });
        } else if (holders.top10Pct > 0 && holders.top10Pct < 20) {
            factors.push({ points: 6, reason: `top10 hold ${holders.top10Pct.toFixed(0)}%` });
        }
    }

    // ── GitHub identity (social fee claims) ──────────────────────────
    if (githubUser) {
        const ageMs = githubUser.createdAt ? Date.now() - new Date(githubUser.createdAt).getTime() : 0;
        const ageYears = ageMs / YEAR_MS;
        if (ageYears >= 2) {
            factors.push({ points: 10, reason: `GitHub ${Math.floor(ageYears)}y` });
        } else if (ageMs > 0 && ageMs < 7 * 86_400_000) {
            factors.push({ points: -12, reason: 'GitHub account under a week old' });
        }
        if (githubUser.publicRepos >= 10) {
            factors.push({ points: 5, reason: `${githubUser.publicRepos} repos` });
        }
        if (githubUser.followers >= 100) {
            factors.push({ points: 5, reason: `${formatCount(githubUser.followers)} GitHub followers` });
        }
        if (token && (token.githubUrls?.length ?? 0) === 0) {
            factors.push({ points: -10, reason: 'no GitHub link on the coin' });
        }
    }

    // ── Shared social fee PDA ────────────────────────────────────────
    if (linkedTokenCount > 1) {
        factors.push({ points: -12, reason: `${linkedTokenCount} coins share this fee PDA` });
    }

    const score = clamp(NEUTRAL + factors.reduce((sum, f) => sum + f.points, 0));
    const up = factors.filter((f) => f.points > 0).sort((a, b) => b.points - a.points).map((f) => f.reason);
    const down = factors.filter((f) => f.points < 0).sort((a, b) => a.points - b.points).map((f) => f.reason);

    // No evidence at all is not a passing grade. Say the data is missing rather
    // than letting a default 50 read as a considered verdict. This turns on
    // whether anything was looked up, not on whether the lookups happened to
    // clear a threshold: a coin we know plenty about that trips no rule is
    // genuinely middling, and calling that "unrated" would be false.
    const knowsNothing = !token && !creator && !githubUser && !(holders && holders.topHolders.length > 0);
    if (knowsNothing) {
        return { down: [], icon: '⚪', label: 'Unrated, nothing indexed yet', score: NEUTRAL, up: [] };
    }

    return { down, icon: bandIcon(score), label: bandLabel(score), score, up };
}

function bandLabel(score: number): string {
    if (score >= 75) return 'Strong';
    if (score >= 55) return 'Moderate';
    if (score >= 35) return 'Mixed';
    return 'Weak';
}

function bandIcon(score: number): string {
    if (score >= 75) return '🟢';
    if (score >= 55) return '🟡';
    if (score >= 35) return '🟠';
    return '🔴';
}

function clamp(n: number): number {
    return Math.max(0, Math.min(100, Math.round(n)));
}

function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}
