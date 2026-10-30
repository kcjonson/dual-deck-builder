import type { Component } from '../../../engine/components/Component';
import { Icon } from '../../../engine/components/Icon';
import { Polygon } from '../../../engine/components/Polygon';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { IconName } from '../../../engine/text/icons';
import type { VehicleMod } from '../../mechanics/Vehicle';
import { ChromeStack } from './ChromeStack';
import { DRIVER_COLORS, DRIVER_TAB_BACKGROUND, hexRgba, rgba } from './combatStyle';
import type { DriverSeat } from './PlayerHandView';
import { MARK_OUTLINES, seatMark } from '../../ui/targetMarks';

/**
 * What a driver's tab shows
 */
export interface DriverResourceData {
	name: string;
	adrenaline: number;
	maxAdrenaline: number;
	drawPileCount: number;
	discardPileCount: number;
	passenger: boolean;
	/** Alive with no free seat after their wreck: out of this fight, with no hand. */
	crashedOut: boolean;
	/** Their vehicle's mods; none while a passenger, since the mods were on the wreck. */
	mods: readonly VehicleMod[];
}

export const DRIVER_TAB_HEIGHT = 30;
/** The mock's `min(half, 470)`: past this a tab stops growing and holds to its outer edge. */
export const DRIVER_TAB_MAX_WIDTH = 470;
/** A bolt per point up to this many; past it one bolt, and the count carries the rest. */
export const MAX_PIPS = 6;
/** Mod icons up to this many; past it one fewer, then "+N" for the rest. */
export const MAX_MOD_ICONS = 4;
const PIP_WIDTH = 14;
const PIP_HEIGHT = 16;
const MARK_SIZE = 14;
/** An unfilled pip, the driver's colour at this alpha. */
const EMPTY_PIP_ALPHA = 0.22;
const STRIPE_HEIGHT = 3;
const TOP_RADIUS = 3;
const MOD_SIZE = 18;
const MOD_ICON_SIZE = 12;
const PILE_ICON_SIZE = 14;
/** The mock's `.ptag`: a pale red word on dark red. */
const TAG_TEXT = '#ffd0c8';
const TAG_BACKGROUND = hexRgba('#5a1f18', 0.95);
/** The mock's `.mod` ground. */
const MOD_BACKGROUND = hexRgba('#0d0e0f');

/** Each kind of mod's icon; the chip's tooltip names the mod. */
const MOD_GLYPHS: Readonly<Record<VehicleMod['kind'], IconName>> = {
	offense: 'gps_fixed',
	defense: 'shield',
	utility: 'build',
};

/**
 * A driver's tab above their half of the hand (Battle Screen Design,
 * section 4, the mock's `.dtab`): their mark and name, a PASSENGER or
 * CRASHED OUT tag when it applies, up to four mod icons then "+N", bolts for
 * adrenaline with the count, and the draw and discard piles. One row; the
 * name gives way first, with an ellipsis, so nothing else is squeezed.
 * Driver 2's tab is mirrored, name at the outer end, so the two read outward
 * from the middle of the dock.
 */
export class DriverTab extends ChromeStack {
	private readonly seat: DriverSeat;
	private readonly nameLabel: Text;
	private readonly tag: Stack;
	private readonly tagLabel: Text;
	private readonly modRow: Stack;
	private readonly adrenaline: Stack;
	private readonly pipRow: Stack;
	private pips: Icon[] = [];
	private readonly adrenalineValue: Text;
	private readonly pileGroup: Stack;
	private readonly drawCount: Text;
	private readonly discardPile: Stack;
	private readonly discardCount: Text;
	/** The mods the row was last built for, so an unchanged list isn't rebuilt every update. */
	private shownMods: readonly VehicleMod[] | null = null;

	private data: DriverResourceData = {
		name: '',
		adrenaline: 0,
		maxAdrenaline: 0,
		drawPileCount: 0,
		discardPileCount: 0,
		passenger: false,
		crashedOut: false,
		mods: [],
	};

	constructor({ seat, ...options }: StackOptions & { seat: DriverSeat }) {
		const color = DRIVER_COLORS[seat];
		super({
			direction: 'horizontal',
			gap: 10,
			// Centred on the whole tab, stripe included, as the mock's inset stripe is
			padding: { left: 10, right: 10 },
			crossAlign: 'center',
			height: DRIVER_TAB_HEIGHT,
			widthMode: 'fill',
			maxSize: { width: DRIVER_TAB_MAX_WIDTH },
			alignSelf: seat === 1 ? 'start' : 'end',
			chrome: {
				fill: DRIVER_TAB_BACKGROUND,
				edge: { color: rgba('line_edge'), edges: { top: true, left: true, right: true } },
				stripe: { color: hexRgba(color), height: STRIPE_HEIGHT },
				topRadius: TOP_RADIUS,
			},
			...options,
		});
		this.seat = seat;

		const mark = new Polygon({ width: MARK_SIZE, height: MARK_SIZE, style: { backgroundColor: color } });
		mark.points = MARK_OUTLINES[seatMark(seat) as 'driver1' | 'driver2'];

		this.nameLabel = new Text({
			text: '',
			id: `driver${seat}_tab_name`,
			style: {
				fontRole: 'display',
				fontSize: 15,
				letterSpacing: 0.06,
				textTransform: 'uppercase',
				color: rgba('text'),
			},
			wrap: 'none',
			textOverflow: 'ellipsis',
		});

		this.tagLabel = new Text({
			text: '',
			id: `driver${seat}_tab_tag`,
			style: { fontRole: 'mono', fontSize: 11, color: TAG_TEXT },
			wrap: 'none',
		});
		this.tag = new Stack({
			padding: { left: 5, right: 5, top: 3, bottom: 3 },
			style: { backgroundColor: TAG_BACKGROUND, borderRadius: 2 },
			visible: false,
		});
		this.tag.addChild(this.tagLabel);

		// Who it is takes whatever the row leaves, so the counts sit at the far
		// end and the name is what gives way
		const identity = new Stack({
			direction: 'horizontal',
			gap: 10,
			crossAlign: 'center',
			distribution: seat === 1 ? 'start' : 'end',
			widthMode: 'fill',
		});
		const identityParts: Component[] = [this.nameLabel, this.tag];
		for (const part of seat === 1 ? identityParts : identityParts.reverse()) identity.addChild(part);

		this.modRow = new Stack({ id: `driver${seat}_mods`, direction: 'horizontal', gap: 3, crossAlign: 'center', visible: false });

		this.pipRow = new Stack({ direction: 'horizontal', gap: 2, crossAlign: 'center' });
		this.adrenalineValue = new Text({
			text: '',
			id: `driver${seat}_adrenaline_value`,
			style: { fontRole: 'display', fontSize: 15, color },
			wrap: 'none',
		});
		this.adrenaline = new Stack({ direction: 'horizontal', gap: 4, crossAlign: 'center' });
		const adrenalineParts: Component[] = [this.pipRow, this.adrenalineValue];
		for (const part of seat === 1 ? adrenalineParts : adrenalineParts.reverse()) this.adrenaline.addChild(part);

		// Draw and discard, each an icon and its count; pressing either opens the piles
		this.drawCount = pileCount(`driver${seat}_draw_count`);
		this.discardCount = pileCount(`driver${seat}_discard_count`);
		const drawPile = pile('style', this.drawCount);
		this.discardPile = pile('exit_to_app', this.discardCount);
		this.pileGroup = new Stack({
			id: `driver${seat}_piles`,
			direction: 'horizontal',
			gap: 8,
			crossAlign: 'center',
			// The tab's full height, so it's still a 24 px target at the stage's 0.8 floor
			heightMode: 'fill',
			pointerEvents: 'unit',
			tooltip: 'Draw and discard piles',
		});
		this.pileGroup.addChild(drawPile);
		this.pileGroup.addChild(this.discardPile);

		const parts: Component[] = [mark, identity, this.modRow, this.adrenaline, this.pileGroup];
		for (const part of seat === 1 ? parts : parts.reverse()) this.addChild(part);

		this.show();
	}

	/** The discard pile's icon and count: where a discarded card flies to. */
	public get piles(): Component {
		return this.discardPile;
	}

	/** The draw and discard piles, which open the pile dialog when pressed. */
	public get pileButton(): Component {
		return this.pileGroup;
	}

	/** The mod icons in the row, "+N" included. */
	public get modChips(): readonly Component[] {
		return this.modRow.children;
	}

	/**
	 * Update the tab with whatever changed
	 */
	public setData(data: Partial<DriverResourceData>): void {
		Object.assign(this.data, data);
		this.show();
	}

	private show(): void {
		const { name, adrenaline, maxAdrenaline, drawPileCount, discardPileCount, passenger, crashedOut, mods } = this.data;
		this.nameLabel.text = name;
		this.tag.visible = passenger || crashedOut;
		this.tagLabel.text = crashedOut ? 'CRASHED OUT' : 'PASSENGER';
		// Out of the fight there's nothing to spend, and no vehicle to carry mods
		this.adrenaline.visible = !crashedOut;
		this.showMods(passenger || crashedOut ? [] : mods);
		this.showPips(maxAdrenaline, adrenaline);
		this.adrenalineValue.text = `${adrenaline}/${maxAdrenaline}`;
		this.drawCount.text = String(drawPileCount);
		this.discardCount.text = String(discardPileCount);
	}

	/** Up to four mod icons; past four, three and then "+N" for the rest, all named in its tooltip. */
	private showMods(mods: readonly VehicleMod[]): void {
		if (this.shownMods && sameMods(this.shownMods, mods)) return;
		this.shownMods = [...mods];
		for (const chip of [...this.modRow.children]) this.modRow.removeChild(chip);
		const shown = mods.length > MAX_MOD_ICONS ? mods.slice(0, MAX_MOD_ICONS - 1) : mods;
		shown.forEach((mod, index) => this.modRow.addChild(modChip({ id: `driver${this.seat}_mod_${index}`, mod })));
		const hidden = mods.slice(shown.length);
		if (hidden.length > 0) this.modRow.addChild(moreChip({ id: `driver${this.seat}_mod_more`, hidden }));
		this.modRow.visible = mods.length > 0;
	}

	/**
	 * One bolt per point of maximum up to six, the first `filled` in the
	 * driver's colour, counted from the tab's outer end. Past six, one lit
	 * bolt, and the count beside it says the rest.
	 */
	private showPips(max: number, filled: number): void {
		const count = max > MAX_PIPS ? 1 : max;
		while (this.pips.length > count) {
			const pip = this.pips.pop();
			if (pip) this.pipRow.removeChild(pip);
		}
		while (this.pips.length < count) {
			const pip = new Icon({ glyph: 'flash_on', size: PIP_HEIGHT, width: PIP_WIDTH, height: PIP_HEIGHT });
			this.pips.push(pip);
			this.pipRow.addChild(pip);
		}
		this.pipRow.visible = count > 0;
		const lit = max > MAX_PIPS ? count : filled;
		const outward = this.seat === 1 ? this.pips : [...this.pips].reverse();
		outward.forEach((pip, index) => {
			pip.tint = hexRgba(DRIVER_COLORS[this.seat], index < lit ? 1 : EMPTY_PIP_ALPHA);
		});
	}
}

function sameMods(a: readonly VehicleMod[], b: readonly VehicleMod[]): boolean {
	return a.length === b.length && a.every((mod, index) => mod.name === b[index].name && mod.kind === b[index].kind);
}

function pileCount(id: string): Text {
	return new Text({ text: '', id, style: { fontRole: 'mono', fontSize: 12, color: rgba('text_dim') }, wrap: 'none' });
}

/** The mock's `.pile`: a 14 px icon and its count. */
function pile(glyph: IconName, count: Text): Stack {
	const group = new Stack({ direction: 'horizontal', gap: 3, crossAlign: 'center' });
	group.addChild(new Icon({ glyph, size: PILE_ICON_SIZE, tint: rgba('text_dim') }));
	group.addChild(count);
	return group;
}

/** The mock's `.mod`: an 18 px dark square with a 12 px icon, named on hover. */
function modChip({ id, mod }: { id: string; mod: VehicleMod }): Stack {
	const chip = chipBox({ id, width: MOD_SIZE, tooltip: mod.name });
	chip.addChild(new Icon({ glyph: MOD_GLYPHS[mod.kind], size: MOD_ICON_SIZE, tint: rgba('text_dim') }));
	return chip;
}

/** The mock's `.mod.more`: "+N", with the mods it stands for in its tooltip. */
function moreChip({ id, hidden }: { id: string; hidden: readonly VehicleMod[] }): Stack {
	const chip = chipBox({ id, tooltip: { title: `${hidden.length} more`, description: hidden.map((mod) => mod.name).join(', ') } });
	chip.padding = { left: 3, right: 3 };
	chip.addChild(new Text({ text: `+${hidden.length}`, style: { fontRole: 'mono', fontSize: 11, color: rgba('text_dim') }, wrap: 'none' }));
	return chip;
}

function chipBox({ id, width, tooltip }: { id: string; width?: number; tooltip: string | { title: string; description: string } }): Stack {
	return new Stack({
		id,
		direction: 'horizontal',
		distribution: 'center',
		crossAlign: 'center',
		width,
		height: MOD_SIZE,
		style: { backgroundColor: MOD_BACKGROUND, borderColor: rgba('line_edge'), borderWidth: 1, borderRadius: 2 },
		pointerEvents: 'unit',
		tooltip,
	});
}
