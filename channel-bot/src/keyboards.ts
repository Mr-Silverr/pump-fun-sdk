/**
 * PumpFun Channel Bot — Inline Keyboards
 *
 * Trade and chart destinations as tappable buttons instead of a wall of inline
 * links. The cards are long; buttons put the actions in a fixed place at the
 * bottom, are far easier to hit on a phone, and free several lines of vertical
 * space in the caption.
 *
 * Telegram caps a photo caption at 1024 characters, so moving links out of the
 * caption is also what keeps enriched cards from being truncated.
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
 * Two rows: where to trade it, then where to look at it.
 * Telegram renders at most 8 buttons per row comfortably; three per row keeps
 * the labels readable on a narrow screen.
 */
export function buildTokenKeyboard(mint: string, affiliates: KeyboardAffiliates = {}): InlineKeyboard {
    return {
        inline_keyboard: [
            [
                { text: '⚡ Axiom', url: withRef(`https://axiom.trade/t/${mint}`, 'ref', affiliates.axiom) },
                { text: '🐸 GMGN', url: withRef(`https://gmgn.ai/sol/token/${mint}`, 'ref', affiliates.gmgn) },
                { text: '🅿️ Padre', url: `https://t.me/padre_bot?start=${mint}` },
            ],
            [
                { text: '📊 Chart', url: `https://dexscreener.com/solana/${mint}` },
                { text: '💊 pump.fun', url: `https://pump.fun/coin/${mint}` },
                { text: '🔍 Solscan', url: `https://solscan.io/token/${mint}` },
            ],
        ],
    };
}

/** Single row pointing at a transaction, used on claim and distribution cards. */
export function buildTxKeyboard(mint: string, txSignature: string, affiliates: KeyboardAffiliates = {}): InlineKeyboard {
    const keyboard = buildTokenKeyboard(mint, affiliates);
    keyboard.inline_keyboard.push([{ text: '🧾 Transaction', url: `https://solscan.io/tx/${txSignature}` }]);
    return keyboard;
}
