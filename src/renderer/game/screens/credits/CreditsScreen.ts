import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { tokens } from '../../../engine/theme/tokens';
import { CREDITS, CreditSection } from './credits';

const PANEL_WIDTH = 560;
const BACK_WIDTH = 200;

/**
 * The credits screen: a root stack with a title, one panel holding the
 * credits in a scroll container, and Back. The panel takes the height the
 * title and Back leave, so a short viewport scrolls the list rather than
 * pushing Back off screen. Focus starts on Back; Page Up, Page Down, Home,
 * and End scroll the list from there (root hotkeys, R9.15), and a press on
 * the list focuses it for the arrows as well. Escape returns to the menu.
 */
export class CreditsScreen extends Screen {
	private readonly stack: Stack;
	private scroller: ScrollContainer | null = null;

	constructor() {
		const root = new Stack({
			id: 'creditsScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'center',
			gap: tokens.space.space_6,
			padding: tokens.space.space_8,
			style: { backgroundColor: 'bg_base' },
		});
		super('creditsScreen', { root });
		this.stack = root;
	}

	protected onMount(): void {
		this.stack.addChild(new Text('Credits', {
			id: 'credits_title',
			style: {
				fontRole: 'display',
				fontSize: 'fs_4xl',
				color: 'text_bright',
				textAlign: 'center',
			},
			wrap: 'none',
		}));

		const content = new Stack({
			id: 'credits_list',
			crossAlign: 'stretch',
			gap: tokens.space.space_6,
		});
		for (const section of CREDITS) content.addChild(createSection(section));
		this.scroller = new ScrollContainer({
			id: 'credits_scroll',
			widthMode: 'fill',
			heightMode: 'fill',
		});
		this.scroller.addChild(content);

		const panel = new Panel({
			id: 'credits_panel',
			corners: true,
			width: PANEL_WIDTH,
			heightMode: 'fill',
			crossAlign: 'stretch',
		});
		panel.addChild(this.scroller);
		this.stack.addChild(panel);

		const back = new Button('Back', {
			id: 'credits_back_button',
			icon: 'arrow_back',
			size: 'lg',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.stack.addChild(back);

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.back());
		hotkeys.register('PageDown', () => this.scroller?.scrollBy(this.scroller.height));
		hotkeys.register('PageUp', () => this.scroller?.scrollBy(-(this.scroller?.height ?? 0)));
		hotkeys.register('Home', () => this.scroller?.scrollToTop());
		hotkeys.register('End', () => this.scroller?.scrollToBottom());
		this.context.focus.focus(back);
	}

	protected onUnmount(): void {
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', 'PageDown', 'PageUp', 'Home', 'End']) hotkeys.unregister(key);
		this.stack.clearChildren();
		this.scroller = null;
	}

	private back(): void {
		ScreenManager.navigate('mainMenuScreen');
	}
}

/** A section: its heading, then each entry's name over its lines. */
function createSection(section: CreditSection): Stack {
	const stack = new Stack({ crossAlign: 'stretch', gap: tokens.space.space_2 });
	stack.addChild(new Text(section.heading, {
		style: {
			fontRole: 'display',
			fontSize: 'fs_lg',
			color: 'accent',
			textTransform: 'uppercase',
			letterSpacing: 'ls_wide',
		},
		wrap: 'none',
	}));
	for (const entry of section.entries) {
		const block = new Stack({ crossAlign: 'stretch', gap: tokens.space.space_0_5 });
		block.addChild(new Text(entry.name, { style: { fontSize: 'fs_md', color: 'text_bright' } }));
		for (const line of entry.lines) {
			block.addChild(new Text(line, { style: { fontSize: 'fs_base', color: 'text_dim' } }));
		}
		stack.addChild(block);
	}
	return stack;
}
