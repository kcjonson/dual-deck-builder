import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Button } from '../../../engine/ui/Button';
import { ScreenManager } from '../../core/ScreenManager';
import { CampaignStore } from '../../campaign/CampaignStore';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import { atHomeCampaign } from '../../campaign/__fixtures__/storeFixtures';
import type { LoadOutLaunch } from '../load-out/LoadOutScreen';

const BUTTON_WIDTH = 200;

/**
 * A developer way into load out (DDB-320): the test campaign home from its
 * run, no route picked, so START RUN says there's none and nothing sets
 * off. Changes save into memory, so the player's save is left alone, and
 * Back comes back here. In the gallery, where no screens are mounted, the
 * button does nothing.
 */
export class LoadOutLauncherSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_load_out', title: 'Load out', ...options });
		this.addRow("The test campaign at home, saved in memory only; Back comes back here", this.line([new Button({
			label: 'Open load out',
			id: 'dev_load_out_open',
			width: BUTTON_WIDTH,
			onClick: () => open(),
		})]));
	}
}

function open(): void {
	if (!ScreenManager.activeScreen) return;
	const store = new CampaignStore({ storage: new MemorySaveStorage(), namespace: 'developer', onWarning: () => undefined });
	const launch: Partial<LoadOutLaunch> = { campaign: atHomeCampaign(), heading: 'No route: opened from the developer screen', store, returnTo: 'developerScreen' };
	ScreenManager.navigate('loadOutScreen', launch);
}
