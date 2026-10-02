import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { tokens } from '../../../engine/theme/tokens';

// The sections are defined once, in sections.ts, so this screen and the
// ?scene= gallery show the same things (R13.30).
import { developerSections } from './sections';
import { SECTION_INSET } from './DeveloperSectionPanel';

/** Around the sections inside the scroll container. */
const SECTION_MARGIN = 40;
/** Sections' content stays 80 apart; each frame's inset comes out of that gap. */
const SECTION_GAP = 80 - SECTION_INSET * 2;
const BACK_WIDTH = 200;

/**
 * Every gallery scene in one scrolling column, reachable in game with F12:
 * a root stack with the title, a scroll container holding the sections, and
 * Back. Each section is the same factory the gallery mounts as a scene,
 * stretched to the column's width, so a resize reflows the sections through
 * layout with nothing rebuilt. Focus starts on Back; Page Up and Page Down
 * scroll and Escape returns to the menu.
 */
export class DeveloperScreen extends Screen {
	private readonly stack: Stack;
	private scroller: ScrollContainer | null = null;

	constructor() {
		const root = new Stack({
			id: 'developerScreen',
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'center',
			gap: tokens.space.space_4,
			padding: { top: tokens.space.space_4, bottom: tokens.space.space_4 },
			style: { backgroundColor: 'bg_base' },
		});
		super('developerScreen', { root });
		this.stack = root;
	}

	protected onMount(): void {
		this.stack.addChild(new Text('Developer Tools', {
			id: 'dev_title',
			style: {
				fontRole: 'display',
				fontSize: 'fs_4xl',
				color: 'text_bright',
			},
			wrap: 'none',
		}));

		const column = new Stack({ id: 'dev_sections', gap: SECTION_GAP, padding: SECTION_MARGIN, crossAlign: 'stretch' });
		for (const definition of developerSections) column.addChild(definition.build({}));
		this.scroller = new ScrollContainer({
			id: 'dev_scroll',
			widthMode: 'fill',
			heightMode: 'fill',
			alignSelf: 'stretch',
		});
		this.scroller.addChild(column);
		this.stack.addChild(this.scroller);

		const back = new Button('Back to Menu', {
			id: 'dev_back_button',
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
		this.context.focus.focus(back);
	}

	protected onUnmount(): void {
		const { hotkeys } = this.rootLayer;
		for (const key of ['Escape', 'PageDown', 'PageUp']) hotkeys.unregister(key);
		this.stack.clearChildren();
		this.scroller = null;
	}

	private back(): void {
		ScreenManager.navigate('mainMenuScreen');
	}
}
