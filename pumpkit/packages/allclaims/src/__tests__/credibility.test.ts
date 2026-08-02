import { describe, expect, it } from 'vitest';

import { scoreCredibility, type CredibilityInput } from '../credibility.js';
import type { GitHubUserInfo } from '../github-client.js';
import type { CreatorProfile, HolderDetails, TokenInfo } from '../pump-client.js';

function input(overrides: Partial<CredibilityInput> = {}): CredibilityInput {
    return { creator: null, githubUser: null, holders: null, linkedTokenCount: 0, token: null, ...overrides };
}

function holders(top10Pct: number, count = 5): HolderDetails {
    return {
        top10Pct,
        topHolders: Array.from({ length: count }, (_, i) => ({
            address: `H0lder${i}`,
            isPool: false,
            pct: top10Pct / count,
        })),
        totalHolders: 0,
    };
}

function creator(overrides: Partial<CreatorProfile> = {}): CreatorProfile {
    return {
        followers: 0,
        graduatedCount: 0,
        profileImage: '',
        recentCoins: [],
        scamEstimate: 0,
        topCoins: [],
        totalLaunches: 1,
        username: 'someone',
        wallet: 'Wa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        ...overrides,
    };
}

function githubUser(overrides: Partial<GitHubUserInfo> = {}): GitHubUserInfo {
    return {
        avatarUrl: '',
        bio: null,
        blog: null,
        company: null,
        createdAt: new Date(Date.now() - 4 * 365 * 86_400_000).toISOString(),
        followers: 0,
        following: 0,
        hireable: false,
        htmlUrl: 'https://github.com/dev',
        location: null,
        login: 'dev',
        name: null,
        publicRepos: 0,
        twitterUsername: null,
        ...overrides,
    } as GitHubUserInfo;
}

describe('scoreCredibility', () => {
    it('says nothing is known rather than defaulting to a passing 50', () => {
        const result = scoreCredibility(input());
        expect(result.label).toContain('Unrated');
        expect(result.icon).toBe('⚪');
    });

    /**
     * The regression that shipped a card reading "Moderate" over a coin whose
     * top 10 accounts held 92%: concentration comes from the chain's top-20
     * accounts and carries no census total, so a count-based gate skipped it.
     */
    it('penalizes concentration even though the holder census is unknown', () => {
        const result = scoreCredibility(input({
            creator: creator({ graduatedCount: 1 }),
            holders: holders(92),
        }));
        expect(result.score).toBeLessThan(50);
        expect(result.down.join(' ')).toContain('top10 hold 92%');
    });

    it('rewards a spread cap table', () => {
        const spread = scoreCredibility(input({ holders: holders(12) }));
        const concentrated = scoreCredibility(input({ holders: holders(70) }));
        expect(spread.score).toBeGreaterThan(concentrated.score);
    });

    it('treats a shared social fee PDA as a mark against the claim', () => {
        const alone = scoreCredibility(input({ creator: creator() }));
        const shared = scoreCredibility(input({ creator: creator(), linkedTokenCount: 4 }));
        expect(shared.score).toBeLessThan(alone.score);
        expect(shared.down.join(' ')).toContain('share this fee PDA');
    });

    it('counts dead launches against a serial launcher', () => {
        const result = scoreCredibility(input({ creator: creator({ scamEstimate: 30, totalLaunches: 50 }) }));
        expect(result.label).toBe('Weak');
        expect(result.icon).toBe('🔴');
    });

    it('credits an established GitHub identity', () => {
        const result = scoreCredibility(input({ githubUser: githubUser({ publicRepos: 40 }) }));
        expect(result.score).toBeGreaterThan(50);
        expect(result.up.join(' ')).toContain('GitHub 4y');
    });

    it('flags a GitHub account opened days before the claim', () => {
        const result = scoreCredibility(input({
            githubUser: githubUser({ createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }),
        }));
        expect(result.down.join(' ')).toContain('under a week old');
    });

    it('rates a coin it has data on rather than calling it unrated', () => {
        const token = { athMarketCap: 0, complete: false, githubUrls: [], usdMarketCap: 50_000 } as unknown as TokenInfo;
        const result = scoreCredibility(input({ token }));
        expect(result.label).not.toContain('Unrated');
    });

    it('never leaves the 0-100 range', () => {
        const floor = scoreCredibility(input({
            creator: creator({ scamEstimate: 99, totalLaunches: 99 }),
            githubUser: githubUser({ createdAt: new Date().toISOString() }),
            holders: holders(99),
            linkedTokenCount: 9,
        }));
        expect(floor.score).toBeGreaterThanOrEqual(0);
        expect(floor.score).toBeLessThanOrEqual(100);
    });
});
