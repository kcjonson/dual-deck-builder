/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { Container } from '../../../engine/components/Container';
import type { Text } from '../../../engine/components/Text';
import { createTestContext } from '../../../engine/components/testing';
import { createMeasuringDrawApi } from '../../../engine/text/testing';
import { tokens } from '../../../engine/theme/tokens';
import { CombatLog } from '../../mechanics/CombatLog';
import { TopBarLayer } from './TopBarLayer';

/** DDB-140: the top bar's menu, wave and incoming count, and the ticker of the newest log line. */

function mounted(): { log: CombatLog; bar: TopBarLayer; text: (id: string) => Text } {
	const context = createTestContext({ draw: createMeasuringDrawApi().api, clock: new Clock() });
	const root = new Container({ width: 1280, height: 720 });
	root.mount(context);
	const log = new CombatLog();
	const bar = new TopBarLayer({ combatLog: log, onToggleLog: jest.fn(), width: 1280 });
	root.addChild(bar);
	context.frame.layout();
	return { log, bar, text: (id) => bar.findById(id) as Text };
}

describe('TopBarLayer', () => {
	it('shows the wave, and the raiders still to come only while there are some', () => {
		const { bar, text } = mounted();
		bar.wave = { number: 1, total: 2, incoming: 3 };
		expect(text('combat_wave').text).toBe('Wave 1 of 2');
		expect(text('combat_incoming').text).toBe('+3 incoming');
		expect(text('combat_incoming').visible).toBe(true);
		bar.wave = { number: 2, total: 2, incoming: 0 };
		expect(text('combat_wave').text).toBe('Wave 2 of 2');
		expect(text('combat_incoming').visible).toBe(false);
	});

	it('draws the menu button disabled, since there is no pause menu yet', () => {
		const { bar } = mounted();
		expect(bar.menu.enabled).toBe(false);
		expect(bar.menu.canReceiveFocus()).toBe(false);
		// Its edge drops to a hairline, where the live LOG key keeps its edge
		const log = bar.findById('combat_log_toggle');
		expect(bar.menu.resolvedColors?.border).toEqual(tokens.color.line_hairline);
		expect(log?.resolvedColors?.border).toEqual(tokens.color.line_edge);
		expect(bar.menu.tooltip).not.toBeNull();
	});

	it('tickers the newest log line', () => {
		const { log, text } = mounted();
		log.addEntry({ message: 'Rust Buggy plays Precision Shot', turn: 2 });
		expect(text('combat_ticker').text).toBe('Rust Buggy plays Precision Shot');
	});
});
