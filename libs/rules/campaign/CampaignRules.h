#pragma once

#include "Campaign.h"

#include <rules/packs/Pack.h>

#include <map>
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

	// What the day clock, the infirmary, scavenging, the compound's fall, the stops' cooldowns, and a run's rewards read:
	// campaign/compound-rules.json.
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
		// Days a stop a run cleared stays cleared: one cleared on day 3 is back at the dawn of day 8 at 5.
		int stopCooldownDays{0};
		// Different cards a won fight or a Find: cards offers, one to take.
		int rewardCards{0};
	};

	// What the garage stocks and charges, in scrap (Game Flow 4): campaign/garage-rules.json.
	struct GarageRules {
		// Different cards on sale each day.
		int stock{0};
		// A card's price by its rarity, one for each a shop sells: common, uncommon, rare, and legendary.
		std::map<Rarity, int> cardPrices;
		// A point of structure or armor put back.
		int repairPerPoint{0};
		// Each escort type for hire; a type it doesn't price isn't.
		std::map<EscortId, int> hirePrices;
	};

	struct CampaignRules {
		CampaignStart start;
		DeckRules	  deck;
		CompoundRules compound;
		GarageRules	  garage;
	};

	// Reads campaign/ from every loaded pack, in load order: start.json, deck-rules.json, compound-rules.json, and
	// garage-rules.json, each one object read strictly. A later pack's file replaces an earlier one's whole, and only
	// when it requires that pack, directly or through another, the rule loadPacks holds content to. Every file has to
	// come from some pack, and the escorts the start and the garage name have to be defined; anything else in the
	// folder, or wrong in a file, throws a ContentError naming the file.
	[[nodiscard]] CampaignRules loadCampaignRules(const Content& content);

} // namespace rules::campaign
