/**
 * @jest-environment jsdom
 */
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { KeyCap } from '../ui/KeyCap';
import { Panel } from '../ui/Panel';
import { Popover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { over } from '../style/look';
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
		// The atlas edges the highway in Casing and rings focus in ink; dark keeps both on its accent.
		expect(layers.normal.border).toEqual(atlas.color.accent_dim);
		expect(layers.focusRing).toEqual(atlas.color.text);
		expect(buttonLayers('accent', {}).normal.fill).toEqual(dark.color.accent);
		expect(buttonLayers('accent', {}).normal.border).toEqual(dark.color.accent);
		expect(buttonLayers('accent', {}).focusRing).toEqual(dark.color.accent);
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

describe('a detached subtree keeps its theme for what is added to it', () => {
	it('resolves a child added while detached against the theme it is re-inserted under', () => {
		const root = new Container({ theme: 'atlas' });
		const group = new Container();
		root.addChild(group);
		root.removeChild(group);
		const label = new Text({ text: 'Water', style: { color: 'text' } });
		group.addChild(label);
		root.addChild(group);
		expect(label.color).toEqual(atlas.color.text);
	});

	it('moves that child to dark when the group is re-inserted under a dark parent', () => {
		const atlasRoot = new Container({ theme: 'atlas' });
		const darkRoot = new Container();
		const group = new Container();
		atlasRoot.addChild(group);
		atlasRoot.removeChild(group);
		const label = new Text({ text: 'Water', style: { color: 'text' } });
		group.addChild(label);
		darkRoot.addChild(group);
		expect(label.color).toEqual(dark.color.text);
	});
});

describe('atlas state looks (R11.12 over the atlas tokens)', () => {
	function atlasButton(tone: 'accent' | 'default'): Button {
		// Unmounted, so every state change snaps rather than fading.
		const root = new Container({ theme: 'atlas' });
		const button = new Button({ label: 'Go', tone });
		root.addChild(button);
		return button;
	}

	it('brightens the highway on hover, without a glow', () => {
		const button = atlasButton('accent');
		button.hovered = true;
		expect(button.look.fill).toEqual(atlas.color.accent_bright);
		expect(button.look.glow[3]).toBe(0);
	});

	it('washes a neutral button with ink on hover', () => {
		const button = atlasButton('default');
		button.hovered = true;
		expect(button.look.fill).toEqual(over(atlas.color.bg_panel_raised, atlas.color.bg_hover));
		expect(button.look.border).toEqual(atlas.color.line_edge);
	});

	it('washes ink at 10% over the fill and nudges it when pressed', () => {
		const button = atlasButton('accent');
		button.pressed = true;
		expect(button.look.fill).toEqual(over(atlas.color.accent, atlas.color.bg_pressed));
		expect(button.look.offsetY).toBe(atlas.control.press_offset);
	});

	it('highlights a selected button and inks its text', () => {
		const button = atlasButton('default');
		button.selected = true;
		expect(button.look.fill).toEqual(over(atlas.color.bg_panel_raised, atlas.color.bg_active));
		expect(button.look.border).toEqual(atlas.color.accent);
		expect(button.look.text).toEqual(atlas.color.text_bright);
	});

	it('drops a disabled highway to paper with dim ink', () => {
		const button = atlasButton('accent');
		button.enabled = false;
		expect(button.look.fill).toEqual(atlas.color.bg_panel_raised);
		expect(button.look.border).toEqual(atlas.color.line_edge);
		expect(button.look.text).toEqual(atlas.color.text_dim);
		expect(button.look.glow[3]).toBe(0);
	});

	it('greys a disabled neutral button to faded print', () => {
		const button = atlasButton('default');
		button.enabled = false;
		expect(button.look.text).toEqual(atlas.color.text_disabled);
	});

	it('draws a rectangle with atlas borders, shadows, and square corners', () => {
		const root = new Container({ theme: 'atlas' });
		const box = new Rectangle({ style: { backgroundColor: 'bg_panel_raised', borderColor: 'line_strong', borderWidth: 'bw', borderRadius: 'radius_ui', shadow: 'shadow_raised' } });
		root.addChild(box);
		box.setSize(40, 20);
		expect(box.resolvedColors).toEqual({ fill: atlas.color.bg_panel_raised, border: atlas.color.line_strong });
		expect(box.cornerRadius).toBe(0);
		expect(box.inkExtent).toBeGreaterThan(0);
	});
});

/** The first component under `root`, `root` included, that `test` accepts. */
function find(root: Component, test: (component: Component) => boolean): Component | null {
	if (test(root)) return root;
	for (const child of root.children) {
		const found = find(child, test);
		if (found) return found;
	}
	return null;
}

describe('overlays take the opener theme', () => {
	function atlasScene() {
		const context = createTestContext({ viewport: { logical: { width: 800, height: 600 } } });
		const scene = new Container({ theme: 'atlas', width: 800, height: 600 });
		const trigger = new Rectangle({ x: 100, y: 100, width: 80, height: 30, tooltip: { title: 'Save', description: 'Writes the run', hotkey: 'S' } });
		scene.addChild(trigger);
		scene.mount(context);
		return { context, trigger };
	}

	it('themes an overlay root from OverlayOptions.theme', () => {
		const { context } = atlasScene();
		const content = new Rectangle({ width: 10, height: 10, style: { backgroundColor: 'bg_panel' } });
		const handle = context.overlays.open(content, { layer: 'overlay', theme: 'atlas' });
		expect(handle.root.theme).toBe('atlas');
		expect(content.fillColor).toEqual(atlas.color.bg_panel);
	});

	it('keeps an overlay opened without a theme on the base', () => {
		const { context } = atlasScene();
		const content = new Rectangle({ width: 10, height: 10, style: { backgroundColor: 'bg_panel' } });
		context.overlays.open(content, { layer: 'overlay' });
		expect(content.fillColor).toEqual(dark.color.bg_panel);
	});

	it('opens a popup in its trigger theme', () => {
		const { context, trigger } = atlasScene();
		const menu = new Panel({ width: 120, height: 60 });
		context.popups.show({ popup: menu, trigger, anchor: trigger });
		expect(menu.effectiveTheme).toBe('atlas');
		expect(menu.resolvedColors.fill).toEqual(atlas.color.bg_panel);
	});

	it('shows a tooltip in its owner theme, key cap included', () => {
		const { context, trigger } = atlasScene();
		context.tooltips.show(trigger, { fade: false });
		const surface = context.tooltips.surface as Tooltip;
		expect(surface.resolvedColors).toEqual({ fill: atlas.color.bg_panel_raised, border: atlas.color.line_edge });
		const title = find(surface, (component) => component.id === 'tooltip_title') as Text;
		expect(title.color).toEqual(atlas.color.text_bright);
		const cap = find(surface, (component) => component instanceof KeyCap) as KeyCap;
		expect(cap.resolvedColors.fill).toEqual(atlas.color.bg_panel_raised);
	});

	it('opens a popover in its anchor theme', () => {
		const { context, trigger } = atlasScene();
		const label = new Text({ text: 'Fuel 4', style: { color: 'text' } });
		const popover = new Popover({ content: label, anchor: trigger });
		popover.show(context);
		expect(popover.resolvedColors).toEqual({ fill: atlas.color.bg_panel_raised, border: atlas.color.line_strong });
		expect(popover.clipRadius).toBe(0);
		expect(label.color).toEqual(atlas.color.text);
	});

	it('opens a dialog in the theme it is shown with: paper panel, table scrim, ink title', () => {
		const { context } = atlasScene();
		const body = new Text({ text: 'End the day?', style: { color: 'text' } });
		const dialog = new Dialog({ title: 'Rest', content: body });
		dialog.show(context, { theme: 'atlas' });
		const panel = find(dialog, (component) => component instanceof Panel) as Panel;
		expect(panel.resolvedColors.fill).toEqual(atlas.color.bg_panel_raised);
		expect(panel.clipRadius).toBe(0);
		expect(body.color).toEqual(atlas.color.text);
		const title = find(panel, (component) => component instanceof Text && component.text === 'Rest') as Text;
		expect(title.color).toEqual(atlas.color.text_bright);
		expect(dialog.resolvedColors?.fill?.slice(0, 3)).toEqual(atlas.color.scrim.slice(0, 3));
	});

	it('re-resolves a panel, inset included, when its theme changes', () => {
		const panel = new Panel({ flush: true, width: 100, height: 50 });
		expect(panel.contentInset.left).toBe(dark.radius.radius_panel);
		panel.theme = 'atlas';
		expect(panel.resolvedColors.fill).toEqual(atlas.color.bg_panel);
		expect(panel.contentInset.left).toBe(atlas.borderWidth.bw);
	});
});
