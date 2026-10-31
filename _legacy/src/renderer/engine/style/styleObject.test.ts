import { tokens } from '../theme/tokens';
import {
	STYLE_PROPERTIES,
	StyleAcceptance,
	StyleObject,
	StyleProperty,
	fontRoleOfFamily,
	resolveColor,
	resolveLength,
	resolveLetterSpacing,
	resolvePadding,
	resolveShadow,
	validateStyle,
} from './styleObject';

const acceptance: StyleAcceptance = {
	component: 'Widget',
	properties: new Set<StyleProperty>(['backgroundColor', 'color', 'fontSize']),
	states: new Set(['hover']),
	stateProperties: new Set<StyleProperty>(['backgroundColor']),
};

describe('the closed style set (R11.14)', () => {
	it('is exactly the spec\'s sixteen properties plus the fontFamily alias', () => {
		expect([...STYLE_PROPERTIES].sort()).toEqual([
			'backgroundColor', 'borderColor', 'borderRadius', 'borderWidth', 'color', 'cursor', 'fontFamily', 'fontRole',
			'fontSize', 'fontWeight', 'letterSpacing', 'opacity', 'padding', 'shadow', 'textAlign', 'textDecoration', 'textTransform',
		]);
	});

	it('accepts what the component renders', () => {
		expect(() => validateStyle({ backgroundColor: 'accent', fontSize: 12, hover: { backgroundColor: 'data' } }, acceptance)).not.toThrow();
	});

	it('throws on a key outside the set in a development build', () => {
		expect(() => validateStyle({ border: '2px solid #fff' } as StyleObject, acceptance)).toThrow(/style\.border is not a style property/);
		expect(() => validateStyle({ hover: { verticalAlign: 'top' } } as unknown as StyleObject, acceptance)).toThrow(/style\.hover\.verticalAlign/);
	});

	it('throws on a property in the set that the component does not render, in every build', () => {
		expect(() => validateStyle({ borderRadius: 4 }, acceptance)).toThrow(/style\.borderRadius is a style property this component does not render/);
		const env = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';
		try {
			expect(() => validateStyle({ borderRadius: 4 }, acceptance)).toThrow(/does not render/);
			expect(() => validateStyle({ border: 'x' } as StyleObject, acceptance)).not.toThrow();
		} finally {
			process.env.NODE_ENV = env;
		}
	});

	it('throws on a state the component does not have, and on a state property it does not layer', () => {
		expect(() => validateStyle({ pressed: { backgroundColor: 'data' } }, acceptance)).toThrow(/style\.pressed is a state this component does not have/);
		expect(() => validateStyle({ hover: { color: 'data' } }, acceptance)).toThrow(/style\.hover\.color .* in a state/);
	});
});

describe('style values', () => {
	it('reads a colour token by name and the CSS forms by parsing', () => {
		expect(resolveColor('accent')).toBe(tokens.color.accent);
		expect(resolveColor('#ff0000')).toEqual([1, 0, 0, 1]);
		expect(resolveColor('#f00')).toEqual([1, 0, 0, 1]);
		expect(resolveColor('rgba(0, 0, 255, 0.5)')).toEqual([0, 0, 1, 0.5]);
		expect(resolveColor('transparent')).toEqual([0, 0, 0, 0]);
		expect(resolveColor([0.1, 0.2, 0.3, 1])).toEqual([0.1, 0.2, 0.3, 1]);
	});

	it('throws on a colour string that is neither, rather than drawing white', () => {
		expect(() => resolveColor('accnet')).toThrow(/not a colour token or a CSS colour/);
	});

	it('reads lengths as numbers or tokens from the property\'s categories', () => {
		expect(resolveLength(3, 'borderWidth')).toBe(3);
		expect(resolveLength('r_lg', 'borderRadius')).toBe(tokens.radius.r_lg);
		expect(resolveLength('fs_xl', 'fontSize')).toBe(tokens.fontSize.fs_xl);
		expect(resolveLength('control_fs_lg', 'fontSize')).toBe(tokens.control.control_fs_lg);
		expect(resolveLength('space_3', 'padding')).toBe(tokens.space.space_3);
		expect(() => resolveLength('space_3', 'borderRadius')).toThrow(/not a number or a radius token/);
		expect(() => resolveLength(NaN, 'padding')).toThrow(/finite/);
	});

	it('reads letter spacing as em or a token', () => {
		expect(resolveLetterSpacing(0.1)).toBe(0.1);
		expect(resolveLetterSpacing('ls_wide')).toBe(tokens.letterSpacing.ls_wide);
		expect(() => resolveLetterSpacing('wide')).toThrow();
	});

	it('expands padding and keeps unset sides from the fallback', () => {
		const fallback = { top: 0, right: 12, bottom: 0, left: 12 };
		expect(resolvePadding(4, fallback)).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
		expect(resolvePadding({ left: 'space_4' }, fallback)).toEqual({ top: 0, right: 12, bottom: 0, left: 16 });
	});

	it('reads a shadow as an elevation token or an explicit value', () => {
		expect(resolveShadow('shadow_raised')).toEqual({ color: tokens.color.shadow, blur: 14, spread: 0, offset: { x: 0, y: 6 } });
		expect(resolveShadow({ color: 'accent', blur: 4 })).toEqual({ color: tokens.color.accent, blur: 4, spread: 0, offset: { x: 0, y: 0 } });
		expect(() => resolveShadow('shadow_inset')).toThrow(/inset/);
	});

	it('maps fontFamily monospace to mono and anything else to body with a warning', () => {
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
		expect(fontRoleOfFamily('monospace', 'Widget')).toBe('mono');
		expect(warn).not.toHaveBeenCalled();
		expect(fontRoleOfFamily('Arial', 'Widget')).toBe('body');
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/fontFamily "Arial" maps to the body role/));
		warn.mockRestore();
	});
});
