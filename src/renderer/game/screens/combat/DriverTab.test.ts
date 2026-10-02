/**
 * @jest-environment jsdom
 */
import { DriverTab, MAX_MOD_ICONS, MAX_PIPS } from './DriverTab';
import { Icon } from '../../../engine/components/Icon';
import type { Component } from '../../../engine/components/Component';
import { Text } from '../../../engine/components/Text';
import type { VehicleMod } from '../../mechanics/Vehicle';

function all(component: Component): Component[] {
	return component.children.flatMap((child) => (child.visible ? [child, ...all(child)] : []));
}

function texts(component: Component): string[] {
	return all(component).filter((node): node is Text => node instanceof Text).map((text) => text.text);
}

function bolts(tab: DriverTab): Icon[] {
	return all(tab).filter((node): node is Icon => node instanceof Icon && node.glyph === 'flash_on');
}

const mods = (count: number): VehicleMod[] => Array.from({ length: count }, (_unused, index) => ({ name: `Mod ${index}`, kind: 'utility' }));

describe('DriverTab (Battle Screen Design section 4)', () => {
	it('builds a bolt per point of maximum, lit up to the driver\'s adrenaline (DDB-117)', () => {
		const tab = new DriverTab({ seat: 1 });
		tab.setData({ adrenaline: 3, maxAdrenaline: 5 });
		expect(bolts(tab)).toHaveLength(5);
		expect(bolts(tab).map((bolt) => bolt.tint[3])).toEqual([1, 1, 1, 0.22, 0.22]);
		expect(texts(tab)).toContain('3/5');
		tab.setData({ maxAdrenaline: 3 });
		expect(bolts(tab)).toHaveLength(3);
	});

	it('lights driver 2\'s bolts from the tab\'s outer end', () => {
		const tab = new DriverTab({ seat: 2 });
		tab.setData({ adrenaline: 1, maxAdrenaline: 3 });
		expect(bolts(tab).map((bolt) => bolt.tint[3])).toEqual([0.22, 0.22, 1]);
	});

	it('shows one bolt and the count past six', () => {
		const tab = new DriverTab({ seat: 1 });
		tab.setData({ adrenaline: 2, maxAdrenaline: MAX_PIPS + 2 });
		expect(bolts(tab)).toHaveLength(1);
		expect(texts(tab)).toContain(`2/${MAX_PIPS + 2}`);
	});

	it('shows up to four mods, then three and "+N" naming the rest', () => {
		const tab = new DriverTab({ seat: 1 });
		tab.setData({ mods: mods(MAX_MOD_ICONS) });
		expect(tab.modChips).toHaveLength(MAX_MOD_ICONS);
		expect(tab.modChips.map((chip) => chip.tooltip?.title)).toEqual(['Mod 0', 'Mod 1', 'Mod 2', 'Mod 3']);
		tab.setData({ mods: mods(6) });
		expect(tab.modChips).toHaveLength(MAX_MOD_ICONS);
		expect(texts(tab.modChips[3])).toEqual(['+3']);
		expect(tab.modChips[3].tooltip?.description).toBe('Mod 3, Mod 4, Mod 5');
	});

	it('shows no mods while a passenger, since the mods were on the wreck', () => {
		const tab = new DriverTab({ seat: 1 });
		tab.setData({ mods: mods(2), passenger: true });
		expect(texts(tab)).toContain('PASSENGER');
		expect(tab.modChips).toHaveLength(0);
	});

	it('says CRASHED OUT, with no adrenaline or mods, for a driver with no seat (DDB-167)', () => {
		const tab = new DriverTab({ seat: 2 });
		tab.setData({ name: 'Rook', adrenaline: 2, maxAdrenaline: 5, mods: mods(2), crashedOut: true, drawPileCount: 9, discardPileCount: 4 });
		expect(texts(tab)).toEqual(expect.arrayContaining(['Rook', 'CRASHED OUT', '9', '4']));
		expect(texts(tab)).not.toContain('2/5');
		expect(bolts(tab)).toHaveLength(0);
		expect(tab.modChips).toHaveLength(0);
	});
});
