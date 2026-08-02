/**
 * PumpFun Claim Bot - Trading Venue Links
 *
 * Every claim alert names a coin or a wallet that someone is about to look up,
 * so the alert carries links straight into the terminals people trade on. The
 * codes are referral codes: they are the bot operator's, they are configurable,
 * and setting a code to an empty string drops that venue from the alerts.
 *
 * Link shapes are per venue rather than one generic pattern, because the venues
 * credit referrals differently:
 *
 *   Axiom  handle-style referral page, or the token page with ?ref=
 *   GMGN   /r/<code> referral page, or the token page with ?ref=
 *   Padre  /rk/<code> is the referral entry point; the token deep link takes
 *          no documented ref param, so the referral link is used for both
 *   FOMO   /r/<code> referral page (fomo.family, not fomo.biz, which is an
 *          unrelated host)
 */

export interface AffiliateCodes {
    axiom: string;
    gmgn: string;
    padre: string;
    fomo: string;
}

export const DEFAULT_AFFILIATES: AffiliateCodes = {
    axiom: 'nich',
    gmgn: 'nichxbt',
    padre: 'nichxbt',
    fomo: 'nichxbt',
};

export interface VenueLink {
    label: string;
    url: string;
}

export function loadAffiliates(env: NodeJS.ProcessEnv = process.env): AffiliateCodes {
    return {
        axiom: env.AXIOM_REF ?? DEFAULT_AFFILIATES.axiom,
        gmgn: env.GMGN_REF ?? DEFAULT_AFFILIATES.gmgn,
        padre: env.PADRE_REF ?? DEFAULT_AFFILIATES.padre,
        fomo: env.FOMO_REF ?? DEFAULT_AFFILIATES.fomo,
    };
}

/**
 * Links for one claim. A wallet-level claim names no mint, which is the common
 * case here, so every venue also has a mint-free form rather than being dropped.
 */
export function venueLinks(codes: AffiliateCodes, mint?: string): VenueLink[] {
    const links: VenueLink[] = [];
    const coin = mint ? encodeURIComponent(mint) : '';

    if (codes.axiom) {
        const ref = encodeURIComponent(codes.axiom);
        links.push({
            label: 'Axiom',
            url: coin ? `https://axiom.trade/t/${coin}?ref=${ref}` : `https://axiom.trade/@${ref}`,
        });
    }

    if (codes.gmgn) {
        const ref = encodeURIComponent(codes.gmgn);
        links.push({
            label: 'GMGN',
            url: coin ? `https://gmgn.ai/sol/token/${coin}?ref=${ref}` : `https://gmgn.ai/r/${ref}`,
        });
    }

    if (codes.padre) {
        links.push({
            label: 'Padre',
            url: `https://trade.padre.gg/rk/${encodeURIComponent(codes.padre)}`,
        });
    }

    if (codes.fomo) {
        links.push({
            label: 'FOMO',
            url: `https://fomo.family/r/${encodeURIComponent(codes.fomo)}`,
        });
    }

    return links;
}

/** One compact HTML line for a message body. Empty when every code is unset. */
export function venueLinksHtml(codes: AffiliateCodes, mint?: string): string {
    const links = venueLinks(codes, mint);
    if (links.length === 0) return '';
    const rendered = links.map((link) => `<a href="${link.url}">${link.label}</a>`).join(' · ');
    return `⚡ <b>Trade:</b> ${rendered}`;
}
