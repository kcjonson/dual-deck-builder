/**
 * @jest-environment jsdom
 */
import { Component, PointerEvents } from '../../engine/components/Component';
import { Container } from '../../engine/components/Container';
import type { MountContext } from '../../engine/components/MountContext';
import { createTestContext } from '../../engine/components/testing';
import { Clock } from '../../engine/animation/Clock';
import { advance, pointer, send } from '../../engine/services/testing';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { tokens } from '../../engine/theme/tokens';
import { InspectOpening, inspectHotkey, inspectOnContextMenu, makeDetailInspectable } from './cardInspect';

/** Something with a detail view that is neither a play card nor a driver card, as the escort card will be. */
class EscortStandIn extends Component {
	constructor() {
		super({ id: 'escort', x: 300, y: 200, width: 80, height: 112 });
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}
}

let context: MountContext;
let owner: EscortStandIn;
let openings: InspectOpening[];

beforeEach(() => {
	context = createTestContext({ draw: createMeasuringDrawApi().api, clock: new Clock() });
	const strip = new Container({ id: 'strip', x: 0, y: 0, width: 1440, height: 400 });
	owner = new EscortStandIn();
	owner.focusable = true;
	openings = [];
	makeDetailInspectable(owner, (opening) => {
		openings.push(opening);
		return { surface: new Container({ id: 'escort_view', width: 200, height: 120 }), x: 250 };
	});
	strip.addChild(owner);
	inspectOnContextMenu(strip);
	strip.mount(context);
	context.frame.layout();
});

const centre = (): { x: number; y: number } => ({ x: 340, y: 256 });

describe('makeDetailInspectable', () => {
	it('opens what its owner builds on hover, resting on the screen\'s bottom edge at the left edge it gives', () => {
		send(context, [pointer('move', centre().x, centre().y)]);
		advance(context, tokens.control.tooltip_delay + tokens.motion.dur_fast + 100);
		expect(context.tooltips.owner).toBe(owner);
		const bounds = context.tooltips.surface?.screenBounds;
		expect(bounds?.x).toBe(250);
		expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeCloseTo(882 - 10, 5);
		expect(openings).toHaveLength(1);
		expect(openings[0]).toMatchObject({ viewport: { width: 1440, height: 882 }, scale: 1, pinned: false });
		expect(openings[0].bounds).toEqual(owner.screenBounds);
	});

	it('pins on a secondary click through its container, building the view again so it can say so, and lets go on the next', () => {
		send(context, [pointer('down', centre().x, centre().y, { button: 2 }), pointer('up', centre().x, centre().y, { button: 2 })]);
		expect(context.tooltips.pinned).toBe(owner);
		expect(openings[openings.length - 1].pinned).toBe(true);
		send(context, [pointer('down', centre().x, centre().y, { button: 2 }), pointer('up', centre().x, centre().y, { button: 2 })]);
		expect(context.tooltips.pinned).toBeNull();
	});

	it('opens on a touch hold', () => {
		send(context, [pointer('down', centre().x, centre().y, { pointerType: 'touch', pointerId: 2 })]);
		advance(context, 600);
		expect(context.tooltips.owner).toBe(owner);
		send(context, [pointer('up', centre().x, centre().y, { pointerType: 'touch', pointerId: 2 })]);
	});

	it('pins on I when its owner has focus, and I does nothing for a focused component without a detail view', () => {
		const plain = new Container({ id: 'plain', x: 0, y: 0, width: 40, height: 40 });
		plain.focusable = true;
		owner.parent?.addChild(plain);
		context.frame.layout();
		const scope = owner.parent as Container;
		context.focus.pushScope(scope);
		context.focus.focus(plain, 'keyboard');
		expect(inspectHotkey(context)).toBe(false);
		context.focus.focus(owner, 'keyboard');
		context.frame.layout();
		expect(inspectHotkey(context)).toBe(true);
		expect(context.tooltips.pinned).toBe(owner);
		expect(inspectHotkey(context)).toBe(true);
		expect(context.tooltips.pinned).toBeNull();
		context.focus.popScope(scope);
	});
});
