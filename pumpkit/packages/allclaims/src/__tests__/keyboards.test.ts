import { describe, expect, it } from 'vitest';

import { buildClaimKeyboard, buildTokenKeyboard } from '../keyboards.js';

const MINT = 'M1ntAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TX = 'SigAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const WALLET = 'Wa11etAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function urls(keyboard: { inline_keyboard: Array<Array<{ url: string }>> }): string[] {
    return keyboard.inline_keyboard.flat().map((b) => b.url);
}

describe('buildTokenKeyboard', () => {
    it('lays out trade and chart destinations three to a row', () => {
        const rows = buildTokenKeyboard(MINT).inline_keyboard;
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveLength(3);
        expect(rows[1]).toHaveLength(3);
    });

    it('leaves links clean when no referral is configured', () => {
        const [axiom, gmgn] = urls(buildTokenKeyboard(MINT));
        expect(axiom).toBe(`https://axiom.trade/t/${MINT}`);
        expect(gmgn).toBe(`https://gmgn.ai/sol/token/${MINT}`);
    });

    it('tags links with referrals when they are configured', () => {
        const joined = urls(buildTokenKeyboard(MINT, { axiom: 'nich', gmgn: 'nichxbt', padre: 'nichxbt' })).join(' ');
        expect(joined).toContain('axiom.trade/t/');
        expect(joined).toContain('ref=nich');
        expect(joined).toContain('trade.padre.gg/rk/nichxbt');
    });
});

describe('buildClaimKeyboard', () => {
    it('puts the transaction and the claimer under the trade rows', () => {
        const rows = buildClaimKeyboard(MINT, TX, WALLET).inline_keyboard;
        expect(rows).toHaveLength(3);
        expect(rows[2]!.map((b) => b.text)).toEqual(['🧾 Transaction', '👛 Claimer']);
        expect(rows[2]![0]!.url).toBe(`https://solscan.io/tx/${TX}`);
    });

    /** A vault claim resolves no coin, and a row of dead trade links is worse than no row. */
    it('drops the trade rows when no coin resolved', () => {
        const rows = buildClaimKeyboard(null, TX, WALLET).inline_keyboard;
        expect(rows).toHaveLength(1);
        expect(urls({ inline_keyboard: rows }).join(' ')).not.toContain('axiom.trade');
    });

    it('omits the claimer button when the wallet is unknown', () => {
        const rows = buildClaimKeyboard(MINT, TX, null).inline_keyboard;
        expect(rows[rows.length - 1]!.map((b) => b.text)).toEqual(['🧾 Transaction']);
    });
});
