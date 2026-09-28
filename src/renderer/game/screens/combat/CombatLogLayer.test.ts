/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { Layer } from '../../../engine/components/Layer';
import type { MountContext } from '../../../engine/components/MountContext';
import { Text } from '../../../engine/components/Text';
import { createTestContext } from '../../../engine/components/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { CombatLog } from '../../mechanics/CombatLog';
import { CombatLogLayer } from './CombatLogLayer';

/** DDB-32: the log drawer scrolls, follows the newest entry, and keeps the lines it already has. */

let context: MountContext;
let root: Layer;

beforeEach(() => {
	context = createTestContext({ draw: createMeasuringDrawApi().api, clock: new Clock() });
	root = new Layer({ width: 800, height: 600 });
	root.mount(context);
});

afterEach(() => root.unmount());

function mounted(maxEntries = 30): { log: CombatLog; layer: CombatLogLayer } {
	const log = new CombatLog(maxEntries);
	const layer = new CombatLogLayer({ x: 0, y: 0, width: 300, height: 200, combatLog: log });
	root.addChild(layer);
	context.frame.layout();
	return { log, layer };
}

function lines(layer: CombatLogLayer): Text[] {
	return (layer.scrollContainer.content?.getChildren() ?? []) as Text[];
}

describe('CombatLogLayer', () => {
	it('shows one line per entry and scrolls to the newest once they overflow', () => {
		const { log, layer } = mounted();
		for (let index = 0; index < 20; index++) log.addEntry(`Event ${index}`);
		context.frame.layout();
		const scroll = layer.scrollContainer;
		expect(lines(layer).map((line) => line.getText())).toEqual(Array.from({ length: 20 }, (_unused, index) => `Event ${index}`));
		expect(scroll.overflows).toBe(true);
		expect(scroll.scrollPosition).toBe(scroll.maxScroll);
	});

	it('keeps the lines it has when an entry is added, and drops the ones the log let go', () => {
		const { log, layer } = mounted(3);
		log.addEntry('one');
		log.addEntry('two');
		const [, second] = lines(layer);
		log.addEntry('three');
		log.addEntry('four');
		expect(lines(layer).map((line) => line.getText())).toEqual(['two', 'three', 'four']);
		expect(lines(layer)[0]).toBe(second);
	});
});
