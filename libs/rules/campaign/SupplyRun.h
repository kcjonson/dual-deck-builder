#pragma once

#include "Campaign.h"
#include "CampaignMap.h"
#include "CampaignRules.h"
#include "CombatBridge.h"
#include "Recruits.h"

#include <rules/map/RouteOffers.h>
#include <rules/packs/Pack.h>

#include <cstdint>
#include <optional>
#include <vector>

namespace rules::campaign {

	// A supply run on the area map (campaign.md, Supply runs): the routes on offer, leaving on one, and its stops in
	// order. Load out (RunDecks.h) seats the drivers first, and the run ends coming home (unloadRun) or failing.

	// Every route to every POI not cleared yet, as the map stands today (map::routeOffers over mapToday): each stop's roll
	// and a Find: supplies haul at it, and the stops still cleared marked, which a run drives past.
	[[nodiscard]] std::vector<map::RouteOffer> offersToday(const Campaign& campaign, const MapLayers& map);

	// A POI, and its place among its routes, quickest first.
	struct RouteChoice {
		int poi{0};
		int route{0};
	};

	// Why a run can't leave on a route, in the order checked:
	//   CampaignOver   the campaign is over
	//   NoLoadOut      nobody is seated
	//   Gone           the run has left already
	//   Cleared        a run has cleared the POI
	//   Fuel           the stores hold less fuel than the route costs, `fuel`
	enum class DepartRefusal { CampaignOver, NoLoadOut, Gone, Cleared, Fuel };

	struct DepartBlocker {
		DepartRefusal reason{DepartRefusal::NoLoadOut};
		int			  fuel{0};

		bool operator==(const DepartBlocker&) const = default;
	};

	// Throws std::invalid_argument for a POI or route the map doesn't have.
	[[nodiscard]] std::optional<DepartBlocker> departBlocker(const Campaign& campaign, const MapLayers& map, const RouteChoice& choice);

	// The load out leaves on the route (Compound and Supply Runs, The run route screen): its fuel paid from the stores, and
	// the route and the stops it meets fixed on the run, those on its legs at the run's game stage and not cleared, in
	// driving order. Throws std::invalid_argument for a departure departBlocker refuses.
	void depart(Campaign& campaign, const MapLayers& map, const RouteChoice& choice);

	// The stop the run is at, by id, or none once it's past its last, at the POI, or not left yet.
	[[nodiscard]] std::optional<int> stopAhead(const Campaign& campaign);

	// The fight at the stop the run is at, an ambush or a warband: its encounter picked for the stop's skulls at the POI's
	// tier on the run's stream for the stop, and built through the combat bridge. Throws std::invalid_argument when the
	// run isn't at a fight, or one it has won and has a reward to pick.
	[[nodiscard]] CampaignFightStart startStopFight(const Campaign& campaign, const Content& content, const MapLayers& map);

	// The fight written back through the combat bridge. Won, it opens the reward: rewardCards different cards on the run's
	// stream for the stop (call 405 for a warband's). Broken off, the run drives on past the stop with none. Lost, the run
	// has failed, and the bridge's write-back says how.
	FightWriteBack
	endStopFight(Campaign& campaign, const Content& content, const CampaignRules& rules, const MapLayers& map, const CampaignFight& fight);

	// What taking a find at the stop the run is at brought.
	struct TakenFind {
		// A Find: supplies haul, into the cargo.
		std::optional<map::Haul> haul;
		// A Find: driver's, riding home with the run.
		std::optional<FoundDriver> driver;
		// A Find: cards's reward, open to pick from.
		std::vector<CardId> reward;
	};

	// Takes the find at the stop the run is at (find-stops.md, call 183): a haul into the cargo, a driver whoIsFound
	// turns up on the run's stream for the stop riding home, or cards to pick from as after a fight, drawn on the same
	// stream. A haul or a driver moves the run on; cards wait for takeReward. Throws std::invalid_argument when the run
	// isn't at a find, or has its cards on offer.
	TakenFind takeFind(
		Campaign&					 campaign,
		const Content&				 content,
		const CampaignRules&		 rules,
		const MapLayers&			 map,
		const std::vector<DriverId>& unlocked
	);

	// One card from the reward on offer into the cargo, or none, and the run drives on. Throws std::invalid_argument with
	// no reward on offer, or for a card it doesn't hold.
	void takeReward(Campaign& campaign, const Content& content, const MapLayers& map, const std::optional<CardId>& card);

	// Drives on past the stop the run is at, taking nothing: a find left by the road, or a stop the run has no screen
	// for yet, which runs as a quiet stretch (call 220). Throws std::invalid_argument at a fight, with a reward on offer,
	// and when the run isn't at a stop.
	void driveOn(Campaign& campaign, const MapLayers& map);

} // namespace rules::campaign
