/**
 * @jest-environment jsdom
 */
import { Button } from '../ui/Button';
import { resolveColor, resolveLength, resolveShadow } from '../style/styleObject';
import { buttonLayers, toneColor } from '../style/variants';
import { Theme, themes, tokens } from '../theme/tokens';
import { Component } from './Component';
import { Container } from './Container';
import { Rectangle } from './Rectangle';
import { Stack } from './Stack';
import { Text } from './Text';
import { createTestContext } from './testing';

const { atlas, dark } = themes;

/** Counts what the framework tells it, so a test can see a dark tree is never told anything. */
class ThemeProbe extends Component {
	public changes: Theme[] = [];

	protected onThemeChange(theme: Theme): void {
		this.changes.push(theme);
	}
}

/** A themed tree's usual parts: a box, a stack's backdrop, a label, and a primary button. */
function parts() {
	const box = new Rectangle({ style: { backgroundColor: 'bg_panel', borderColor: 'line_edge', borderWidth: 1, borderRadius: 'radius_panel' } });
	const stack = new Stack({ style: { backgroundColor: 'bg_inset' } });
	const label = new Text({ text: 'Day 3', style: { color: 'text_dim' } });
	const button = new Button({ label: 'Plan a supply run', tone: 'accent' });
	return { box, stack, label, button };
}

describe('theme resolution through style resolution (R11.15)', () => {
	it('resolves token names against the theme it is given, the base by default', () => {
		expect(resolveColor('accent')).toEqual(tokens.color.accent);
		expect(resolveColor('accent', atlas)).toEqual(atlas.color.accent);
		expect(resolveColor('#ff0000', atlas)).toEqual([1, 0, 0, 1]);
		expect(resolveLength('radius_ui', 'borderRadius')).toBe(2);
		expect(resolveLength('radius_ui', 'borderRadius', atlas)).toBe(0);
		expect(resolveShadow('shadow_raised', atlas).color).toEqual(atlas.color.shadow);
	});

	it('builds variant layers from the theme', () => {
		expect(toneColor('crit', 1, atlas)).toEqual(atlas.color.status_crit);
		const layers = buttonLayers('accent', {}, false, atlas);
		expect(layers.normal.fill).toEqual(atlas.color.accent);
		expect(layers.normal.text).toEqual(atlas.color.accent_contrast);
		expect(layers.normal.radius).toBe(0);
		expect(layers.focusRing).toEqual(atlas.color.accent);
		expect(buttonLayers('accent', {}).normal.fill).toEqual(dark.color.accent);
	});
});

describe('Component theme (UI Art Direction, open question 1)', () => {
	it('inherits the nearest own theme, and a root without one is dark', () => {
		const root = new Container();
		const middle = new Container();
		const leaf = new Container();
		root.addChild(middle);
		middle.addChild(leaf);
		expect(leaf.effectiveTheme).toBe('dark');
		expect(leaf.themeTokens).toBe(dark);

		root.theme = 'atlas';
		expect(leaf.effectiveTheme).toBe('atlas');
		expect(leaf.themeTokens).toBe(atlas);

		middle.theme = 'dark';
		expect(leaf.effectiveTheme).toBe('dark');
		expect(root.effectiveTheme).toBe('atlas');
	});

	it('resolves its parts against the theme of the tree it is added to', () => {
		const root = new Container({ theme: 'atlas' });
		const { box, stack, label, button } = parts();
		root.addChild(box).addChild(stack).addChild(label).addChild(button);
		root.mount(createTestContext());

		expect(box.fillColor).toEqual(atlas.color.bg_panel);
		expect(box.borderColor).toEqual(atlas.color.line_edge);
		expect(box.cornerRadius).toBe(0);
		expect(stack.resolvedColors?.fill ?? null).toBeNull();
		stack.setSize(10, 10);
		expect(stack.resolvedColors?.fill).toEqual(atlas.color.bg_inset);
		expect(label.color).toEqual(atlas.color.text_dim);
		expect(button.look.fill).toEqual(atlas.color.accent);
		expect(button.look.text).toEqual(atlas.color.accent_contrast);
		expect(button.look.radius).toBe(0);
	});

	it('keeps an unthemed tree on the dark values', () => {
		const root = new Container();
		const { box, label, button } = parts();
		root.addChild(box).addChild(label).addChild(button);
		root.mount(createTestContext());

		expect(box.fillColor).toEqual(dark.color.bg_panel);
		expect(box.cornerRadius).toBe(dark.radius.r_sm);
		expect(label.color).toEqual(dark.color.text_dim);
		expect(button.look.fill).toEqual(dark.color.accent);
		expect(button.look.radius).toBe(dark.radius.r_sm);
	});

	it('never tells a dark tree about a theme, so nothing in it resolves twice', () => {
		const root = new Container();
		const probe = new ThemeProbe();
		root.addChild(probe);
		root.mount(createTestContext());
		root.theme = 'dark';
		expect(probe.changes).toEqual([]);
	});

	it('re-resolves a mounted tree when its theme changes, and once only', () => {
		const root = new Container();
		const probe = new ThemeProbe();
		const { box, button } = parts();
		root.addChild(probe).addChild(box).addChild(button);
		root.mount(createTestContext());

		root.theme = 'atlas';
		expect(probe.changes).toEqual([atlas]);
		expect(box.fillColor).toEqual(atlas.color.bg_panel);
		expect(button.look.fill).toEqual(atlas.color.accent);

		root.theme = null;
		expect(probe.changes).toEqual([atlas, dark]);
		expect(box.fillColor).toEqual(dark.color.bg_panel);
		expect(button.look.fill).toEqual(dark.color.accent);
	});

	it('re-resolves a subtree moved between a themed and an unthemed parent', () => {
		const atlasRoot = new Container({ theme: 'atlas' });
		const darkRoot = new Container();
		const group = new Container();
		const label = new Text({ text: 'Fuel', style: { color: 'text' } });
		group.addChild(label);
		atlasRoot.addChild(group);
		expect(label.color).toEqual(atlas.color.text);

		darkRoot.addChild(group);
		expect(label.color).toEqual(dark.color.text);
	});

	it('keeps a setter override as authored, so a token name follows the theme', () => {
		const root = new Container();
		const box = new Rectangle({ style: { backgroundColor: 'bg_panel' } });
		root.addChild(box);
		box.fillColor = 'accent';
		box.cornerRadius = 6;

		root.theme = 'atlas';
		expect(box.fillColor).toEqual(atlas.color.accent);
		expect(box.cornerRadius).toBe(6);
	});

	it('puts a subtree taken off a themed parent and mounted as a root back on the base', () => {
		const root = new Container({ theme: 'atlas' });
		const label = new Text({ text: 'Rumor', style: { color: 'text' } });
		root.addChild(label);
		root.removeChild(label);
		label.mount(createTestContext());
		expect(label.color).toEqual(dark.color.text);
	});

	it('resolves a component built with its own theme against it from the constructor', () => {
		const label = new Text({ text: 'Legend', theme: 'atlas', style: { color: 'text' } });
		expect(label.color).toEqual(atlas.color.text);
	});
});
