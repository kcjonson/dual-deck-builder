import { tokens } from '../theme/tokens';
import { RESTING_FLAGS, StateFlags, glowShadow, layersInkExtent, lookInk, over, resolveLook, shadowExtent } from './look';
import { autoTone, buttonLayers, CONTROL_SIZES, fieldLayers } from './variants';

const { color } = tokens;
const flags = (set: Partial<StateFlags>): StateFlags => ({ ...RESTING_FLAGS, ...set });
const NO_GLOW = [0, 0, 0, 0];

describe('layered state resolution (R11.12)', () => {
	const neutral = buttonLayers('default', {});
	const accent = buttonLayers('accent', {});
	const raisedHover = over(color.bg_panel_raised, color.bg_hover);
	const raisedPressed = over(color.bg_panel_raised, color.bg_pressed);
	const selectedFill = over(color.bg_panel_raised, color.bg_active);

	// [label, layers, flags, expected subset]
	const table: Array<[string, typeof neutral, Partial<StateFlags>, Record<string, unknown>]> = [
		['resting', neutral, {}, { fill: color.bg_panel_raised, border: color.line_edge, text: color.text, glow: NO_GLOW, offsetY: 0, focusRing: null }],
		['hovered: the white wash', neutral, { hovered: true }, { fill: raisedHover, offsetY: 0 }],
		['hovered accent: brightened with glow', accent, { hovered: true }, { fill: color.accent_bright, glow: color.accent_glow }],
		['pressed: pressed wash and the nudge, no hover wash', neutral, { hovered: true, pressed: true }, { fill: raisedPressed, offsetY: tokens.control.press_offset }],
		['pressed accent: no glow while held', accent, { hovered: true, pressed: true }, { fill: over(color.accent, color.bg_pressed), glow: NO_GLOW }],
		['focused without focus-visible: no ring', neutral, { focused: true }, { focusRing: null }],
		['focus-visible: the ring', neutral, { focused: true, focusVisible: true }, { focusRing: color.accent, fill: color.bg_panel_raised }],
		['focus-visible under the pointer keeps its ring and its hover', neutral, { focused: true, focusVisible: true, hovered: true }, { focusRing: color.accent, fill: raisedHover }],
		['focus-visible while pressed keeps its ring', neutral, { focused: true, focusVisible: true, pressed: true }, { focusRing: color.accent, offsetY: tokens.control.press_offset }],
		['selected: the selected base', neutral, { selected: true }, { fill: selectedFill, text: color.text_bright, border: color.accent }],
		['hovered and selected: both treatments', neutral, { selected: true, hovered: true }, { fill: over(selectedFill, color.bg_hover), text: color.text_bright }],
		['active: border lifts and the active wash', neutral, { active: true }, { border: color.accent, fill: over(color.bg_panel_raised, color.bg_active) }],
		['open counts as layer 4', neutral, { open: true }, { border: color.accent }],
		['dropActive counts as layer 4', neutral, { dropActive: true }, { border: color.accent }],
		['disabled: disabled text', neutral, { enabled: false }, { text: color.text_disabled, fill: color.bg_panel_raised }],
		['disabled ignores hover and press', neutral, { enabled: false, hovered: true, pressed: true }, { fill: color.bg_panel_raised, offsetY: 0, glow: NO_GLOW }],
		['disabled accent drops to the neutral surface with muted text, as the mock\'s waiting End Turn', accent, { enabled: false, hovered: true }, { fill: color.bg_panel_raised, text: color.text_dim, glow: NO_GLOW }],
		['disabled and active: the border lift survives, the wash does not', neutral, { enabled: false, active: true }, { border: color.accent, fill: color.bg_panel_raised }],
		['disabled with focus-visible: no ring', neutral, { enabled: false, focused: true, focusVisible: true }, { focusRing: null }],
	];

	it.each(table)('%s', (_label, layers, set, expected) => {
		expect(resolveLook(layers, flags(set))).toMatchObject(expected);
	});

	it('skips the hover layer for a pointer that cannot hover', () => {
		expect(resolveLook(neutral, flags({ hovered: true }), { canHover: false }).fill).toEqual(color.bg_panel_raised);
	});
});

describe('override semantics (R11.15)', () => {
	it('replaces the normal fill with backgroundColor and still washes it on hover', () => {
		const layers = buttonLayers('default', { backgroundColor: '#336699' });
		const base = resolveLook(layers, flags({}));
		const hovered = resolveLook(layers, flags({ hovered: true }));
		expect(base.fill).toEqual([0.2, 0.4, 0.6, 1]);
		expect(hovered.fill).toEqual(over([0.2, 0.4, 0.6, 1], color.bg_hover));
	});

	it('keeps the wash rather than the bright fill when a tone is overridden, so the override still reads as hovered', () => {
		const layers = buttonLayers('accent', { backgroundColor: 'data' });
		const hovered = resolveLook(layers, flags({ hovered: true }));
		expect(hovered.fill).toEqual(over(color.data, color.bg_hover));
		expect(hovered.glow).toEqual(color.accent_glow);
	});

	it('keeps pressed, focus, and disabled feedback over an override', () => {
		const layers = buttonLayers('default', { backgroundColor: 'bg_void', color: 'accent' });
		expect(resolveLook(layers, flags({ pressed: true })).offsetY).toBe(tokens.control.press_offset);
		expect(resolveLook(layers, flags({ focused: true, focusVisible: true })).focusRing).toEqual(color.accent);
		expect(resolveLook(layers, flags({ enabled: false })).text).toEqual(color.text_disabled);
	});

	it('replaces only the hover layer with a hover sub-object', () => {
		const layers = buttonLayers('default', { hover: { backgroundColor: 'data' } });
		expect(resolveLook(layers, flags({ hovered: true })).fill).toEqual(color.data);
		expect(resolveLook(layers, flags({ pressed: true })).fill).toEqual(over(color.bg_panel_raised, color.bg_pressed));
		expect(resolveLook(layers, flags({})).fill).toEqual(color.bg_panel_raised);
	});

	it('keeps the nudge when a pressed sub-object replaces the pressed colours', () => {
		const layers = buttonLayers('default', { pressed: { backgroundColor: 'bg_void' } });
		expect(resolveLook(layers, flags({ pressed: true }))).toMatchObject({ fill: color.bg_void, offsetY: tokens.control.press_offset });
	});

	it('applies an instance override to the selected base too, and a selected sub-object on top', () => {
		const layers = buttonLayers('default', { borderRadius: 'r_lg', selected: { color: 'data' } });
		const selected = resolveLook(layers, flags({ selected: true }));
		expect(selected.radius).toBe(tokens.radius.r_lg);
		expect(selected.text).toEqual(color.data);
	});

	it('rejects tone auto on a button, which has no value to band', () => {
		expect(() => buttonLayers('auto', {})).toThrow(/tone "auto"/);
	});
});

describe('field layers', () => {
	it('is an inset well whose editing state lifts the border to the accent', () => {
		const layers = fieldLayers({});
		expect(resolveLook(layers, flags({})).fill).toEqual(color.bg_inset);
		expect(resolveLook(layers, flags({ active: true, focused: true })).border).toEqual(color.accent);
	});
});

describe('variant vocabulary (R11.10)', () => {
	it('sets height, font, and icon size together per size', () => {
		expect(CONTROL_SIZES.sm).toEqual({ height: 26, fontSize: 13, iconSize: tokens.control.icon_sm });
		expect(CONTROL_SIZES.md).toEqual({ height: 34, fontSize: 15, iconSize: tokens.control.icon_md });
		expect(CONTROL_SIZES.lg).toEqual({ height: 46, fontSize: 18, iconSize: tokens.control.icon_lg });
	});

	it('bands tone auto below 0.25 critical, below 0.5 warning, else ok', () => {
		expect([0, 0.24, 0.25, 0.49, 0.5, 1].map(autoTone)).toEqual(['crit', 'crit', 'warn', 'warn', 'ok', 'ok']);
	});
});

describe('over', () => {
	it('composites a straight-alpha wash onto an opaque fill', () => {
		expect(over([0, 0, 0, 1], [1, 1, 1, 0.5])).toEqual([0.5, 0.5, 0.5, 1]);
	});

	it('leaves a transparent fill with just the wash', () => {
		expect(over([0, 0, 0, 0], [1, 1, 1, 0.045])).toEqual([1, 1, 1, 0.045]);
	});
});

describe('ink extent (R8.8)', () => {
	const ring = tokens.control.focus_ring_offset + tokens.control.focus_ring_width;
	const nudge = tokens.control.press_offset;

	it('covers the focus ring and the press nudge on a neutral button', () => {
		expect(layersInkExtent(buttonLayers('default', {}))).toBe(ring + nudge);
	});

	it('covers the hover glow on a filled tone', () => {
		const glow = shadowExtent(glowShadow(color.accent_glow));
		expect(glow).toBeGreaterThan(ring);
		expect(layersInkExtent(buttonLayers('accent', {}))).toBe(glow + nudge);
	});

	it("covers the style's own shadow, offset included", () => {
		const extent = layersInkExtent(buttonLayers('default', { shadow: { color: 'shadow', blur: 20, offset: { x: 0, y: 10 } } }));
		expect(extent).toBe(20 * 1.5 + 10 + nudge);
	});

	it('covers only the ring on a field, which never nudges or glows', () => {
		expect(layersInkExtent(fieldLayers({}))).toBe(ring);
	});
});

describe('resting ink (R12.20)', () => {
	const ring = tokens.control.focus_ring_offset + tokens.control.focus_ring_width;
	const shape = { x: 10, y: 20, width: 100, height: 30 };

	it('gives the every-state extent, and what is drawn now with the pointer away: the ring while focus shows', () => {
		const layers = buttonLayers('accent', {});
		expect(lookInk(layers, flags({}), shape)).toEqual({ extent: layersInkExtent(layers), resting: shape });
		// Hovered and pressed it glows and nudges, which a reveal leaves out
		const ringed = { x: 10 - ring, y: 20 - ring, width: 100 + ring * 2, height: 30 + ring * 2 };
		expect(lookInk(layers, flags({ focused: true, focusVisible: true, hovered: true, pressed: true }), shape).resting).toEqual(ringed);
		expect(lookInk(layers, flags({ focused: true, focusVisible: true, enabled: false }), shape).resting).toEqual(shape);
	});

	it("puts the base's own shadow where it falls, the selected base's when selected", () => {
		const shadow = { color: 'shadow', blur: 20, offset: { x: 4, y: 10 } } as const;
		const raised = buttonLayers('default', { shadow });
		// 1.5 blur round the shape, moved by the offset, which covers the ring
		const cast = { x: 10 + 4 - 30, y: 20 + 10 - 30, width: 160, height: 90 };
		expect(lookInk(raised, flags({ focused: true, focusVisible: true }), shape).resting).toEqual(cast);
		// Only the selected base has a shadow here
		const plain = buttonLayers('default', {});
		const selectedOnly = { ...plain, selected: { ...plain.selected, shadow: raised.normal.shadow } };
		expect(lookInk(selectedOnly, flags({ selected: true }), shape).resting).toEqual(cast);
		expect(lookInk(selectedOnly, flags({}), shape).resting).toEqual(shape);
	});
});
