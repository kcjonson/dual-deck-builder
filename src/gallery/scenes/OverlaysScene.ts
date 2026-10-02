import type { Component } from '../../renderer/engine/components/Component';
import type { MountContext } from '../../renderer/engine/components/MountContext';
import { Rectangle } from '../../renderer/engine/components/Rectangle';
import { Text } from '../../renderer/engine/components/Text';
import type { Rect } from '../../renderer/engine/draw/geometry';
import { PlacementSide, place } from '../../renderer/engine/services/Placement';
import type { PopupHandle } from '../../renderer/engine/services/PopupService';
import { tokens } from '../../renderer/engine/theme/tokens';
import { Button } from '../../renderer/engine/ui/Button';
import { DeveloperSectionPanel } from '../../renderer/game/screens/developer/DeveloperSectionPanel';
import type { SceneFactoryOptions } from '../registry';

type Color = [number, number, number, number];

function rgba(color: readonly number[]): Color {
	return [color[0], color[1], color[2], color[3]];
}

const FRAME: Rect = { x: 0, y: 84, width: 640, height: 240 };
const LIVE_X = 700;
const BUTTON_Y = 120;
const BUTTON_WIDTH = 150;
const BUTTON_HEIGHT = 36;
const BUTTON_GAP = 20;
const MENU_ITEMS = ['Repair', 'Refuel', 'Scrap'];
const MENU_ROW = 28;
const MENU_WIDTH = 180;

interface PlacementCase {
	id: string;
	anchor: Rect;
	side: PlacementSide;
	size: { width: number; height: number };
}

/**
 * Four anchors inside a framed bounds, each placed by R12.30's routine
 * against the frame rather than the window, so every outcome is on screen
 * at once: the preferred side, a flip, a shift along the edge, and a box
 * shrunk to the room it has.
 */
const PLACEMENT_CASES: readonly PlacementCase[] = [
	{ id: 'preferred', anchor: { x: 60, y: 40, width: 40, height: 24 }, side: 'bottom', size: { width: 130, height: 40 } },
	{ id: 'flipped', anchor: { x: 280, y: 190, width: 40, height: 24 }, side: 'bottom', size: { width: 130, height: 40 } },
	{ id: 'shifted', anchor: { x: 560, y: 40, width: 40, height: 24 }, side: 'bottom', size: { width: 130, height: 40 } },
	{ id: 'constrained', anchor: { x: 440, y: 100, width: 40, height: 24 }, side: 'bottom', size: { width: 130, height: 200 } },
];

/**
 * The gallery's overlay services scene (DDB-78): placement outcomes drawn
 * in the scene, and the live services on top of it, with a text tooltip and
 * a popup menu open so the golden holds both.
 *
 * Gallery only, not a developer-screen section: it opens overlay roots over
 * whatever hosts it, which on the developer screen would cover the other
 * sections and that screen's golden.
 *
 * The open tooltip and popup are opened from the scene's first `onLayout`,
 * the point at which the owner is mounted and its geometry valid (R8.21).
 * Nothing waits on the clock, and the tooltip is shown without its fade, so
 * the picture is the same on a paused harness page as on a live one.
 */
export class OverlaysScene extends DeveloperSectionPanel {
	private readonly hoverButton: Button;
	private readonly menuButton: Button;
	private menu: PopupHandle | null = null;
	private demoOpened = false;

	constructor({ x, y, width }: SceneFactoryOptions) {
		super({ id: 'gallery_scene_overlays', title: 'Overlays', contentHeight: FRAME.y + FRAME.height, x, y, width });

		this.addChild(new Text({
			text: 'Placement against the framed bounds: preferred side, flip, shift along the edge, constrain to the room.',
			y: 50,
			style: { fontSize: 14, color: rgba(tokens.color.text_dim) },
		}));
		this.addChild(this.buildPlacementFrame());

		this.addChild(new Text({
			text: 'Live services: hover a button for its tooltip; the menu opens from its trigger.',
			x: LIVE_X,
			y: FRAME.y,
			style: { fontSize: 14, color: rgba(tokens.color.text_dim) },
		}));

		this.hoverButton = new Button({
			label: 'Hover me',
			id: 'overlays_hover',
			x: LIVE_X,
			y: BUTTON_Y,
			width: BUTTON_WIDTH,
			height: BUTTON_HEIGHT,
			tooltip: {
				title: 'Reload weapons',
				hotkey: 'R',
				description: 'Refills every mounted weapon on the active vehicle and ends the driver\'s turn.',
			},
		});
		this.addChild(this.hoverButton);

		this.addChild(new Button({
			label: 'Card preview',
			id: 'overlays_card',
			x: LIVE_X + BUTTON_WIDTH + BUTTON_GAP,
			y: BUTTON_Y,
			width: BUTTON_WIDTH,
			height: BUTTON_HEIGHT,
			tooltip: { factory: buildCardPreview },
		}));

		this.menuButton = new Button({
			label: 'Open menu',
			id: 'overlays_menu_trigger',
			x: LIVE_X + (BUTTON_WIDTH + BUTTON_GAP) * 2,
			y: BUTTON_Y,
			width: BUTTON_WIDTH,
			height: BUTTON_HEIGHT,
			popupTrigger: true,
			tooltip: 'Opens a menu through the popup service',
		});
		this.menuButton.onClick = () => this.toggleMenu();
		this.addChild(this.menuButton);

		this.onLayout = () => {
			if (this.demoOpened) return;
			this.demoOpened = true;
			this.openMenu();
			this.context?.tooltips.show(this.hoverButton, { fade: false });
		};
	}

	protected onUnmount(): void {
		this.menu?.close();
		this.menu = null;
	}

	private toggleMenu(): void {
		if (this.menu?.isOpen) this.menu.close();
		else this.openMenu();
	}

	private openMenu(): void {
		const context: MountContext | null = this.context;
		if (!context) return;
		const menu = buildMenu();
		menu.onClick = () => this.menu?.close();
		this.menu = context.popups.show({
			popup: menu,
			trigger: this.menuButton,
			anchor: this.menuButton,
			side: 'bottom',
			align: 'start',
		});
	}

	private buildPlacementFrame(): Component {
		const frame = new Rectangle({
			id: 'overlays_frame',
			x: FRAME.x,
			y: FRAME.y,
			width: FRAME.width,
			height: FRAME.height,
			style: { backgroundColor: rgba(tokens.color.bg_inset), borderColor: rgba(tokens.color.line_edge), borderWidth: 1 },
		});
		const bounds: Rect = { x: 0, y: 0, width: FRAME.width, height: FRAME.height };
		for (const entry of PLACEMENT_CASES) {
			frame.addChild(new Rectangle({
				id: `anchor_${entry.id}`,
				...entry.anchor,
				style: { backgroundColor: rgba(tokens.color.accent), borderRadius: tokens.radius.r_sm },
			}));
			const placed = place({ anchor: entry.anchor, size: entry.size, side: entry.side, viewport: bounds });
			const box = new Rectangle({
				id: `placed_${entry.id}`,
				x: placed.x,
				y: placed.y,
				width: placed.width,
				height: placed.height,
				style: { backgroundColor: rgba(tokens.color.data_dim), borderColor: rgba(tokens.color.data), borderWidth: 1, borderRadius: tokens.radius.r_sm },
			});
			const label = placed.flipped ? `flipped to ${placed.side}` : placed.constrained ? 'constrained' : placed.x !== entry.anchor.x ? 'shifted' : placed.side;
			box.addChild(new Text({ text: label, x: 8, y: 8, style: { fontSize: 12, color: rgba(tokens.color.text_bright) } }));
			frame.addChild(box);
		}
		return frame;
	}
}

/** A plain stand-in for R12.11's Menu, which the catalog builds (DDB-87). */
function buildMenu(): Rectangle {
	const menu = new Rectangle({
		id: 'overlays_menu',
		width: MENU_WIDTH,
		height: MENU_ITEMS.length * MENU_ROW + 8,
		style: {
			backgroundColor: rgba(tokens.color.bg_panel_raised),
			borderColor: rgba(tokens.color.line_strong),
			borderWidth: 1,
			borderRadius: tokens.radius.radius_ui,
		},
	});
	MENU_ITEMS.forEach((item, index) => {
		menu.addChild(new Text({
			text: item,
			id: `overlays_menu_${item.toLowerCase()}`,
			x: 12,
			y: 4 + index * MENU_ROW + 5,
			style: { fontSize: 14, color: rgba(tokens.color.text) },
		}));
	});
	return menu;
}

/** The tooltip factory's case: a card-sized tree instead of text (R12.22). */
function buildCardPreview(): Component {
	const card = new Rectangle({
		id: 'overlays_card_preview',
		width: 140,
		height: 190,
		style: {
			backgroundColor: rgba(tokens.color.bg_panel),
			borderColor: rgba(tokens.color.accent),
			borderWidth: 1,
			borderRadius: tokens.radius.r_md,
		},
	});
	card.addChild(new Text({ text: 'Ram', x: 12, y: 10, style: { fontSize: 18, fontWeight: 'bold', color: rgba(tokens.color.text_bright) } }));
	card.addChild(new Rectangle({ x: 12, y: 44, width: 116, height: 80, style: { backgroundColor: rgba(tokens.color.accent_dim) } }));
	card.addChild(new Text({
		text: 'Deal 6 damage to the vehicle ahead.',
		x: 12,
		y: 134,
		width: 116,
		style: { fontSize: 12, color: rgba(tokens.color.text_dim) },
	}));
	return card;
}
