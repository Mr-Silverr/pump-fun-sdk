/**
 * Referral links on claim alerts.
 *
 * The shapes are per venue and were checked against the live sites, so the
 * tests pin them: a silently wrong referral URL still renders as a working
 * button and credits nobody.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_AFFILIATES, loadAffiliates, venueLinks, venueLinksHtml } from '../affiliates.js';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

describe('affiliate codes', () => {
    it('falls back to the operator codes when nothing is configured', () => {
        expect(loadAffiliates({})).toEqual(DEFAULT_AFFILIATES);
    });

    it('lets the environment override each venue', () => {
        const codes = loadAffiliates({
            AXIOM_REF: 'a1',
            GMGN_REF: 'g1',
            PADRE_REF: 'p1',
            FOMO_REF: 'f1',
        });
        expect(codes).toEqual({ axiom: 'a1', gmgn: 'g1', padre: 'p1', fomo: 'f1' });
    });

    it('drops a venue whose code is set to empty', () => {
        const codes = loadAffiliates({ GMGN_REF: '', FOMO_REF: '' });
        const labels = venueLinks(codes, MINT).map((link) => link.label);
        expect(labels).toEqual(['Axiom', 'Padre']);
    });
});

describe('venue links with a mint', () => {
    const links = venueLinks(DEFAULT_AFFILIATES, MINT);
    const byLabel = Object.fromEntries(links.map((link) => [link.label, link.url]));

    it('sends Axiom and GMGN to the token page carrying the referral code', () => {
        expect(byLabel.Axiom).toBe(`https://axiom.trade/t/${MINT}?ref=nich`);
        expect(byLabel.GMGN).toBe(`https://gmgn.ai/sol/token/${MINT}?ref=nichxbt`);
    });

    it('uses the Padre referral entry point, which its token deep link cannot carry', () => {
        expect(byLabel.Padre).toBe('https://trade.padre.gg/rk/nichxbt');
    });

    it('uses fomo.family, not fomo.biz, which is an unrelated host', () => {
        expect(byLabel.FOMO).toBe('https://fomo.family/r/nichxbt');
    });
});

describe('venue links without a mint', () => {
    // The common case: collect_creator_fee sweeps a vault and names no coin.
    const byLabel = Object.fromEntries(
        venueLinks(DEFAULT_AFFILIATES).map((link) => [link.label, link.url]),
    );

    it('still links every venue, through its referral page', () => {
        expect(byLabel.Axiom).toBe('https://axiom.trade/@nich');
        expect(byLabel.GMGN).toBe('https://gmgn.ai/r/nichxbt');
        expect(byLabel.Padre).toBe('https://trade.padre.gg/rk/nichxbt');
        expect(byLabel.FOMO).toBe('https://fomo.family/r/nichxbt');
    });
});

describe('html rendering', () => {
    it('renders one line of anchors', () => {
        const html = venueLinksHtml(DEFAULT_AFFILIATES, MINT);
        expect(html).toContain('<a href="https://gmgn.ai/sol/token/');
        expect(html).toContain('>FOMO</a>');
        expect(html.split('\n')).toHaveLength(1);
    });

    it('renders nothing when every code is unset', () => {
        expect(venueLinksHtml({ axiom: '', gmgn: '', padre: '', fomo: '' })).toBe('');
    });

    it('escapes a code that would otherwise break the URL', () => {
        const html = venueLinksHtml({ axiom: 'a b&c', gmgn: '', padre: '', fomo: '' });
        expect(html).toContain('https://axiom.trade/@a%20b%26c');
    });
});
