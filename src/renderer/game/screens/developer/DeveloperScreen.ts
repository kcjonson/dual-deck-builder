import { Screen } from '../../core/Screen';
import { ScreenManager } from '../../core/ScreenManager';
import { Button } from '../../../engine/ui/Button';
import { Text } from '../../../engine/components/Text';
import { Layer } from '../../../engine/components/Layer';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { Rectangle } from '../../../engine/components/Rectangle';

// The sections are defined once, in sections.ts, so this screen and the
// ?scene= gallery show the same things (R13.30).
import { developerSections } from './sections';
import { SECTION_INSET } from './DeveloperSectionPanel';

const TITLE_FONT_SIZE = 48;
const TITLE_LINE_HEIGHT = 1.2;
/** The strip above the scroll panel. The title's whole line box sits inside it. */
const HEADER_HEIGHT = 80;
/** The strip below the scroll panel, which holds the back button. */
const FOOTER_HEIGHT = 80;
/**
 * The title's line box ends this far above the panel. The panel is submitted
 * after the title and is opaque, so a line box reaching past the header would
 * lose its descenders under it (chapter 3).
 */
const TITLE_GAP = 6;
const TITLE_TOP = Math.floor(HEADER_HEIGHT - TITLE_FONT_SIZE * TITLE_LINE_HEIGHT - TITLE_GAP);

/**
 * Developer screen for testing UI components and rendering
 */
export class DeveloperScreen extends Screen {
	private background: Rectangle;
	private title: Text;
	private backButton: Button;
	private mainScrollContainer: ScrollContainer;
	/** The scroll container's one content child: the sections, placed by hand. */
	private sectionColumn: Layer;
	private sectionsBuilt = false;

	/**
	 * Create a new developer screen. Everything sized from the viewport is
	 * placed by positionElements once the root has the viewport's size.
	 */
	constructor() {
		super('developerScreen');

		this.background = new Rectangle({
			style: {
				backgroundColor: '#262626',
			},
		});
		this.rootLayer.addChild(this.background);

		this.title = new Text('Developer Tools', {
			id: 'dev_title',
			y: TITLE_TOP,
			style: {
				fontSize: TITLE_FONT_SIZE,
				lineHeight: TITLE_LINE_HEIGHT,
				color: '#ffffff',
				textAlign: 'center',
				whiteSpace: 'nowrap',
			},
		});
		this.rootLayer.addChild(this.title);

		this.backButton = new Button('Back to Menu', {
			width: 200,
			height: 50,
			style: {
				fontSize: 20,
			},
		});
		this.backButton.onClick = () => {
			ScreenManager.navigate('mainMenuScreen');
		};
		this.rootLayer.addChild(this.backButton);

		// One full-width scrollable container for every section
		this.mainScrollContainer = new ScrollContainer({
			id: 'dev_scroll',
			y: HEADER_HEIGHT,
			style: {
				backgroundColor: '#262626', // Match the background
			},
		});
		this.sectionColumn = new Layer({ id: 'dev_sections' });
		this.mainScrollContainer.addChild(this.sectionColumn);
		this.rootLayer.addChild(this.mainScrollContainer);
	}

	protected onMount(): void {
		this.positionElements();
		this.buildSections();
	}

	/**
	 * The background, the title, the back button (bottom centre), and the
	 * scroll panel between the header and the footer, from the root's size.
	 */
	private positionElements(): void {
		const width = this.rootLayer.width;
		const height = this.rootLayer.height;

		this.background.setSize(width, height);
		this.title.setWidth(width);
		this.backButton.setPosition(width / 2 - this.backButton.getWidth() / 2, height - 70);
		this.mainScrollContainer.setSize(width, height - HEADER_HEIGHT - FOOTER_HEIGHT);
	}

	/**
	 * The sections, at the width the screen mounted with. A section computes
	 * its own height from its content and publishes it with setSize on the
	 * last line of its constructor, so the next section's y is only knowable
	 * after the previous factory returned. A resize keeps them as they are.
	 */
	private buildSections(): void {
		if (this.sectionsBuilt) return;
		this.sectionsBuilt = true;

		let currentY = 40;
		// Sections' content stays 80 apart; the inset each frame adds above and
		// below its content comes out of that gap rather than on top of it.
		const sectionSpacing = 80 - SECTION_INSET * 2;
		const margin = 40;
		const contentWidth = this.rootLayer.width - margin * 2;

		for (const definition of developerSections) {
			// Built detached, as the gallery builds it, and measured before it
			// mounts
			const section = definition.build({ x: margin, y: currentY, width: contentWidth });
			currentY += section.getHeight() + sectionSpacing;
			this.sectionColumn.addChild(section);
		}

		this.sectionColumn.setSize(this.rootLayer.width, currentY + 100);
	}

	protected onResized(): void {
		this.positionElements();
	}

	protected onUnmount(): void {
		// Clear any focus from input fields
		this.context.focus.blur();

		this.mainScrollContainer.scrollToTop();
	}
}
