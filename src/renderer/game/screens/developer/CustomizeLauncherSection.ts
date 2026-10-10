import { CatalogSection } from './CatalogSection';
import type { DeveloperSectionOptions } from './DeveloperSectionPanel';
import { Button } from '../../../engine/ui/Button';
import { ScreenManager } from '../../core/ScreenManager';
import { Campaign } from '../../campaign/Campaign';
import { CampaignStore } from '../../campaign/CampaignStore';
import { MemorySaveStorage } from '../../campaign/SaveStorage';
import { CAMPAIGN_FIXTURE } from '../../campaign/__fixtures__/storeFixtures';

const BUTTON_WIDTH = 200;

/**
 * Customize (DDB-321) has no way in until load out (DDB-320) is built, so
 * this opens it on the test campaign's run, one seat or the other: a card
 * left at home, one borrowed, and an escort card in seat 1. Changes save
 * into memory, so the player's save is left alone, and Done comes back
 * here. In the gallery, where no screens are mounted, the buttons do
 * nothing.
 */
export class CustomizeLauncherSection extends CatalogSection {
	constructor(options: DeveloperSectionOptions = {}) {
		super({ id: 'dev_section_customize', title: 'Customize', ...options });
		this.addRow("The test campaign's run, saved in memory only; Done comes back here", this.line([1, 2].map((seat) => new Button({
			label: `Driver ${seat}'s run deck`,
			id: `dev_customize_seat_${seat}`,
			width: BUTTON_WIDTH,
			onClick: () => open(seat - 1),
		}))));
	}
}

function open(seat: number): void {
	if (!ScreenManager.activeScreen) return;
	const campaign = Campaign.fromJSON(JSON.parse(JSON.stringify(CAMPAIGN_FIXTURE)), { onWarning: () => undefined });
	const store = new CampaignStore({ storage: new MemorySaveStorage(), namespace: 'developer', onWarning: () => undefined });
	ScreenManager.navigate('customizeScreen', { campaign, driver: campaign.runDecks[seat].driver, returnTo: 'developerScreen', store });
}
