#pragma once

// What the area map and the run route read of the campaign and its map (area-map-route-pick.md): what's known of the map
// (map-knowledge.md, For the campaign), the POIs found on it as destinations, nearest first, each with its routes today,
// and the words the two scenes say about them. Nothing here decides anything a rule does.

#include "Session.h"

#include <rules/map/MapKnowledge.h>
#include <rules/map/RouteOffers.h>

#include <array>
#include <optional>
#include <string>
#include <vector>

namespace game {

	struct Destination {
		int			poi{0};
		std::string name;
		// Its type's label, "Hospital", or "Stronghold".
		std::string kind;
		// Its marker's letter (area-map-atlas-style.md, call 9); empty for a stronghold.
		std::string glyph;
		int			tier{0};
		bool		stronghold{false};
		// A run cleared it, for good.
		bool			   cleared{false};
		std::array<int, 5> yields{};
		// Its routes as the map stands today, quickest first by hours out; none once it's cleared.
		std::vector<rules::map::RouteOffer> routes;

		// Some route gets home by dark; true with no routes.
		[[nodiscard]] bool homeByDark() const;
	};

	struct Planning {
		rules::map::MapKnowledge knowledge;
		// The POIs found, by tier, then the quickest route's hours out, strongholds last.
		std::vector<Destination> destinations;
		// The share of the disc revealed.
		double explored{0};

		[[nodiscard]] const Destination* find(int poi) const;
	};

	// The campaign's starting knowledge with what its runs charted and the POIs they cleared over it, and what follows.
	[[nodiscard]] Planning planning(const Session& session);

	// Why no run can be planned to a destination now, or none: the campaign over, a run out, a POI cleared, a stronghold.
	[[nodiscard]] std::optional<std::string> planBlocker(const rules::campaign::Campaign& campaign, const Destination& destination);

	// "6 meds and 4 food", or "nothing".
	[[nodiscard]] std::string yieldsText(const std::array<int, 5>& yields);
	// "4.2 h".
	[[nodiscard]] std::string hoursText(double hours);
	// An hour of the day: "17:30", or "06:10 the next morning" past midnight.
	[[nodiscard]] std::string clockText(double hourOfDay);
	// "charted / 4 stops / about 5.2 h out / fuel 4 / risk 2 of 3".
	[[nodiscard]] std::string routeFacts(const rules::map::RouteOffer& offer);

} // namespace game
