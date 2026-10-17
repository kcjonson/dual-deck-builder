import type { Component } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect } from '../../../engine/draw/geometry';
import type { AnyUiEvent, UiActionEvent, UiKeyEvent, UiPointerEvent } from '../../../engine/input/events';
import type { LookLayers } from '../../../engine/style/look';
import { tokens } from '../../../engine/theme/tokens';
import type { Theme } from '../../../engine/theme/tokens';
import { LabelledPressable } from '../../../engine/ui/LabelledPressable';
import { ATLAS, AtlasInks, DISPLAY_BOLD, atlasInks } from './atlasStyle';
import { DeckGlyphGeometry, DECK_GLYPH } from './deck';

export interface SectionTabSpec {
	id: string;
	label: string;
	/** The deck glyph before the label, for anything about decks (the Crew tab). */
	deck?: boolean;
	disabled?: boolean;
}

export type SectionSelectCallback = (id: string, event: UiPointerEvent | UiActionEvent | UiKeyEvent) => void;

export interface SectionTabsOptions extends Omit<StackOptions, 'style' | 'direction' | 'gap'> {
	tabs: readonly SectionTabSpec[];
	/** Controlled when given, as a TabBar's is (R12.16). Absent, the first enabled tab. */
	selectedId?: string | null;
	onSelect?: SectionSelectCallback | null;
	disabled?: boolean;
}

/** A tab's line of display type, and the tab hanging round it. */
const LINE = 18;
const TAB_HEIGHT = ATLAS.tabPadTop + LINE + ATLAS.tabPadBottom;
const CLEAR: RGBA = [0, 0, 0, 0];

/**
 * The tab's look by state (R11.12): index paper with an ink-dim label at
 * rest, fresh paper and ink when it is the open section, a hover wash with
 * the label to ink, and faded print when disabled.
 */
function sectionTabLayers(inks: AtlasInks): LookLayers {
	const normal = { fill: inks.index, border: inks.ink, borderWidth: ATLAS.legendBorder, radius: 0, text: inks.inkDim, shadow: null };
	return {
		normal,
		selected: { ...normal, fill: inks.freshPaper, text: inks.ink },
		hover: { wash: inks.hover, text: inks.ink },
		pressed: { wash: inks.hover },
		active: {},
		disabled: { text: inks.fadedPrint },
		focusRing: inks.focusRing,
	};
}

/**
 * One thumb-index tab: display 700 at 15 px, 0.14 em, hanging from the top
 * with an ink border on three sides. The open section's tab is fresh paper
 * and 4 px taller (UI Art Direction, Components).
 */
export class SectionTab extends LabelledPressable {
	public readonly tabId: string;
	private readonly deck: DeckGlyphGeometry | null;
	private inks: AtlasInks;
	private readonly sides: [Rect, Rect, Rect] = [
		{ x: 0, y: 0, width: 0, height: 0 },
		{ x: 0, y: 0, width: 0, height: 0 },
		{ x: 0, y: 0, width: 0, height: 0 },
	];
	private readonly box: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly labelBox: Rect = { x: 0, y: 0, width: 0, height: 0 };
	private readonly ring: Rect = { x: 0, y: 0, width: 0, height: 0 };

	constructor({ tabId, label, deck = false, disabled = false }: { tabId: string; label: string; deck?: boolean; disabled?: boolean }) {
		super({
			label,
			face: { font: DISPLAY_BOLD, size: ATLAS.tabSize, letterSpacing: ATLAS.tabTracking, textTransform: 'uppercase' },
			layers: sectionTabLayers(atlasInks(tokens)),
			inset: ATLAS.tabPadX,
			height: TAB_HEIGHT,
			...(disabled ? { enabled: false } : {}),
		});
		this.componentType = 'SectionTab';
		this.tabId = tabId;
		this.inks = atlasInks(this.themeTokens);
		this.layers = sectionTabLayers(this.inks);
		this.deck = deck ? new DeckGlyphGeometry() : null;
	}

	/** The ring is drawn inside: the tab's top is the screen's edge. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	public get hugWidth(): number {
		const label = super.hugWidth;
		return label > 0 && this.deck ? label + DECK_GLYPH.width + ATLAS.tabGap : label;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
		this.layers = sectionTabLayers(this.inks);
		this.transition.moveTo(this.targetLook, null);
	}

	protected onStateChange(): void {
		super.onStateChange();
		const height = this.selected ? TAB_HEIGHT + ATLAS.tabRaise : TAB_HEIGHT;
		if (this.height !== height) this.height = height;
	}

	protected layoutChildren(): void {
		super.layoutChildren();
		this.placeGeometry();
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		const border = this.enabled ? look.border : this.inks.fadedPrint;
		draw.drawRect({ id: this.id ?? undefined, rect: this.box, fill: look.fill });
		for (const side of this.sides) draw.drawRect({ rect: side, fill: border });
		if (this.deck) this.deck.draw(draw, this.inks, !this.effectivelyEnabled);
		this.drawLabel(draw, this.labelBox);
		if (look.focusRing) draw.drawRect({ rect: this.ring, fill: CLEAR, border: { color: look.focusRing, width: ATLAS.focusRingWidth, position: 'inside' } });
	}

	private placeGeometry(): void {
		const { width, height } = this;
		const edge = ATLAS.legendBorder;
		setRect(this.box, 0, 0, width, height);
		setRect(this.sides[0], 0, 0, edge, height);
		setRect(this.sides[1], width - edge, 0, edge, height);
		setRect(this.sides[2], 0, height - edge, width, edge);
		setRect(this.labelBox, 0, ATLAS.tabPadTop, width, LINE);
		const labelWidth = super.hugWidth - ATLAS.tabPadX * 2;
		if (this.deck && labelWidth > 0) {
			const glyph = DECK_GLYPH.width + ATLAS.tabGap;
			const left = (width - labelWidth - glyph) / 2;
			this.deck.place(left, ATLAS.tabPadTop + (LINE - DECK_GLYPH.height) / 2);
			setRect(this.labelBox, left + glyph, ATLAS.tabPadTop, labelWidth, LINE);
		}
		const inset = edge + 1;
		setRect(this.ring, inset, inset, width - inset * 2, height - inset * 2);
	}
}

/** Arrows that move to the previous or next tab. */
const STEP: Readonly<Record<string, -1 | 1>> = { ArrowLeft: -1, ArrowRight: 1 };

/**
 * The thumb-index tabs between the meta screens, hung from the sheet's top
 * edge; they replace "Back" between siblings. One Tab stop entered at the
 * open section (R9.29): Left and Right move focus and selection together,
 * wrapping, Home and End go to the ends, and a release or `activate`
 * selects, as R12.16's tab bar does. `onSelect` fires on user changes only.
 */
export class SectionTabs extends Stack {
	public onSelect: SectionSelectCallback | null;
	private readonly items: SectionTab[] = [];
	private readonly controlled: boolean;
	private selection: string | null = null;

	constructor({ tabs, selectedId, onSelect = null, disabled = false, ...options }: SectionTabsOptions) {
		super({
			...(disabled ? { enabled: false } : {}),
			...options,
			direction: 'horizontal',
			gap: ATLAS.tabGap,
			crossAlign: 'start',
			focusGroup: { orientation: 'horizontal', wrap: true },
		});
		this.componentType = 'SectionTabs';
		this.onSelect = onSelect;
		for (const tab of tabs) {
			const item = new SectionTab({ tabId: tab.id, label: tab.label, deck: tab.deck, disabled: tab.disabled });
			this.items.push(item);
			this.addChild(item);
		}
		this.controlled = selectedId !== undefined;
		this.selectedId = selectedId === undefined ? this.items.find((tab) => tab.enabled)?.tabId ?? null : selectedId;
	}

	public get tabs(): readonly SectionTab[] {
		return this.items;
	}

	public get selectedId(): string | null {
		return this.selection;
	}

	/** Programmatic: never fires `onSelect`. An unknown or disabled id shows no selection. */
	public set selectedId(id: string | null) {
		const match = this.items.find((tab) => tab.tabId === id && tab.enabled) ?? null;
		this.selection = match ? match.tabId : null;
		for (const tab of this.items) tab.selected = tab === match;
		if (match) this.activeChild = match;
	}

	public get isControlled(): boolean {
		return this.controlled;
	}

	public memberPressed(member: Component, event: UiPointerEvent | UiActionEvent): void {
		if (!(member instanceof SectionTab) || !this.items.includes(member)) return;
		this.choose(member, event);
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.type !== 'keydown' || event.consumed) return;
		const { ctrl, meta, alt, shift } = event.modifiers;
		if (ctrl || meta || alt || shift) return;
		const current = this.items.find((tab) => tab.focused);
		if (!current) return;
		const enabled = this.items.filter((tab) => tab === current || tab.canReceiveFocus());
		let target: SectionTab | undefined;
		if (event.key === 'Home') target = enabled[0];
		else if (event.key === 'End') target = enabled[enabled.length - 1];
		else if (STEP[event.key] !== undefined) target = enabled[(enabled.indexOf(current) + STEP[event.key] + enabled.length) % enabled.length];
		if (!target) return;
		event.consume();
		if (target === current) return;
		this.context?.focus.focus(target, 'keyboard');
		this.choose(target, event);
	}

	private choose(tab: SectionTab, event: UiPointerEvent | UiActionEvent | UiKeyEvent): void {
		if (tab.tabId === this.selection || !tab.effectivelyEnabled) return;
		this.selectedId = tab.tabId;
		this.onSelect?.(tab.tabId, event);
	}
}

function setRect(rect: Rect, x: number, y: number, width: number, height: number): void {
	rect.x = x;
	rect.y = y;
	rect.width = Math.max(0, width);
	rect.height = Math.max(0, height);
}
