/**
 * Tests for the single source of truth for outbound trading links.
 * These links are revenue, so a missing referral code is a real defect.
 */

import { describe, it, expect } from 'vitest';

import { buildTradeLinks, buildChartLinks, renderTradeLinkRow } from '../trade-links.js';

const MINT = 'MintSynthetic1111111111111111111111111111111';
const AFF = { axiom: 'nich', gmgn: 'nichxbt', padre: 'nichxbt', fomo: 'nichxbt' };

describe('buildTradeLinks', () => {
    it('applies a referral code to every venue that supports one', () => {
        const links = buildTradeLinks(MINT, AFF);
        const byName = Object.fromEntries(links.map((l) => [l.name, l.url]));
        expect(byName.Axiom).toContain('ref=nich');
        expect(byName.GMGN).toContain('ref=nichxbt');
        expect(byName.Padre).toContain('ref=nichxbt');
        expect(byName.FOMO).toContain('nichxbt');
    });

    it('keeps the mint in the path for every per-token venue', () => {
        for (const link of buildTradeLinks(MINT, AFF)) {
            if (link.name === 'FOMO') continue; // referral entry point, no token route
            expect(link.url).toContain(MINT);
        }
    });

    it('still produces working links when no codes are configured', () => {
        for (const link of buildTradeLinks(MINT)) {
            expect(link.url).toMatch(/^https:\/\//);
            expect(link.url).not.toContain('undefined');
            expect(link.url).not.toContain('ref=&');
        }
    });

    it('never emits a double question mark when appending a code', () => {
        for (const link of buildTradeLinks(MINT, AFF)) {
            expect(link.url.split('?').length).toBeLessThanOrEqual(2);
        }
    });
});

describe('buildChartLinks', () => {
    it('carries no referral codes', () => {
        for (const link of buildChartLinks(MINT)) {
            expect(link.url).not.toContain('ref=');
            expect(link.url).toContain(MINT);
        }
    });
});

describe('renderTradeLinkRow', () => {
    it('renders every venue as an anchor with its short label', () => {
        const row = renderTradeLinkRow(MINT, AFF);
        for (const short of ['AXI', 'GMG', 'PDR', 'FMO']) {
            expect(row).toContain(`>${short}</a>`);
        }
        expect(row).toContain('ref=nich');
    });
});
