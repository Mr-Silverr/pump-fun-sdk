import { describe, expect, it } from 'vitest';

import { claimUsd, escapeHtml, fmtAmount, formatDigest, formatInstantClaim, shortAddr, type ValuedClaim } from '../formatters.js';
import type { TokenInfo } from '../pump-client.js';
import type { FeeClaimEvent } from '../types.js';

const SOL_USD = 150;

function solClaim(amountSol: number, overrides: Partial<FeeClaimEvent> = {}): FeeClaimEvent {
    return {
        amountLamports: Math.round(amountSol * 1e9),
        amountQuote: amountSol,
        amountSol,
        claimLabel: 'Collect Creator Fee (Pump)',
        claimType: 'collect_creator_fee',
        claimerWallet: 'Wa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        isCashback: false,
        isStableQuote: false,
        programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        quoteTicker: 'SOL',
        slot: 100,
        timestamp: 1_700_000_000,
        tokenMint: 'M1ntAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        txSignature: 'SigAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        ...overrides,
    };
}

function token(overrides: Partial<TokenInfo> = {}): TokenInfo {
    return {
        athMarketCap: 0,
        athTimestamp: 0,
        bannerUri: '',
        complete: false,
        createdTimestamp: 1_699_000_000,
        creator: 'Creat0rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        curveProgress: 42,
        description: '',
        githubUrls: [],
        imageUri: '',
        isBanned: false,
        isCashbackEnabled: false,
        isHackathon: false,
        isNsfw: false,
        kothTimestamp: 0,
        lastReplyTimestamp: 0,
        lastTradeTimestamp: 0,
        marketCapSol: 100,
        mint: 'M1ntAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        name: 'Test Token',
        priceSol: 0.000001,
        program: 'pump',
        pumpSwapPool: '',
        replyCount: 0,
        symbol: 'TEST',
        usdMarketCap: 21_600,
        ...overrides,
    } as TokenInfo;
}

describe('claimUsd', () => {
    it('converts SOL-quoted claims at spot', () => {
        expect(claimUsd(solClaim(0.5), SOL_USD)).toBeCloseTo(75);
    });

    it('passes stable-quoted claims through as USD', () => {
        const usdc = solClaim(0, { amountQuote: 42.5, isStableQuote: true, quoteTicker: 'USDC' });
        expect(claimUsd(usdc, SOL_USD)).toBeCloseTo(42.5);
    });
});

describe('fmtAmount', () => {
    it('renders SOL with a USD conversion', () => {
        expect(fmtAmount(solClaim(0.5), SOL_USD)).toBe('0.5000 SOL ($75)');
    });

    it('renders stable quotes without a redundant USD conversion', () => {
        const usdc = solClaim(0, { amountQuote: 42.5, isStableQuote: true, quoteTicker: 'USDC' });
        expect(fmtAmount(usdc, SOL_USD)).toBe('42.50 USDC');
    });

    it('keeps precision on dust amounts', () => {
        expect(fmtAmount(solClaim(0.00021), SOL_USD)).toBe('0.00021 SOL ($0.03)');
    });
});

describe('escapeHtml / shortAddr', () => {
    it('escapes token names that would break Telegram HTML', () => {
        expect(escapeHtml('<b>rug</b> & co')).toBe('&lt;b&gt;rug&lt;/b&gt; &amp; co');
    });

    it('shortens long addresses and leaves short ones alone', () => {
        expect(shortAddr('M1ntAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe('M1nt…AAAA');
        expect(shortAddr('short')).toBe('short');
    });
});

describe('formatInstantClaim', () => {
    it('includes the token, amount, market cap and links', () => {
        const msg = formatInstantClaim(solClaim(1.5), token(), SOL_USD);
        expect(msg).toContain('FEE CLAIM');
        expect(msg).toContain('$TEST');
        expect(msg).toContain('1.50 SOL ($225)');
        expect(msg).toContain('Mcap: $21.6k');
        expect(msg).toContain('solscan.io/tx/SigAAAA');
        expect(msg).toContain('pump.fun/coin/M1ntAAAA');
    });

    it('falls back to the mint when token metadata is unavailable', () => {
        const msg = formatInstantClaim(solClaim(1.5), null, SOL_USD);
        expect(msg).toContain('M1nt…AAAA');
    });

    it('labels wallet-level claims that carry no mint', () => {
        const msg = formatInstantClaim(solClaim(1.5, { tokenMint: '' }), null, SOL_USD);
        expect(msg).toContain('wallet-level claim');
        expect(msg).not.toContain('pump.fun/coin/');
    });

    it('names the GitHub user on social fee claims', () => {
        const msg = formatInstantClaim(
            solClaim(2, { claimType: 'claim_social_fee_pda', githubUserId: '583231' }),
            token(),
            SOL_USD,
        );
        expect(msg).toContain('social (GitHub)');
        expect(msg).toContain('583231');
    });

    it('escapes hostile token names', () => {
        const msg = formatInstantClaim(solClaim(1), token({ name: '<script>x</script>', symbol: 'A&B' }), SOL_USD);
        expect(msg).toContain('&lt;script&gt;');
        expect(msg).toContain('A&amp;B');
    });
});

describe('formatDigest', () => {
    const tokens = new Map<string, TokenInfo | null>([
        ['M1ntAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', token()],
    ]);

    function valued(usd: number, mint: string): ValuedClaim {
        return { event: solClaim(usd / SOL_USD, { tokenMint: mint, txSignature: `Sig${mint}` }), usd };
    }

    it('sorts claims by value and reports the window total', () => {
        const claims = [
            valued(5, 'M1ntAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
            valued(50, 'OtherMint111111111111111111111111111111111'),
        ];
        const msg = formatDigest(claims, tokens, {
            droppedBelowMin: 0, totalClaims: 2, totalUsd: 55, windowSeconds: 60,
        }, 12);
        expect(msg).toContain('CLAIMS DIGEST');
        expect(msg).toContain('last 1m · 2 claims · $55 total');
        expect(msg).not.toContain('1 claims');
        expect(msg.indexOf('$50')).toBeLessThan(msg.indexOf('$5.00'));
    });

    it('summarizes the overflow instead of truncating it silently', () => {
        const claims = Array.from({ length: 20 }, (_, i) => valued(i + 1, `Mint${i}`));
        const msg = formatDigest(claims, tokens, {
            droppedBelowMin: 0, totalClaims: 20, totalUsd: 210, windowSeconds: 60,
        }, 5);
        expect(msg).toContain('+15 more');
    });

    it('discloses dust claims that were filtered out', () => {
        const msg = formatDigest([valued(5, 'M1ntAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')], tokens, {
            droppedBelowMin: 42, totalClaims: 1, totalUsd: 5, windowSeconds: 60,
        }, 12);
        expect(msg).toContain('42 dust claims');
    });

    it('renders sub-minute windows in seconds', () => {
        const msg = formatDigest([valued(5, 'M1ntAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')], tokens, {
            droppedBelowMin: 0, totalClaims: 1, totalUsd: 5, windowSeconds: 30,
        }, 12);
        expect(msg).toContain('last 30s');
    });
});
