/**
 * PumpFun All-Claims Bot: Inline Keyboards
 *
 * Trade and chart destinations as tappable buttons instead of a wall of inline
 * links at the bottom of the card. Buttons sit in a fixed place, are far easier
 * to hit on a phone, and free several lines of vertical space in the message.
 *
 * A card with no resolved mint has nothing to trade, so it gets a transaction
 * button only rather than a row of dead links.
 */

export interface InlineButton {
    text: string;
    url: string;
}

export interface InlineKeyboard {
    inline_keyboard: InlineButton[][];
}

export interface KeyboardAffiliates {
    axiom?: string;
    gmgn?: string;
    padre?: string;
}

/** Append a referral code only when one is configured. */
function withRef(url: string, param: string, ref?: string): string {
    if (!ref) return url;
    return url.includes('?') ? `${url}&${param}=${ref}` : `${url}?${param}=${ref}`;
}

/**
 * Two rows: where to trade it, then where to look at it. Three buttons per row
 * keeps every label readable on a narrow screen.
 */
export function buildTokenKeyboard(mint: string, affiliates: KeyboardAffiliates = {}): InlineKeyboard {
    return {
        inline_keyboard: [
            [
                { text: '⚡ Axiom', url: withRef(`https://axiom.trade/t/${mint}`, 'ref', affiliates.axiom) },
                { text: '🐸 GMGN', url: withRef(`https://gmgn.ai/sol/token/${mint}`, 'ref', affiliates.gmgn) },
                {
                    text: '🅿️ Padre',
                    url: affiliates.padre
                        ? `https://trade.padre.gg/rk/${encodeURIComponent(affiliates.padre)}`
                        : `https://t.me/padre_bot?start=${mint}`,
                },
            ],
            [
                { text: '📊 Chart', url: `https://dexscreener.com/solana/${mint}` },
                { text: '💊 pump.fun', url: `https://pump.fun/coin/${mint}` },
                { text: '🔍 Solscan', url: `https://solscan.io/token/${mint}` },
            ],
        ],
    };
}

/**
 * The keyboard for a claim card: trade rows when a coin resolved, plus the
 * transaction that paid out. The claimer's pump.fun profile rides on the same
 * row as the transaction so both identities are one tap away.
 */
export function buildClaimKeyboard(
    mint: string | null,
    txSignature: string,
    claimerWallet: string | null,
    affiliates: KeyboardAffiliates = {},
): InlineKeyboard {
    const keyboard: InlineKeyboard = mint
        ? buildTokenKeyboard(mint, affiliates)
        : { inline_keyboard: [] };

    const bottom: InlineButton[] = [{ text: '🧾 Transaction', url: `https://solscan.io/tx/${txSignature}` }];
    if (claimerWallet) {
        bottom.push({ text: '👛 Claimer', url: `https://pump.fun/profile/${claimerWallet}` });
    }
    keyboard.inline_keyboard.push(bottom);

    return keyboard;
}
