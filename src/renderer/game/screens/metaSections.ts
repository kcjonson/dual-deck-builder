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

/**
 * The thumb-index tabs a campaign screen hangs from its sheet, `open` the
 * one it is. They replace Back between these siblings: a tab goes to its
 * screen with the campaign the screen holds (`campaignOf`, read at the
 * press, since a screen loads it after mounting), and the menu takes none;
 * each restores the focus it had when the player left it.
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
