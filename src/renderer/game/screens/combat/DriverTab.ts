import { Layer } from '../../../engine/components/Layer';
import { Rectangle } from '../../../engine/components/Rectangle';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { DRIVER_COLORS, DRIVER_TAB_BACKGROUND, rgba } from './combatStyle';
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
/** Pips up to this many; the count beside them carries the rest. */
const MAX_PIPS = 6;
const PIP_WIDTH = 7;
const PIP_HEIGHT = 14;
const MARK_SIZE = 10;
/** An unfilled pip, the driver's colour at this alpha. */
const EMPTY_PIP_ALPHA = 0.22;

/**
 * A driver's tab above their half of the hand (Battle Screen Design,
 * section 4): their mark and name, a PASSENGER tag when it applies, then
 * adrenaline pips with the count, and draw and discard pile counts. One
 * row; the name gives way first, with an ellipsis, so the counts are never
 * squeezed.
 */
export class DriverTab extends Stack {
	private readonly seat: DriverSeat;
	private readonly nameLabel: Text;
	private readonly passengerTag: Text;
	private readonly pipRow: Stack;
	private pips: Rectangle[] = [];
	private readonly adrenalineValue: Text;
	private readonly piles: Text;

	private data: DriverResourceData = {
		name: '',
		adrenaline: 0,
		maxAdrenaline: 0,
		drawPileCount: 0,
		discardPileCount: 0,
		passenger: false,
	};

	constructor({ seat, ...options }: StackOptions & { seat: DriverSeat }) {
		super({
			direction: 'horizontal',
			gap: 10,
			padding: { left: 10, right: 10 },
			crossAlign: 'center',
			height: DRIVER_TAB_HEIGHT,
			widthMode: 'fill',
			...options,
		});
		this.seat = seat;
		this.setBackgroundColor(DRIVER_TAB_BACKGROUND);
		const color = DRIVER_COLORS[seat];

		// Driver 1's mark is a square, driver 2's the same square turned to a
		// diamond, so the colour always has a shape twin (section 7)
		this.addChild(new Rectangle({
			width: MARK_SIZE,
			height: MARK_SIZE,
			transform: seat === 2 ? { rotate: Math.PI / 4 } : undefined,
			style: { backgroundColor: color },
		}));

		this.nameLabel = new Text('', {
			id: `driver${seat}_tab_name`,
			style: {
				fontFamily: 'display',
				fontSize: 15,
				letterSpacing: 0.06,
				textTransform: 'uppercase',
				color: rgba('text'),
				whiteSpace: 'nowrap',
				textOverflow: 'ellipsis',
			},
		});
		this.addChild(this.nameLabel);

		this.passengerTag = new Text('PASSENGER', {
			visible: false,
			style: { fontFamily: 'mono', fontSize: 11, color: rgba('text_dim'), whiteSpace: 'nowrap' },
		});
		this.addChild(this.passengerTag);

		// Takes whatever the row leaves, so the counts sit at the far end
		this.addChild(new Layer({ widthMode: 'fill', heightMode: 'fill' }));

		this.pipRow = new Stack({ direction: 'horizontal', gap: 2, crossAlign: 'center' });
		this.addChild(this.pipRow);

		this.adrenalineValue = new Text('', {
			id: `driver${seat}_adrenaline_value`,
			style: { fontFamily: 'display', fontSize: 15, color, whiteSpace: 'nowrap' },
		});
		this.addChild(this.adrenalineValue);

		this.piles = new Text('', {
			id: `driver${seat}_piles`,
			style: { fontFamily: 'mono', fontSize: 12, color: rgba('text_dim'), whiteSpace: 'nowrap' },
		});
		this.addChild(this.piles);

		this.show();
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
		this.nameLabel.setText(name);
		this.passengerTag.visible = passenger;
		this.showPips(Math.min(maxAdrenaline, MAX_PIPS), adrenaline);
		this.adrenalineValue.setText(`${adrenaline}/${maxAdrenaline}`);
		this.piles.setText(`DRAW ${drawPileCount}   DISCARD ${discardPileCount}`);
	}

	/** One pip per point up to the cap, the first `filled` in the driver's colour. */
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
		const [red, green, blue] = hexToRgb(DRIVER_COLORS[this.seat]);
		this.pips.forEach((pip, index) => {
			pip.setFillColor([red, green, blue, index < filled ? 1 : EMPTY_PIP_ALPHA]);
		});
	}
}

function hexToRgb(hex: string): [number, number, number] {
	const value = parseInt(hex.slice(1), 16);
	return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
