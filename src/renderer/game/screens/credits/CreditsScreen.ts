import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { tokens } from '../../../engine/theme/tokens';
import { AtlasButton } from '../../ui/atlas/AtlasButton';
import { AtlasSheet } from '../../ui/atlas/AtlasSheet';
import { DISPLAY_BOLD } from '../../ui/atlas/atlasStyle';
import { LegendBox } from '../../ui/atlas/LegendBox';
import { PageTitle } from '../../ui/atlas/PageTitle';
import { CREDITS, CreditSection } from './credits';

const { space } = tokens;
const PANEL_WIDTH = 560;
const BACK_WIDTH = 240;
const NAME_SIZE = 20;

/**
 * The credits, an appendix of the atlas (UI Art Direction, Screens): one
 * sheet with its title at the top, a column of legend boxes, one per
 * section, and Back to contents as a back road. It has no primary action,
 * so no highway. The column takes the height the title and Back leave, so a
 * short viewport scrolls the list rather than pushing Back off the sheet.
 * Focus starts on Back; Page Up, Page Down, Home, and End scroll the list
 * from there (root hotkeys, R9.15), and a press on the list focuses it for
 * the arrows as well. Escape and Back return to the menu with focus on
 * Credits again.
 */
export class CreditsScreen extends Screen {
	private readonly sheet: AtlasSheet;
	private scroller: ScrollContainer | null = null;

	constructor() {
		const root = new AtlasSheet({
			id: 'creditsScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'center',
			gap: space.space_5,
		});
		super('creditsScreen', { root, theme: 'atlas' });
		this.sheet = root;
	}

	protected onMount(): void {
		this.sheet.addChild(new PageTitle({ title: 'Credits', titleId: 'credits_title', alignSelf: 'stretch' }));

		const content = new Stack({
			id: 'credits_list',
			crossAlign: 'stretch',
			gap: space.space_4,
		});
		for (const section of CREDITS) content.addChild(createSection(section));
		this.scroller = new ScrollContainer({
			id: 'credits_scroll',
			widthMode: 'fill',
			heightMode: 'fill',
		});
		this.scroller.addChild(content);

		const panel = new Stack({
			id: 'credits_panel',
			width: PANEL_WIDTH,
			heightMode: 'fill',
			crossAlign: 'stretch',
		});
		panel.addChild(this.scroller);
		this.sheet.addChild(panel);

		const back = new AtlasButton({
			label: 'Back to contents',
			id: 'credits_back_button',
			width: BACK_WIDTH,
			onClick: () => this.back(),
		});
		this.sheet.addChild(back);

		const { hotkeys } = this.rootLayer;
		hotkeys.register('Escape', () => this.back());
		// The list's own page, so the distance is the same whether it or Back has focus.
		hotkeys.register('PageDown', () => this.scroller?.scrollByPages(1));
		hotkeys.register('PageUp', () => this.scroller?.scrollByPages(-1));
		hotkeys.register('Home', () => this.scroller?.scrollToTop());
		hotkeys.register('End', () => this.scroller?.scrollToBottom());
		this.context.focus.focus(back);
	}

	protected onUnmount(): void {
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', 'PageDown', 'PageUp', 'Home', 'End']) hotkeys.unregister(key);
		this.sheet.clearChildren();
		this.scroller = null;
	}

	/** To the menu, focus back on the button that opened this screen. */
	private back(): void {
		ScreenManager.navigate('mainMenuScreen', undefined, { restoreFocus: true });
	}
}

/** A section: a legend box under its heading, each entry's name in display over its lines. */
function createSection(section: CreditSection): LegendBox {
	const box = new LegendBox({ title: section.heading, crossAlign: 'stretch', gap: space.space_3 });
	for (const entry of section.entries) {
		const block = new Stack({ crossAlign: 'stretch', gap: space.space_0_5 });
		block.addChild(new Text({ text: entry.name, style: { fontRole: DISPLAY_BOLD, fontWeight: 700, fontSize: NAME_SIZE, color: 'text' } }));
		for (const line of entry.lines) {
			block.addChild(new Text({ text: line, style: { fontSize: 'fs_base', color: 'text_dim' } }));
		}
		box.addChild(block);
	}
	return box;
}
