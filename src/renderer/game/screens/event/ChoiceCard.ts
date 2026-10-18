import type { ClickCallback, ComponentOptions, ResolvedColors } from '../../../engine/components/Component';
import type { SizeMode } from '../../../engine/components/layoutTypes';
import { Text } from '../../../engine/components/Text';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import { Look, LookLayers, resolveLook } from '../../../engine/style/look';
import { LookTransition } from '../../../engine/style/LookTransition';
import type { Theme } from '../../../engine/theme/tokens';
import { Pressable } from '../../../engine/ui/Pressable';
import { ChoiceLock, EventChoice, choicePreview } from '../../campaign/Events';
import { ATLAS, AtlasInks, atlasInks } from '../../ui/atlas/atlasStyle';
import { dashedOutlineTriangles } from '../../ui/stripes';
import { EVENT_ICON_SIZE, EventIconKind, EventIconTone, drawEventIcon, rewardIcon, toneInk } from './EventIcon';
import { hoursText, lockText, needText } from './eventText';

export interface ChoiceCardOptions extends Omit<ComponentOptions, 'style' | 'height'> {
	choice: EventChoice;
	/** Why the party can't take it, or null when it can. */
	lock: ChoiceLock | null;
	/** The number key that takes it, at the band's right; none when left out. */
	hotkey?: string;
	onClick?: ClickCallback;
}

/** A choice card's height, fixed so a row of them lines up whatever they hold. */
export const CHOICE_CARD_HEIGHT = 200;
/** The card stock's corners (UI Art Direction, Card hints). */
const CORNER = 7;
const PAD = 12;
const BAND = 24;
const TAG_SIZE = 11;
/** The hotkey's column at the band's right. */
const KEY_WIDTH = 14;
const TITLE_SIZE = 20;
const TITLE_LINE = 1.1;
const TITLE_LINES = 2;
const PREVIEW_SIZE = 13;
const PREVIEW_LINE = 1.4;
const PREVIEW_LINES = 3;
const VALUE_SIZE = 12;
const ICON_GAP = 3;
const ITEM_GAP = 8;
const ROW_GAP = 6;
const CLEAR: RGBA = [0, 0, 0, 0];

interface IconItem {
	kind: EventIconKind;
	tone: EventIconTone;
	value: Text | null;
	rect: Rect;
}

function cardLayers(inks: AtlasInks): LookLayers {
	const normal = { fill: inks.freshPaper, border: inks.backRoad, borderWidth: ATLAS.backRoadBorder, radius: CORNER, text: inks.ink, shadow: null };
	return {
		normal,
		selected: { ...normal, fill: inks.highlighterTone, border: inks.ink },
		hover: { border: inks.ink, offsetY: -ATLAS.hoverLift },
		pressed: { wash: inks.hover, border: inks.ink, offsetY: ATLAS.hoverLift },
		active: {},
		disabled: { fill: inks.paper, border: inks.fadedPrint, text: inks.fadedPrint },
		focusRing: inks.focusRing,
	};
}

/**
 * One choice at an event stop (Game Flow 5.2 and 7.0): a card, not a list
 * row. Atlas card stock with 7 px corners: an index band at the top for what
 * the choice needs, or in stronghold red why it's locked; the action in
 * display 700; a hint at what happens; and two rows of icons at the foot,
 * the risk (crossed swords for a fight, skulls for danger, costs in red,
 * hours) and what it can give, in sage.
 *
 * It's pressed like a button and taken when pressed, so a locked card is
 * disabled: faded print with a dashed border, still readable, its title
 * struck through when it's the stores that lock it. Its height is fixed, so
 * a row of cards lines up.
 */
export class ChoiceCard extends Pressable {
	public readonly choice: EventChoice;
	public readonly lock: ChoiceLock | null;
	private readonly tag: Text;
	private readonly key: Text | null;
	private readonly title: Text;
	private readonly preview: Text;
	private readonly risks: IconItem[];
	private readonly gains: IconItem[];
	private inks: AtlasInks;
	private palette: Theme;
	private layers: LookLayers;
	private readonly transition: LookTransition;
	private readonly face: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly band: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly rule: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly ring: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly dashes: Vec2[] = [];

	constructor({ choice, lock, hotkey, onClick, ...options }: ChoiceCardOptions) {
		super({ focusable: true, ...options, height: CHOICE_CARD_HEIGHT, ...(lock ? { enabled: false } : {}) });
		this.componentType = 'ChoiceCard';
		this.choice = choice;
		this.lock = lock;
		this.palette = this.themeTokens;
		this.inks = atlasInks(this.palette);
		this.layers = cardLayers(this.inks);
		if (onClick) this.onClick = onClick;

		const id = options.id ?? 'choice';
		this.tag = new Text({
			id: `${id}_need`,
			text: lock ? lockText(lock) : needText(choice.requires),
			style: { fontRole: 'mono', fontSize: TAG_SIZE, letterSpacing: ATLAS.captionTracking, textTransform: 'uppercase', color: lock ? 'status_crit' : 'text_dim' },
			wrap: 'none',
			textOverflow: 'ellipsis',
			verticalAlign: 'middle',
		});
		this.addPart(this.tag);
		this.key = hotkey === undefined ? null : new Text({
			id: `${id}_key`,
			text: hotkey,
			style: { fontRole: 'mono', fontSize: TAG_SIZE, color: 'text_dim', textAlign: 'right' },
			wrap: 'none',
			verticalAlign: 'middle',
		});
		if (this.key) this.addPart(this.key);
		this.title = new Text({
			id: `${id}_title`,
			text: choice.title,
			style: { fontRole: 'display', fontWeight: 700, fontSize: TITLE_SIZE, ...(lock?.reason === 'cost' ? { textDecoration: 'strike' as const } : {}) },
			lineHeight: TITLE_LINE,
			textOverflow: 'ellipsis',
		});
		this.addPart(this.title);
		this.preview = new Text({ id: `${id}_preview`, text: choice.preview, style: { fontSize: PREVIEW_SIZE }, lineHeight: PREVIEW_LINE, textOverflow: 'ellipsis' });
		this.addPart(this.preview);

		const shown = choicePreview(choice);
		const item = (kind: EventIconKind, tone: EventIconTone, value: string | null, part: string): IconItem => {
			const label = value === null ? null : new Text({ id: `${id}_${part}`, text: value, style: { fontRole: 'mono', fontSize: VALUE_SIZE }, wrap: 'none' });
			if (label) this.addPart(label);
			return { kind, tone, value: label, rect: { x: 0, y: 0, width: EVENT_ICON_SIZE, height: EVENT_ICON_SIZE } };
		};
		this.risks = [
			...(shown.combat ? [item('swords', 'cost', null, 'combat')] : []),
			...Array.from({ length: shown.danger }, (_unused, index) => item('skull', 'cost', null, `skull_${index}`)),
			...shown.costs.map(({ resource, amount }) => item(resource, 'cost', `-${amount}`, `cost_${resource}`)),
			...(shown.hours > 0 ? [item('clock', 'ink', hoursText(shown.hours), 'hours')] : []),
		];
		this.gains = shown.rewards.map((reward) => item(rewardIcon(reward), 'gain', null, `gain_${reward}`));

		this.transition = new LookTransition({ owner: this, look: this.targetLook, onChange: (look) => this.followLook(look) });
		this.followLook(this.transition.look);
	}

	/** Icons on the card, risks then gains, for tests: kind and tone. */
	public get icons(): { risks: readonly string[]; gains: readonly string[] } {
		const name = ({ kind, tone }: IconItem) => `${kind}:${tone}`;
		return { risks: this.risks.map(name), gains: this.gains.map(name) };
	}

	public get needText(): string {
		return this.tag.text;
	}

	public get titleText(): string {
		return this.title.text;
	}

	/** A card spans its share of the row unless it is given a width. */
	protected defaultSizeMode(size: number | undefined): SizeMode {
		return size !== undefined && size > 0 ? 'fixed' : 'fill';
	}

	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	public get inkExtent(): number {
		return ATLAS.focusRingGap + ATLAS.focusRingWidth + ATLAS.hoverLift;
	}

	public get look(): Look {
		return this.transition.look;
	}

	public get resolvedColors(): ResolvedColors {
		const look = this.transition.look;
		return { fill: look.fill, text: look.text };
	}

	protected layoutChildren(): void {
		this.placeParts();
	}

	protected onMount(): void {
		this.transition.moveTo(this.targetLook, null);
	}

	protected onThemeChange(theme: Theme): void {
		this.palette = theme;
		this.inks = atlasInks(theme);
		this.layers = cardLayers(this.inks);
		this.transition.moveTo(this.targetLook, null);
		this.followLook(this.transition.look);
	}

	protected onUnmount(): void {
		super.onUnmount();
		this.transition.moveTo(this.targetLook, null);
	}

	protected onStateChange(): void {
		super.onStateChange();
		if (this.transition) this.transition.moveTo(this.targetLook, this.context?.animator ?? null);
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		const enabled = this.effectivelyEnabled;
		const inks = this.inks;
		const moved = look.offsetY !== 0;
		if (moved) draw.pushTranslate(0, look.offsetY);
		draw.drawRect({ id: this.id ?? undefined, rect: this.face, fill: look.fill, radius: CORNER });
		draw.drawRect({ rect: this.band, fill: inks.index, radius: [CORNER, CORNER, 0, 0] });
		draw.drawRect({ rect: this.rule, fill: inks.hairline });
		if (enabled) draw.drawRect({ rect: this.face, fill: CLEAR, radius: CORNER, border: { color: look.border, width: look.borderWidth, position: 'inside' } });
		else draw.drawPolygon({ points: this.dashes, fill: look.border });
		const faded = enabled ? null : inks.fadedPrint;
		for (const icon of [...this.risks, ...this.gains]) drawEventIcon(draw, { kind: icon.kind, rect: icon.rect, tint: faded ?? toneInk(this.palette, icon.tone) });
		if (look.focusRing) draw.drawRect({ rect: this.ring, fill: CLEAR, radius: CORNER + ATLAS.focusRingGap, border: { color: look.focusRing, width: ATLAS.focusRingWidth, position: 'outside' } });
		if (moved) draw.popTransform();
	}

	private get targetLook(): Look {
		return resolveLook(this.layers, this.stateFlags);
	}

	private followLook(look: Look): void {
		const text: RGBA = [...look.text] as RGBA;
		this.title.color = text;
		this.preview.color = this.effectivelyEnabled ? 'text_dim' : text;
		for (const { value, tone } of [...this.risks, ...this.gains]) if (value) value.color = this.effectivelyEnabled ? toneInk(this.palette, tone) : text;
	}

	/** The band, title, preview, and the two icon rows pinned to the foot. */
	private placeParts(): void {
		const { width, height } = this;
		const inner = Math.max(0, width - PAD * 2);
		setRect(this.face, 0, 0, width, height);
		setRect(this.band, 0, 0, width, BAND);
		const gap = ATLAS.focusRingGap;
		setRect(this.ring, -gap, -gap, width + gap * 2, height + gap * 2);
		dashedOutlineTriangles(this.face, { width: ATLAS.backRoadBorder, dash: ATLAS.dash, gap: ATLAS.dashGap, corner: CORNER }, this.dashes);

		const keySpace = this.key ? KEY_WIDTH + ICON_GAP : 0;
		this.tag.setPosition(PAD, 0);
		this.tag.setSize(Math.max(0, inner - keySpace), BAND);
		if (this.key) {
			this.key.setPosition(width - PAD - KEY_WIDTH, 0);
			this.key.setSize(KEY_WIDTH, BAND);
		}
		let y = BAND + 8;
		const titleHeight = Math.ceil(TITLE_SIZE * TITLE_LINE * TITLE_LINES);
		this.title.setPosition(PAD, y);
		this.title.setSize(inner, titleHeight);
		y += titleHeight + 4;
		const previewHeight = Math.ceil(PREVIEW_SIZE * PREVIEW_LINE * PREVIEW_LINES);
		this.preview.setPosition(PAD, y);
		this.preview.setSize(inner, previewHeight);

		const gainsY = height - PAD - EVENT_ICON_SIZE;
		const risksY = gainsY - ROW_GAP - EVENT_ICON_SIZE;
		setRect(this.rule, PAD, risksY - ROW_GAP - 1, inner, 1);
		placeRow(this.risks, PAD, risksY);
		placeRow(this.gains, PAD, gainsY);
	}
}

/** Icons left to right from `x`, each with its value after it. */
function placeRow(items: readonly IconItem[], x: number, y: number): void {
	let at = x;
	for (const item of items) {
		setRect(item.rect, at, y, EVENT_ICON_SIZE, EVENT_ICON_SIZE);
		at += EVENT_ICON_SIZE;
		if (item.value) {
			at += ICON_GAP;
			item.value.setPosition(at, y + (EVENT_ICON_SIZE - VALUE_SIZE * 1.3) / 2);
			at += item.value.width;
		}
		at += item.value ? ITEM_GAP : ICON_GAP;
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
