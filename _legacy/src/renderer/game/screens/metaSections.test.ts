/**
 * @jest-environment jsdom
 */
import type { Campaign } from '../campaign/Campaign';
import { ScreenManager } from '../core/ScreenManager';
import { MetaSection, SectionState, gateSectionTabs, metaSectionTabs, sectionAvailability } from './metaSections';

jest.mock('../core/ScreenManager', () => ({
	ScreenManager: { navigate: jest.fn() },
}));

const CAMPAIGN = {} as Campaign;
const READY: SectionState = { campaign: CAMPAIGN, mapKnown: true, planBlocked: false, busy: false };

describe('sectionAvailability (DDB-509)', () => {
	it('opens every tab with a campaign whose map is known and nothing blocking a plan', () => {
		expect(sectionAvailability(READY)).toEqual({ menu: true, compound: true, area_map: true, crew: true });
	});

	it('leaves only the menu with no campaign', () => {
		expect(sectionAvailability({ ...READY, campaign: null })).toEqual({ menu: true, compound: false, area_map: false, crew: false });
	});

	it('holds the area map until its map is known, and while planning is blocked', () => {
		expect(sectionAvailability({ ...READY, mapKnown: false })).toEqual({ menu: true, compound: true, area_map: false, crew: true });
		expect(sectionAvailability({ ...READY, planBlocked: true })).toEqual({ menu: true, compound: true, area_map: false, crew: true });
	});

	it('holds every tab but the menu while the screen is busy', () => {
		expect(sectionAvailability({ ...READY, busy: true })).toEqual({ menu: true, compound: false, area_map: false, crew: false });
	});
});

describe('gateSectionTabs', () => {
	const enabled = (open: MetaSection, state: SectionState): Record<string, boolean> => {
		const tabs = metaSectionTabs({ id: 'tabs', open, campaignOf: () => state.campaign });
		gateSectionTabs(tabs, state);
		return Object.fromEntries(tabs.tabs.map((tab) => [tab.id, tab.enabled]));
	};

	it('enables what the rule allows, by the tabs\' ids, and keeps the open tab enabled and shown open', () => {
		expect(enabled('compound', { ...READY, planBlocked: true })).toEqual({ 'tabs.menu': true, 'tabs.compound': true, 'tabs.area_map': false, 'tabs.crew': true });
		expect(enabled('area_map', { ...READY, campaign: null })).toEqual({ 'tabs.menu': true, 'tabs.compound': false, 'tabs.area_map': true, 'tabs.crew': false });
		const tabs = metaSectionTabs({ id: 'tabs', open: 'compound', campaignOf: () => null });
		gateSectionTabs(tabs, { ...READY, busy: true });
		expect(tabs.selectedId).toBe('compound');
	});

	it('goes to a tab\'s screen with the campaign, and to the menu with none', () => {
		const navigate = ScreenManager.navigate as jest.Mock;
		const tabs = metaSectionTabs({ id: 'tabs', open: 'area_map', campaignOf: () => CAMPAIGN });
		tabs.onSelect?.('crew', {} as never);
		expect(navigate).toHaveBeenLastCalledWith('crewScreen', { campaign: CAMPAIGN }, { restoreFocus: true });
		tabs.onSelect?.('menu', {} as never);
		expect(navigate).toHaveBeenLastCalledWith('mainMenuScreen', undefined, { restoreFocus: true });
	});
});
