/**
 * Per-chat alert settings.
 *
 * The rule that matters: muting and thresholds must not lose tracked items, and
 * the threshold is compared in the claim's own currency (no cross-currency
 * conversion, which would need a live price and would silently drop alerts).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('chat settings', () => {
    let settings: typeof import('../settings.js');

    beforeEach(async () => {
        vi.resetModules();
        vi.doMock('node:fs', () => ({
            existsSync: vi.fn(() => false),
            mkdirSync: vi.fn(),
            readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
            writeFileSync: vi.fn(),
        }));
        vi.doMock('../logger.js', () => ({
            log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        }));
        settings = await import('../settings.js');
        settings.resetSettingsForTest();
    });

    it('defaults to unmuted with no minimum', () => {
        const chat = settings.getSettings(42);

        expect(chat.muted).toBe(false);
        expect(chat.minAmount).toBe(0);
        expect(settings.shouldNotify(42, 0.000001)).toBe(true);
    });

    it('drops claims below the minimum and keeps the rest', () => {
        settings.setMinAmount(42, 0.5);

        expect(settings.shouldNotify(42, 0.4999)).toBe(false);
        expect(settings.shouldNotify(42, 0.5)).toBe(true);
        expect(settings.shouldNotify(42, 12)).toBe(true);
    });

    it('applies the threshold per chat, not globally', () => {
        settings.setMinAmount(42, 1);

        expect(settings.shouldNotify(42, 0.2)).toBe(false);
        expect(settings.shouldNotify(99, 0.2)).toBe(true);
    });

    it('mutes and unmutes without touching the threshold', () => {
        settings.setMinAmount(42, 0.25);
        settings.setMuted(42, true);

        expect(settings.shouldNotify(42, 10)).toBe(false);

        settings.setMuted(42, false);

        expect(settings.getSettings(42).minAmount).toBe(0.25);
        expect(settings.shouldNotify(42, 10)).toBe(true);
        expect(settings.shouldNotify(42, 0.1)).toBe(false);
    });

    it('rejects a nonsense minimum instead of storing it', () => {
        expect(() => settings.setMinAmount(42, -1)).toThrow(RangeError);
        expect(() => settings.setMinAmount(42, Number.NaN)).toThrow(RangeError);
        expect(() => settings.setMinAmount(42, settings.MAX_MIN_AMOUNT + 1)).toThrow(RangeError);
        expect(settings.getSettings(42).minAmount).toBe(0);
    });

    it('treats 0 as "send everything"', () => {
        settings.setMinAmount(42, 2);
        settings.setMinAmount(42, 0);

        expect(settings.shouldNotify(42, 0.0000001)).toBe(true);
    });
});
