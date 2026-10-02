import type { Component } from '../../../engine/components/Component';
import { Container } from '../../../engine/components/Container';
import { Polygon } from '../../../engine/components/Polygon';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { ChromeStack } from './ChromeStack';
import { DRIVER_COLORS, DRIVER_MARK_OUTLINES, DRIVER_TAB_BACKGROUND, hexRgba, rgba } from './combatStyle';
import type { DriverSeat } from './PlayerHandView';

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
}

export const DRIVER_TAB_HEIGHT = 30;
/** The mock's `min(half, 470)`: past this a tab stops growing and holds to its outer edge. */
export const DRIVER_TAB_MAX_WIDTH = 470;
/** Pips up to this many; the count beside them carries the rest. */
const MAX_PIPS = 6;
const PIP_WIDTH = 7;
const PIP_HEIGHT = 14;
const MARK_SIZE = 14;
/** An unfilled pip, the driver's colour at this alpha. */
const EMPTY_PIP_ALPHA = 0.22;
const STRIPE_HEIGHT = 3;
const TOP_RADIUS = 3;

/**
 * A driver's tab above their half of the hand (Battle Screen Design,
 * section 4, the mock's `.dtab`): their mark and name, a PASSENGER tag when
 * it applies, then adrenaline pips with the count, and draw and discard pile
 * counts. One row; the name gives way first, with an ellipsis, so the counts
 * are never squeezed. Driver 2's tab is mirrored, name at the outer end, so
 * the two read outward from the middle of the dock.
 */
export class DriverTab extends ChromeStack {
	private readonly seat: DriverSeat;
	private readonly nameLabel: Text;
	private readonly passengerTag: Text;
	private readonly pipRow: Stack;
	private pips: Rectangle[] = [];
	private readonly adrenalineValue: Text;
	private readonly pilesLabel: Text;

	private data: DriverResourceData = {
		name: '',
		adrenaline: 0,
		maxAdrenaline: 0,
		drawPileCount: 0,
		discardPileCount: 0,
		passenger: false,
	};

	constructor({ seat, ...options }: StackOptions & { seat: DriverSeat }) {
		const color = DRIVER_COLORS[seat];
		super({
			direction: 'horizontal',
			gap: 10,
			padding: { left: 10, right: 10, top: STRIPE_HEIGHT },
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
		mark.points = DRIVER_MARK_OUTLINES[seat];

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

		this.passengerTag = new Text({
			text: 'PASSENGER',
			visible: false,
			style: { fontRole: 'mono', fontSize: 11, color: rgba('text_dim') },
			wrap: 'none',
		});

		// Takes whatever the row leaves, so the counts sit at the far end
		const spacer = new Container({ widthMode: 'fill', heightMode: 'fill' });

		this.pipRow = new Stack({ direction: 'horizontal', gap: 2, crossAlign: 'center' });
		this.adrenalineValue = new Text({
			text: '',
			id: `driver${seat}_adrenaline_value`,
			style: { fontRole: 'display', fontSize: 15, color },
			wrap: 'none',
		});
		const adrenaline = new Stack({ direction: 'horizontal', gap: 4, crossAlign: 'center' });
		const adrenalineParts: Component[] = [this.pipRow, this.adrenalineValue];
		for (const part of seat === 1 ? adrenalineParts : adrenalineParts.reverse()) adrenaline.addChild(part);

		this.pilesLabel = new Text({
			text: '',
			id: `driver${seat}_piles`,
			style: { fontRole: 'mono', fontSize: 12, color: rgba('text_dim') },
			wrap: 'none',
		});

		const parts: Component[] = [mark, this.nameLabel, this.passengerTag, spacer, adrenaline, this.pilesLabel];
		for (const part of seat === 1 ? parts : parts.reverse()) this.addChild(part);

		this.show();
	}

	/** "DRAW n   DISCARD n": where a discarded card flies to. */
	public get piles(): Text {
		return this.pilesLabel;
	}

	/**
	 * Update the tab with whatever changed
	 */
	public setData(data: Partial<DriverResourceData>): void {
		Object.assign(this.data, data);
		this.show();
	}

	private show(): void {
		const { name, adrenaline, maxAdrenaline, drawPileCount, discardPileCount, passenger } = this.data;
		this.nameLabel.text = name;
		this.passengerTag.visible = passenger;
		this.showPips(Math.min(maxAdrenaline, MAX_PIPS), adrenaline);
		this.adrenalineValue.text = `${adrenaline}/${maxAdrenaline}`;
		this.pilesLabel.text = `DRAW ${drawPileCount}   DISCARD ${discardPileCount}`;
	}

	/**
	 * One pip per point up to the cap, the first `filled` in the driver's
	 * colour, counted from the tab's outer end.
	 */
	private showPips(count: number, filled: number): void {
		while (this.pips.length > count) {
			const pip = this.pips.pop();
			if (pip) this.pipRow.removeChild(pip);
		}
		while (this.pips.length < count) {
			const pip = new Rectangle({ width: PIP_WIDTH, height: PIP_HEIGHT, style: { borderRadius: 1 } });
			this.pips.push(pip);
			this.pipRow.addChild(pip);
		}
		const outward = this.seat === 1 ? this.pips : [...this.pips].reverse();
		outward.forEach((pip, index) => {
			pip.fillColor = hexRgba(DRIVER_COLORS[this.seat], index < filled ? 1 : EMPTY_PIP_ALPHA);
		});
	}
}
