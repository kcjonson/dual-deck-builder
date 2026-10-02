import { DeveloperSectionPanel } from './DeveloperSectionPanel';
import { Button } from '../../../engine/ui/Button';
import { Icon } from '../../../engine/components/Icon';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Text } from '../../../engine/components/Text';
import { ICON_CODE_POINTS, IconName } from '../../../engine/text/icons';
import { tokens } from '../../../engine/theme/tokens';
import { ArmorBadge } from '../../ui/ArmorBadge';
import { EnemyIntent, IntentMarker } from '../../ui/IntentMarker';

const ICON_SIZES = [12, 16, 24];
const ROW_LABEL_X = 20;
const CONTENT_X = 120;
const ICON_PITCH = 40;
const ROW_HEIGHT = 44;
const BADGE_GAP = 40;

/**
 * Every icon in the atlas (R12.6) at three sizes, bare and on a badge fill,
 * then the game sites that draw them: a button with a leading icon beside one
 * without, the four enemy intents, and the armor badge with and without
 * shield. An icon added to icons.txt shows up here without touching this file.
 */
export class IconExamplesSection extends DeveloperSectionPanel {
	constructor(x: number, y: number, width: number) {
		super({ id: 'dev_section_icons', x, y, width });

		this.initializeContent();
	}

	private initializeContent(): void {
		const title = new Text('Icons', {
			style: {
				fontSize: 28,
				color: '#ffffff',
				fontWeight: 'bold',
			},
		});
		title.setPosition(0, 0);
		this.addChild(title);

		let currentY = 50;
		const names = Object.keys(ICON_CODE_POINTS) as IconName[];
		// The badged glyphs sit beside the bare ones where the section is wide
		// enough for both, and under them where it is not
		const gridWidth = names.length * ICON_PITCH;
		const sideBySide = CONTENT_X + gridWidth * 2 + BADGE_GAP <= this.sectionContentWidth;
		const badgeX = sideBySide ? CONTENT_X + gridWidth + BADGE_GAP : CONTENT_X;

		for (const size of ICON_SIZES) {
			this.addRowLabel(`${size} px`, currentY + 12);
			names.forEach((glyph, index) => {
				const x = CONTENT_X + index * ICON_PITCH;
				this.addChild(new Icon({ glyph, size, tint: tokens.color.text, x, y: currentY + (ROW_HEIGHT - size) / 2 }));
			});
			if (sideBySide) this.addBadgeRow(names, size, badgeX, currentY);
			currentY += ROW_HEIGHT;
		}
		if (!sideBySide) {
			for (const size of ICON_SIZES) {
				this.addRowLabel(`${size} px badge`, currentY + 12);
				this.addBadgeRow(names, size, badgeX, currentY);
				currentY += ROW_HEIGHT;
			}
		}

		currentY += 10;
		this.addRowLabel('Buttons', currentY + 15);
		const withIcon = new Button('Back to Menu', { id: 'dev_icons_button_with_icon', icon: 'arrow_back', width: 200, height: 50 });
		withIcon.setPosition(CONTENT_X, currentY);
		this.addChild(withIcon);
		const withoutIcon = new Button('Back to Menu', { id: 'dev_icons_button_without_icon', width: 200, height: 50 });
		withoutIcon.setPosition(CONTENT_X + 220, currentY);
		this.addChild(withoutIcon);
		currentY += 70;

		this.addRowLabel('Intents', currentY + 5);
		const intents: EnemyIntent[] = [
			{ type: 'attack', value: 15, description: 'attack' },
			{ type: 'defend', value: 6, description: 'defend' },
			{ type: 'repair', value: 4, description: 'repair' },
			{ type: 'special', description: 'special' },
		];
		intents.forEach((intent, index) => {
			const marker = new IntentMarker({ id: `dev_icons_intent_${intent.type}`, x: CONTENT_X + index * 50, y: currentY, size: 30 });
			marker.intent = intent;
			this.addChild(marker);
		});
		currentY += 50;

		this.addRowLabel('Armor', currentY);
		const armors: [number, number][] = [[0, 0], [5, 0], [5, 3], [10, 12]];
		armors.forEach(([armor, shield], index) => {
			const badge = new ArmorBadge({ id: `dev_icons_armor_${index}`, x: CONTENT_X + index * 80, y: currentY, minWidth: 35, height: 16 });
			badge.armor = armor;
			badge.shield = shield;
			this.addChild(badge);
		});
		currentY += 30;

		this.fitContentHeight(currentY);
	}

	/** Each glyph on a badge fill, as the HUD draws it. */
	private addBadgeRow(names: readonly IconName[], size: number, x: number, y: number): void {
		const badgeSize = size + 8;
		names.forEach((glyph, index) => {
			const badge = new Rectangle({
				x: x + index * ICON_PITCH,
				y: y + (ROW_HEIGHT - badgeSize) / 2,
				width: badgeSize,
				height: badgeSize,
				style: {
					backgroundColor: '#8a6a4a',
					borderColor: '#ffffff',
					borderWidth: 1,
					borderRadius: Math.floor(badgeSize / 4),
				},
			});
			badge.addChild(new Icon({ glyph, size, tint: tokens.color.text_bright, x: 4, y: 4 }));
			this.addChild(badge);
		});
	}

	private addRowLabel(label: string, y: number): void {
		const text = new Text(label, {
			style: {
				fontSize: 14,
				color: '#cccccc',
			},
		});
		text.setPosition(ROW_LABEL_X, y);
		this.addChild(text);
	}

	/**
	 * Get the height of this section
	 */
	public getHeight(): number {
		return this.height;
	}
}
