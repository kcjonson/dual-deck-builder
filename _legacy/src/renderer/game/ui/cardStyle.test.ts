import { resolveColor } from '../../engine/style/styleObject';
import { tokens } from '../../engine/theme/tokens';
import { CARD_LINE, CARD_NAME, DIM_BRIGHTNESS, dimHex, scale, textTones, toneFills } from './cardStyle';

describe('toneFills', () => {
	it('tones any colour the style system reads, an rgba string as well as a hex', () => {
		const line = resolveColor(CARD_LINE);
		expect(toneFills(CARD_LINE)).toEqual({ full: line, dimmed: scale(line, DIM_BRIGHTNESS) });
		expect(toneFills('#0e0f10').full).toEqual([14 / 255, 15 / 255, 16 / 255, 1]);
	});

	it('copies a token rather than handing out the theme\'s own array', () => {
		const fills = toneFills('accent');
		expect(fills.full).toEqual(tokens.color.accent);
		expect(fills.full === tokens.color.accent).toBe(false);
	});
});

describe('textTones', () => {
	it('gives a text colour at full strength and as a faded card\'s words take it', () => {
		expect(textTones(CARD_NAME)).toEqual({ full: resolveColor(CARD_NAME), dimmed: resolveColor(dimHex(CARD_NAME)) });
	});
});
