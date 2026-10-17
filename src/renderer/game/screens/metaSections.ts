import type { Campaign } from '../campaign/Campaign';
import { ScreenManager, ScreenName } from '../core/ScreenManager';
import { SectionTabs } from '../ui/atlas/SectionTabs';

/** The meta screens a campaign's sheet tabs between (UI Art Direction, Components: section tabs). */
export type MetaSection = 'menu' | 'compound' | 'area_map' | 'crew';

const SECTIONS: readonly { id: MetaSection; label: string; screen: ScreenName; deck?: boolean }[] = [
	{ id: 'menu', label: 'Menu', screen: 'mainMenuScreen' },
	{ id: 'compound', label: 'Compound', screen: 'compoundScreen' },
	{ id: 'area_map', label: 'Area map', screen: 'areaMapScreen' },
	{ id: 'crew', label: 'Crew', screen: 'crewScreen', deck: true },
];

/** What a screen knows that decides which of its tabs can be taken. */
export interface SectionState {
	/** The campaign the screen holds, null until it has loaded one. */
	campaign: Campaign | null;
	/** The campaign's area map has been made this session (`PlanningMaps.known`). */
	mapKnown: boolean;
	/** Something keeps a supply run from being planned: the compound's Plan a supply run is off. */
	planBlocked: boolean;
	/** The screen is in the middle of something the tabs mustn't cut short, such as the compound's day-end save. */
	busy: boolean;
}

/**
 * The one rule for which section tabs can be taken: Menu always; Compound
 * and Crew once there's a campaign; Area map once its map is known and
 * nothing blocks planning; and all but Menu held while the screen is busy.
 */
export function sectionAvailability({ campaign, mapKnown, planBlocked, busy }: SectionState): Readonly<Record<MetaSection, boolean>> {
	const live = campaign !== null && !busy;
	return { menu: true, compound: live, area_map: live && mapKnown && !planBlocked, crew: live };
}

/**
 * Enables the tabs `sectionAvailability` allows. The open section's tab
 * stays enabled whatever the rule says, since a disabled tab can't show as
 * open, and pressing the open one does nothing anyway.
 */
export function gateSectionTabs(tabs: SectionTabs, state: SectionState): void {
	const available = sectionAvailability(state);
	for (const tab of tabs.tabs) tab.enabled = tab.tabId === tabs.selectedId || available[tab.tabId as MetaSection] === true;
}

/**
 * The thumb-index tabs a campaign screen hangs from its sheet, `open` the
 * one it is. They replace Back between these siblings: a tab goes to its
 * screen with the campaign the screen holds (`campaignOf`, read at the
 * press, since a screen loads it after mounting), and the menu takes none;
 * each restores the focus it had when the player left it. Each tab's id is
 * `${id}.${section}`. The screen gates them with `gateSectionTabs`.
 */
export function metaSectionTabs({ id, open, campaignOf }: { id: string; open: MetaSection; campaignOf: () => Campaign | null }): SectionTabs {
	return new SectionTabs({
		id,
		tabs: SECTIONS.map(({ id: tab, label, deck }) => ({ id: tab, label, deck })),
		selectedId: open,
		onSelect: (tab) => {
			const section = SECTIONS.find(({ id: candidate }) => candidate === tab);
			if (!section) return;
			const campaign = section.id === 'menu' ? null : campaignOf();
			ScreenManager.navigate(section.screen, campaign ? { campaign } : undefined, { restoreFocus: true });
		},
	});
}
