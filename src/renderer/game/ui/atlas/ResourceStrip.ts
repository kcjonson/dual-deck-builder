import { Component, ComponentOptions } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { RGBA, Rect, Vec2 } from '../../../engine/draw/geometry';
import type { Theme } from '../../../engine/theme/tokens';
import { FlowWrap } from '../FlowWrap';
import { UiArtName, drawAtlasArt } from './atlasArt';
import { AtlasInks, atlasInks } from './atlasStyle';

/** The compound's stores, each with its stroke icon in the UI art atlas. */
export type ResourceKind = 'food' | 'water' | 'fuel' | 'scrap' | 'meds' | 'people';

const ICON_SIZE = 18;
const ICON_STROKE = 1.6;

interface IconStrokes {
	lines: ReadonlyArray<{ points: readonly Vec2[]; closed?: boolean }>;
	circles: ReadonlyArray<{ x: number; y: number; r: number }>;
}

const p = (x: number, y: number): Vec2 => ({ x, y });

/** The canvas's stroke icons on an 18 px grid, drawn flat until the art atlas's own draw them. */
const STROKES: Readonly<Record<ResourceKind, IconStrokes>> = {
	food: { lines: [{ points: [p(3, 4), p(15, 4), p(15, 15), p(3, 15)], closed: true }, { points: [p(3, 7), p(15, 7)] }], circles: [] },
	water: { lines: [{ points: [p(9, 2), p(12, 6.5), p(14, 10), p(13.3, 14), p(9, 17), p(4.7, 14), p(4, 10), p(6, 6.5)], closed: true }], circles: [] },
	fuel: { lines: [{ points: [p(4, 5), p(12, 5), p(14, 7), p(14, 16), p(4, 16)], closed: true }, { points: [p(7, 5), p(7, 2), p(11, 2), p(11, 5)] }], circles: [] },
	scrap: {
		lines: [
			{ points: [p(9, 1), p(9, 4)] }, { points: [p(9, 14), p(9, 17)] }, { points: [p(1, 9), p(4, 9)] }, { points: [p(14, 9), p(17, 9)] },
			{ points: [p(3.3, 3.3), p(5.4, 5.4)] }, { points: [p(12.6, 12.6), p(14.7, 14.7)] }, { points: [p(3.3, 14.7), p(5.4, 12.6)] }, { points: [p(12.6, 5.4), p(14.7, 3.3)] },
		],
		circles: [{ x: 9, y: 9, r: 4 }],
	},
	meds: { lines: [{ points: [p(7, 2), p(11, 2), p(11, 7), p(16, 7), p(16, 11), p(11, 11), p(11, 16), p(7, 16), p(7, 11), p(2, 11), p(2, 7), p(7, 7)], closed: true }], circles: [] },
	people: { lines: [{ points: [p(3, 16), p(4.5, 13), p(9, 11.8), p(13.5, 13), p(15, 16)] }], circles: [{ x: 9, y: 5, r: 3 }] },
};

const ICON_PIECES: Readonly<Record<ResourceKind, UiArtName>> = {
	food: 'icon_food',
	water: 'icon_water',
	fuel: 'icon_fuel',
	scrap: 'icon_scrap',
	meds: 'icon_meds',
	people: 'icon_people',
};

const CLEAR: RGBA = [0, 0, 0, 0];

/** One store's 18 px stroke icon, in ink or, short, in stronghold red. */
export class ResourceIcon extends Component {
	public readonly kind: ResourceKind;
	private inks: AtlasInks;
	private isShort: boolean;
	private readonly rect: Rect = { x: 0, y: 0, width: ICON_SIZE, height: ICON_SIZE };

	constructor({ kind, shortfall = false, ...options }: Omit<ComponentOptions, 'width' | 'height'> & { kind: ResourceKind; shortfall?: boolean }) {
		super({ ...options, width: ICON_SIZE, height: ICON_SIZE });
		this.componentType = 'ResourceIcon';
		this.kind = kind;
		this.isShort = shortfall;
		this.inks = atlasInks(this.themeTokens);
	}

	public get shortfall(): boolean {
		return this.isShort;
	}

	public set shortfall(shortfall: boolean) {
		this.isShort = shortfall;
	}

	public get tint(): RGBA {
		return this.isShort ? this.inks.stronghold : this.inks.ink;
	}

	public get inkExtent(): number {
		return 1;
	}

	protected onThemeChange(theme: Theme): void {
		this.inks = atlasInks(theme);
	}

	public render(draw: DrawApi): void {
		const tint = this.tint;
		if (drawAtlasArt(draw, { name: ICON_PIECES[this.kind], rect: this.rect, tint })) return;
		const strokes = STROKES[this.kind];
		for (const line of strokes.lines) draw.drawPolyline({ points: line.points, closed: line.closed, color: tint, width: ICON_STROKE, cap: 'round' });
		for (const circle of strokes.circles) draw.drawCircle({ center: circle, radius: circle.r, fill: CLEAR, border: { color: tint, width: ICON_STROKE, position: 'center' } });
	}
}

export interface ResourceSpec {
	kind: ResourceKind;
	/** The name in mono capitals. Default the kind's own. */
	name?: string;
	value: number;
	/** Not enough of it: the item turns stronghold red. */
	shortfall?: boolean;
}

const MONO_SIZE = 14;

/** Counts read as a ledger's, two digits at least. */
export function ledger(value: number): string {
	return String(Math.round(value)).padStart(2, '0');
}

/** How a strip prints a value; `ledger` by default. */
export type ResourceFormat = (value: number) => string;

/** One store in the strip: icon, mono name, mono 500 value. With an id, the value is `<id>_value`. */
export class ResourceItem extends Stack {
	public readonly kind: ResourceKind;
	private readonly icon: ResourceIcon;
	private readonly nameText: Text;
	private readonly valueText: Text;
	private readonly format: ResourceFormat;
	private amount: number;
	private isShort: boolean;

	constructor({ kind, name, value, shortfall = false, id, format = ledger }: ResourceSpec & { id?: string; format?: ResourceFormat }) {
		super({ ...(id !== undefined ? { id } : {}), direction: 'horizontal', gap: 7, crossAlign: 'center' });
		this.componentType = 'ResourceItem';
		this.kind = kind;
		this.amount = value;
		this.isShort = shortfall;
		this.format = format;
		this.icon = new ResourceIcon({ kind, shortfall });
		const color = shortfall ? 'status_crit' : 'text';
		this.nameText = new Text({ text: name ?? kind, style: { fontRole: 'mono', fontSize: MONO_SIZE, textTransform: 'uppercase', color }, wrap: 'none' });
		this.valueText = new Text({
			text: format(value),
			...(id !== undefined ? { id: `${id}_value` } : {}),
			style: { fontRole: 'mono', fontWeight: 500, fontSize: MONO_SIZE, color },
			wrap: 'none',
		});
		this.addChild(this.icon);
		this.addChild(this.nameText);
		this.addChild(this.valueText);
	}

	public get value(): number {
		return this.amount;
	}

	public set value(value: number) {
		this.amount = value;
		this.valueText.text = this.format(value);
	}

	public get shortfall(): boolean {
		return this.isShort;
	}

	public set shortfall(shortfall: boolean) {
		this.isShort = shortfall;
		this.icon.shortfall = shortfall;
		const color = shortfall ? 'status_crit' : 'text';
		this.nameText.color = color;
		this.valueText.color = color;
	}

	/** The colour the item reads in now. */
	public get ink(): RGBA {
		return this.valueText.color;
	}
}

export interface ResourceStripOptions extends Omit<StackOptions, 'style' | 'direction'> {
	items: readonly ResourceSpec[];
	/** The body line under the strip naming a shortfall ("Water and food run out in 2 days"). */
	note?: string;
	/** How values print; two digits at least by default. */
	format?: ResourceFormat;
}

/**
 * The stores, read like a map's legend key (UI Art Direction, Components):
 * an 18 px stroke icon, the name in mono capitals, the value in mono 500,
 * wrapping onto a second line when the width runs out. A shortfall turns its
 * item stronghold red, and `note` names it in a body line under the strip.
 * With an id, each item is `<id>_<kind>`.
 */
export class ResourceStrip extends Stack {
	private readonly row: FlowWrap;
	private readonly itemsByKind = new Map<ResourceKind, ResourceItem>();
	private readonly noteText: Text;

	constructor({ items, note, format, ...options }: ResourceStripOptions) {
		super({ ...options, direction: 'vertical', gap: 6 });
		this.componentType = 'ResourceStrip';
		this.row = new FlowWrap({ gap: 22, rowGap: 6, widthMode: 'fill' });
		for (const spec of items) {
			const item = new ResourceItem({ ...spec, id: options.id ? `${options.id}_${spec.kind}` : undefined, format });
			this.itemsByKind.set(spec.kind, item);
			this.row.addChild(item);
		}
		this.addChild(this.row);
		this.noteText = new Text({ text: note ?? '', visible: note !== undefined, widthMode: 'fill', wrap: 'word', style: { fontSize: MONO_SIZE, color: 'status_crit' } });
		this.addChild(this.noteText);
	}

	public item(kind: ResourceKind): ResourceItem | null {
		return this.itemsByKind.get(kind) ?? null;
	}

	public get items(): readonly ResourceItem[] {
		return [...this.itemsByKind.values()];
	}

	public get note(): string | null {
		return this.noteText.visible ? this.noteText.text : null;
	}

	public set note(note: string | null) {
		this.noteText.text = note ?? '';
		this.noteText.visible = note !== null;
	}
}
