#pragma once

#include "Campaign.h"

#include <rules/packs/Pack.h>

#include <vector>

namespace rules::campaign {

	// What a new campaign starts with (Compound and Supply Runs, Founding the compound): campaign/start.json.
	struct CampaignStart {
		// Drivers dealt into the starting pool, no two alike: at least the two a run takes.
		int		  poolSize{0};
		Resources stores;
		// Starter escorts by type, in roster order.
		std::vector<EscortId> escorts;
		std::vector<Building> buildings;
	};

	// What every deck keeps, at home and on a run, and what a scrapped locker card pays: campaign/deck-rules.json.
	struct DeckRules {
		int fewestCards{0};
		int mostCards{0};
		int scrapPerCard{0};
	};

	struct HaulRange {
		int least{0};
		int most{0};
	};

	// What the day clock, the infirmary, scavenging, and the compound's fall read: campaign/compound-rules.json.
	struct CompoundRules {
		// People one unit of food, and of water, feeds a day.
		int peoplePerFood{0};
		int peoplePerWater{0};
		// What each unit short costs.
		int peopleLostPerUnit{0};
		int unrestPerUnit{0};
		// HP an injured driver heals a day, which sets how long they're out, and the meds that buy a day off.
		int		  hitpointsPerDay{0};
		int		  medsPerDay{0};
		HaulRange scavengedFuel;
		HaulRange scavengedScrap;
		// The compound starves at or below this much food, and riots at or above this much unrest.
		int starveAtFood{0};
		int riotAtUnrest{0};
	};

	struct CampaignRules {
		CampaignStart start;
		DeckRules	  deck;
		CompoundRules compound;
	};

	// Reads campaign/ from every loaded pack, in load order: start.json, deck-rules.json, and compound-rules.json, each
	// one object read strictly. A later pack's file replaces an earlier one's whole, and only when it requires that pack,
	// directly or through another, the rule loadPacks holds content to. Every file has to come from some pack and the
	// start's escorts have to be defined; anything else in the folder, or wrong in a file, throws a ContentError naming
	// the file.
	[[nodiscard]] CampaignRules loadCampaignRules(const Content& content);

} // namespace rules::campaign
