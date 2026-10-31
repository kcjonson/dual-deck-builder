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

	// A supply run on the area map (campaign.md, Supply runs, and Events, the objective, and the return): the routes on
	// offer, leaving on one, its stops in order, the objective at the POI, and the road home. Load out (RunDecks.h)
	// seats the drivers first, and the run ends coming home (unloadRun, then endDay) or failing. An event at a stop is
	// EventStops.h's.

	// Every route to every POI not cleared yet, as the map stands today (map::routeOffers over mapToday): each stop's roll
	// and a Find: supplies haul at it, and the stops still cleared marked, which a run drives past. A stronghold's are
	// among them, and departBlocker says why none leaves for one.
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
	//   Stronghold     the POI is a stronghold, whose objective is its boss fight, which isn't built (call 410)
	//   Fuel           the stores hold less fuel than the route costs, `fuel`
	enum class DepartRefusal { CampaignOver, NoLoadOut, Gone, Cleared, Stronghold, Fuel };

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

	// What the run on the road meets next, which says what it does:
	//   Fight      a fight stop, the fight an event turned into, or the return ambush: startRunFight
	//   Find       a find: takeFind, or driveOn to leave it by the road
	//   Event      a wreck or a distress signal: takeEventChoice (EventStops.h)
	//   Reward     cards on offer, after a won fight or at a find or an event: takeReward
	//   Objective  the POI: takeObjective
	//   Home       the road home, clear: unloadRun, then endDay
	enum class Ahead { Fight, Find, Event, Reward, Objective, Home };

	// Throws std::invalid_argument with no run on the road.
	[[nodiscard]] Ahead ahead(const Campaign& campaign, const MapLayers& map);

	// The fight the run is at: a fight stop, an ambush or a warband, at its skulls; the fight an event at the stop turned
	// into, at its own (call 255); or the return ambush, at the route's risk as it left (call 411). Its encounter is
	// picked at the POI's tier on the run's stream for the stop, or for the road home, and built through the combat
	// bridge. Throws std::invalid_argument when the run isn't at a fight.
	[[nodiscard]] CampaignFightStart startRunFight(const Campaign& campaign, const Content& content, const MapLayers& map);

	// The fight written back through the combat bridge. Won, the reward opens, rewardCards different cards on the run's
	// stream for the stop or the road home (call 405 for a warband's), an event's fight giving what winning it gives
	// first (call 255). Broken off, the run drives on past the stop, or home, with none (call 412). Lost, the run has
	// failed, and the bridge's write-back says how.
	FightWriteBack
	endRunFight(Campaign& campaign, const Content& content, const CampaignRules& rules, const MapLayers& map, const CampaignFight& fight);

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

	// One card from the reward on offer into the cargo, or none, and the run drives on: past the stop, or home after the
	// return ambush. Throws std::invalid_argument with no reward on offer, or for a card it doesn't hold.
	void takeReward(Campaign& campaign, const Content& content, const MapLayers& map, const std::optional<CardId>& card);

	// Leaves the find at the stop the run is at by the road, taking nothing. Throws std::invalid_argument anywhere else:
	// only fighting gets past a fight, and only a choice gets past an event (call 407).
	void driveOn(Campaign& campaign, const MapLayers& map);

	// What the objective at the POI gave.
	struct ObjectiveTaken {
		// The POI type's whole yield, into the cargo.
		Resources yields;
		// The return ambush waits on the road home.
		bool ambush{false};
	};

	// Takes the objective at the POI the run has reached (call 409): its type's whole yield into the cargo, where a run
	// that fails on the way home still loses it, and the return ambush rolled once, at the chance the run's game stage
	// gives it, on the run's stream for the road home (call 411). The POI clears when the run gets home (unloadRun).
	// Throws std::invalid_argument when the run isn't at its POI, or has taken its objective.
	ObjectiveTaken takeObjective(Campaign& campaign, const CampaignRules& rules, const MapLayers& map);

} // namespace rules::campaign
