/**
 * PumpFun Channel Bot — Trade Links
 *
 * One source of truth for every outbound trading link.
 *
 * These URLs used to be built inline in three separate places, and they had
 * drifted: the claim card carried referral codes while the graduation card,
 * which is the feed that actually runs, linked out with no codes at all and
 * earned nothing. Anything that links a user to a venue goes through here.
 */

export interface Affiliates {
    axiom?: string;
    gmgn?: string;
    padre?: string;
    fomo?: string;
}

export interface TradeLink {
    /** Full label, e.g. "Axiom" */
    name: string;
    /** Three-letter label used in the tight inline row */
    short: string;
    url: string;
}

/** Append a query parameter, respecting any query string already present. */
function withParam(url: string, key: string, value?: string): string {
    if (!value) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

/**
 * Every trading venue for a mint, with referral codes applied.
 *
 * Each URL keeps the token address in the path so the link lands on the token
 * itself, not on a bare referral splash page. A venue with no configured code
 * still gets a working link.
 */
export function buildTradeLinks(mint: string, aff: Affiliates = {}): TradeLink[] {
    return [
        { name: 'Axiom', short: 'AXI', url: withParam(`https://axiom.trade/t/${mint}`, 'ref', aff.axiom) },
        { name: 'GMGN', short: 'GMG', url: withParam(`https://gmgn.ai/sol/token/${mint}`, 'ref', aff.gmgn) },
        { name: 'Padre', short: 'PDR', url: withParam(`https://trade.padre.gg/trade/solana/${mint}`, 'ref', aff.padre) },
        // fomo.family/<code> is the verified referral entry point. It has no
        // per-token route, so unlike the others this one lands on the referral
        // page rather than the mint.
        { name: 'FOMO', short: 'FMO', url: `https://fomo.family/${encodeURIComponent(aff.fomo ?? '')}` },
    ];
}

/** Chart and explorer destinations. These carry no referral codes. */
export function buildChartLinks(mint: string): TradeLink[] {
    return [
        { name: 'Chart', short: 'DEX', url: `https://dexscreener.com/solana/${mint}` },
        { name: 'pump.fun', short: 'PF', url: `https://pump.fun/coin/${mint}` },
        { name: 'Solscan', short: 'SCN', url: `https://solscan.io/token/${mint}` },
    ];
}

/** Compact "AXI⋅GMG⋅PDR⋅FMO" row for inside a card caption. */
export function renderTradeLinkRow(mint: string, aff: Affiliates = {}): string {
    return buildTradeLinks(mint, aff)
        .map((l) => `<a href="${l.url}">${l.short}</a>`)
        .join('⋅');
}
