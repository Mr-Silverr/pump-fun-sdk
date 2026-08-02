import { describe, expect, it } from 'vitest';

import {
    cardImageUrl,
    claimUsd,
    escapeHtml,
    fmtAmount,
    formatDigest,
    formatInstantClaim,
    resolveSubject,
    shortAddr,
    type ClaimCard,
    type DigestSubject,
    type ValuedClaim,
} from '../formatters.js';
import type { CreatorCoin, CreatorProfile, TokenInfo } from '../pump-client.js';
import type { FeeClaimEvent } from '../types.js';

const SOL_USD = 150;
const MINT = 'M1ntAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CREATOR = 'Creat0rAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
        tokenMint: MINT,
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
        creator: CREATOR,
        curveProgress: 42,
        description: '',
        githubUrls: [],
        imageUri: 'https://img.example/coin.png',
        isBanned: false,
        isCashbackEnabled: false,
        isHackathon: false,
        isNsfw: false,
        kothTimestamp: 0,
        lastReplyTimestamp: 0,
        lastTradeTimestamp: 0,
        marketCapSol: 100,
        mint: MINT,
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

function coin(overrides: Partial<CreatorCoin> = {}): CreatorCoin {
    return {
        complete: false,
        createdTimestamp: 1_699_000_000,
        imageUri: 'https://img.example/vault-coin.png',
        mint: 'VaultC0inAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        name: 'Vault Coin',
        symbol: 'VAULT',
        usdMarketCap: 8_400,
        ...overrides,
    };
}

function creatorProfile(overrides: Partial<CreatorProfile> = {}): CreatorProfile {
    return {
        followers: 26,
        graduatedCount: 2,
        profileImage: 'https://img.example/avatar.png',
        recentCoins: [],
        scamEstimate: 0,
        topCoins: [coin()],
        totalLaunches: 4,
        username: 'waryshark',
        wallet: CREATOR,
        ...overrides,
    };
}

function card(overrides: Partial<ClaimCard> = {}): ClaimCard {
    return {
        affiliates: null,
        attributedCoin: null,
        creator: null,
        event: solClaim(1.5),
        githubUser: null,
        holders: null,
        linkedTokens: null,
        repo: null,
        solUsdPrice: SOL_USD,
        token: token(),
        usd: 225,
        ...overrides,
    };
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
        expect(shortAddr(MINT)).toBe('M1nt…AAAA');
        expect(shortAddr('short')).toBe('short');
    });
});

describe('resolveSubject', () => {
    it('treats an event-named mint as exact', () => {
        const subject = resolveSubject(card());
        expect(subject?.mint).toBe(MINT);
        expect(subject?.exact).toBe(true);
    });

    it('credits the creator\'s biggest coin when the event names no mint', () => {
        const subject = resolveSubject(card({
            attributedCoin: coin(),
            creator: creatorProfile(),
            event: solClaim(1.5, { tokenMint: '' }),
            token: null,
        }));
        expect(subject?.symbol).toBe('VAULT');
        expect(subject?.exact).toBe(false);
    });

    it('is certain about a creator who has only ever launched one coin', () => {
        const subject = resolveSubject(card({
            attributedCoin: coin(),
            creator: creatorProfile({ totalLaunches: 1 }),
            event: solClaim(1.5, { tokenMint: '' }),
            token: null,
        }));
        expect(subject?.exact).toBe(true);
    });

    it('has no subject when nothing resolved', () => {
        expect(resolveSubject(card({ event: solClaim(1.5, { tokenMint: '' }), token: null }))).toBeNull();
    });
});

describe('cardImageUrl', () => {
    it('prefers the coin artwork', () => {
        expect(cardImageUrl(card())).toBe('https://img.example/coin.png');
    });

    it('falls back to the creator avatar for an unresolved coin', () => {
        expect(cardImageUrl(card({
            creator: creatorProfile(),
            event: solClaim(1.5, { tokenMint: '' }),
            token: null,
        }))).toBe('https://img.example/avatar.png');
    });

    it('has no image when neither resolved', () => {
        expect(cardImageUrl(card({ event: solClaim(1.5, { tokenMint: '' }), token: null }))).toBeNull();
    });
});

describe('formatInstantClaim', () => {
    it('leads with the amount and names who claimed it', () => {
        const msg = formatInstantClaim(card({ creator: creatorProfile() }));
        expect(msg).toContain('FEE CLAIM');
        expect(msg).toContain('1.50 SOL ($225)');
        expect(msg).toContain('claimed by waryshark');
    });

    it('prints the full mint so it can be copied in one tap', () => {
        expect(formatInstantClaim(card())).toContain(`<code>${MINT}</code>`);
    });

    it('escalates the header for whale-sized claims', () => {
        expect(formatInstantClaim(card({ usd: 2_500 }))).toContain('WHALE CLAIM');
        expect(formatInstantClaim(card({ usd: 25_000 }))).toContain('MASSIVE CLAIM');
    });

    it('says plainly when a coin is attributed rather than named on chain', () => {
        const msg = formatInstantClaim(card({
            attributedCoin: coin(),
            creator: creatorProfile(),
            event: solClaim(1.5, { tokenMint: '' }),
            token: null,
        }));
        expect(msg).toContain('Vault claim');
        expect(msg).toContain("creator's 4 coins");
    });

    it('renders the creator track record and other coins', () => {
        const msg = formatInstantClaim(card({
            creator: creatorProfile({ scamEstimate: 3 }),
        }));
        expect(msg).toContain('4 launches');
        expect(msg).toContain('2 graduated');
        expect(msg).toContain('3 dead');
        expect(msg).toContain('$VAULT');
    });

    it('falls back to a wallet-level label only when nothing resolved', () => {
        const msg = formatInstantClaim(card({ event: solClaim(1.5, { tokenMint: '' }), token: null }));
        expect(msg).toContain('Wallet-level claim');
        expect(msg).not.toContain('pump.fun/coin/');
    });

    it('names the GitHub id when the profile could not be resolved', () => {
        const msg = formatInstantClaim(card({
            event: solClaim(2, { claimType: 'claim_social_fee_pda', githubUserId: '583231' }),
        }));
        expect(msg).toContain('social (GitHub)');
        expect(msg).toContain('583231');
    });

    it('escapes hostile token names', () => {
        const msg = formatInstantClaim(card({
            token: token({ name: '<script>x</script>', symbol: 'A&B' }),
        }));
        expect(msg).toContain('&lt;script&gt;');
        expect(msg).toContain('A&amp;B');
    });

    it('leaves no double blank lines when sections render nothing', () => {
        expect(formatInstantClaim(card())).not.toContain('\n\n\n');
    });

    it('singularizes a one-launch creator', () => {
        const msg = formatInstantClaim(card({ creator: creatorProfile({ totalLaunches: 1 }) }));
        expect(msg).toContain('1 launch ');
        expect(msg).not.toContain('1 launchs');
    });
});

describe('formatInstantClaim card layout', () => {
    it('opens with a credibility verdict before any detail', () => {
        const msg = formatInstantClaim(card({ creator: creatorProfile() }));
        const lines = msg.split('\n');
        expect(lines[1]).toContain('Credibility:');
        expect(msg.indexOf('Credibility:')).toBeLessThan(msg.indexOf('Claim Stats'));
    });

    it('prints the contract address at both ends of the card', () => {
        const msg = formatInstantClaim(card());
        expect(msg.indexOf(`<code>${MINT}</code>`)).toBeLessThan(msg.indexOf('Claim Stats'));
        expect(msg).toContain(`CA: <code>${MINT}</code>`);
    });

    /** Trade destinations live on the inline keyboard; a link wall in the text undoes that. */
    it('keeps trade links out of the message body', () => {
        const msg = formatInstantClaim(card({
            affiliates: { axiom: 'https://axiom.trade/t/x', gmgn: 'https://gmgn.ai/y', padre: 'https://padre/z' },
        }));
        expect(msg).not.toContain('axiom.trade');
        expect(msg).not.toContain('gmgn.ai');
    });

    it('renders exactly one dollar sign for a symbol that already has one', () => {
        const msg = formatInstantClaim(card({ token: token({ symbol: '$BRUNO' }) }));
        expect(msg).toContain('$BRUNO');
        expect(msg).not.toContain('$$BRUNO');
    });

    it('reports concentration from the holder list even with no census total', () => {
        const msg = formatInstantClaim(card({
            holders: {
                top10Pct: 62,
                topHolders: [
                    { address: 'A', isPool: false, pct: 21.7 },
                    { address: 'B', isPool: false, pct: 15.4 },
                ],
                totalHolders: 0,
            },
        }));
        expect(msg).toContain('top10: 62%');
        expect(msg).not.toContain('Concentration unavailable');
    });

    /** A blank holders section reads exactly like a safe one, which is the dangerous case. */
    it('says concentration is unavailable rather than staying silent', () => {
        expect(formatInstantClaim(card())).toContain('Concentration unavailable');
    });

    it('warns when the top of the cap table owns the supply', () => {
        const msg = formatInstantClaim(card({
            holders: { top10Pct: 92, topHolders: [{ address: 'A', isPool: false, pct: 77.4 }], totalHolders: 0 },
        }));
        expect(msg).toContain('⚠️ Top10 hold 92% of supply');
    });

    it('shows buy pressure only when there is enough flow to mean anything', () => {
        const noisy = formatInstantClaim(card({
            trades: { buyCount: 2, recentTradeCount: 3, recentVolumeSol: 1, sellCount: 1 },
        }));
        expect(noisy).not.toContain('Flow:');

        const real = formatInstantClaim(card({
            trades: { buyCount: 34, recentTradeCount: 74, recentVolumeSol: 20, sellCount: 40 },
        }));
        expect(real).toContain('Flow:');
        expect(real).toContain('46% buys');
    });

    it('drops a USD figure that would round to zero', () => {
        const msg = formatInstantClaim(card({ event: solClaim(0.00001), usd: 0.0007 }));
        expect(msg).toContain('0.00001 SOL');
        expect(msg).not.toContain('($0.00)');
    });

    it('stays inside the Telegram message limit on a fully enriched card', () => {
        const msg = formatInstantClaim(card({
            creator: creatorProfile({ topCoins: Array.from({ length: 10 }, () => coin()) }),
            holders: { top10Pct: 40, topHolders: Array.from({ length: 20 }, (_, i) => ({ address: `H${i}`, isPool: false, pct: 2 })), totalHolders: 900 },
            linkedTokens: Array.from({ length: 8 }, () => token()),
            trades: { buyCount: 100, recentTradeCount: 200, recentVolumeSol: 500, sellCount: 100 },
        }));
        expect(msg.length).toBeLessThan(4096);
    });
});

describe('formatDigest', () => {
    function valued(usd: number, sig: string): ValuedClaim {
        return { event: solClaim(usd / SOL_USD, { txSignature: sig }), usd };
    }

    function subject(overrides: Partial<DigestSubject> = {}): DigestSubject {
        return { mint: MINT, symbol: 'TEST', usdMarketCap: 21_600, who: 'waryshark', ...overrides };
    }

    it('sorts claims by value and reports the window total', () => {
        const claims = [valued(5, 'SigSmall'), valued(50, 'SigBig')];
        const subjects = new Map([['SigSmall', subject()], ['SigBig', subject()]]);
        const msg = formatDigest(claims, subjects, {
            droppedBelowMin: 0, totalClaims: 2, totalUsd: 55, windowSeconds: 60,
        }, 12);
        expect(msg).toContain('CLAIMS DIGEST');
        expect(msg).toContain('last 1m · 2 claims · $55 total');
        expect(msg.indexOf('$50')).toBeLessThan(msg.indexOf('$5.00'));
    });

    it('names a coin and a person instead of the word wallet', () => {
        const msg = formatDigest([valued(5, 'SigA')], new Map([['SigA', subject()]]), {
            droppedBelowMin: 0, totalClaims: 1, totalUsd: 5, windowSeconds: 60,
        }, 12);
        expect(msg).toContain('$TEST');
        expect(msg).toContain('($21.6k)');
        expect(msg).toContain('waryshark');
        expect(msg).not.toContain('wallet');
    });

    it('still renders a line when the subject could not be resolved', () => {
        const msg = formatDigest([valued(5, 'SigA')], new Map(), {
            droppedBelowMin: 0, totalClaims: 1, totalUsd: 5, windowSeconds: 60,
        }, 12);
        expect(msg).toContain('$5.00');
        expect(msg).toContain('solscan.io/tx/SigA');
    });

    it('summarizes the overflow instead of truncating it silently', () => {
        const claims = Array.from({ length: 20 }, (_, i) => valued(i + 1, `Sig${i}`));
        const msg = formatDigest(claims, new Map(), {
            droppedBelowMin: 0, totalClaims: 20, totalUsd: 210, windowSeconds: 60,
        }, 5);
        expect(msg).toContain('+15 more');
    });

    it('discloses dust claims that were filtered out', () => {
        const msg = formatDigest([valued(5, 'SigA')], new Map(), {
            droppedBelowMin: 42, totalClaims: 1, totalUsd: 5, windowSeconds: 60,
        }, 12);
        expect(msg).toContain('42 dust claims');
    });

    it('renders sub-minute windows in seconds', () => {
        const msg = formatDigest([valued(5, 'SigA')], new Map(), {
            droppedBelowMin: 0, totalClaims: 1, totalUsd: 5, windowSeconds: 30,
        }, 12);
        expect(msg).toContain('last 30s');
    });
});
