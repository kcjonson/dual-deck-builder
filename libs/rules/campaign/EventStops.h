#pragma once

#include "Campaign.h"
#include "CampaignMap.h"
#include "CampaignRules.h"
#include "Events.h"

#include <rules/map/PoiData.h>
#include <rules/packs/Pack.h>

#include <optional>
#include <string_view>
#include <vector>

namespace rules::campaign {

	// An event at a stop on the road (event-stops-on-a-run.md; campaign.md, Events, the objective, and the return): a
	// wreck or a distress signal opens one, and the run takes one of its choices, which is the only way past it (call
	// 407). Everything drawn there is on the run's stream for the stop (call 406).

	// The event the stop the run is at opens: one of its type's, evenly (call 258), on the stream's `event` fork, so a
	// reload meets the same one. Throws std::invalid_argument when the run isn't at an event stop.
	[[nodiscard]] const EventDefinition& stopEvent(const Campaign& campaign, const Events& events, const MapLayers& map);

	// The outcome a choice at the stop's event lands on, by its place among the choice's, by weight on the stream's
	// `outcome` fork (call 253): the same for a reload. Throws std::invalid_argument as stopEvent does and for a choice
	// the event doesn't have.
	[[nodiscard]] int landedOutcome(const Campaign& campaign, const Events& events, const MapLayers& map, std::string_view choice);

	// Why the party can't take a choice, in the order checked:
	//   Archetype   no seated driver is of the archetype it needs
	//   Card        neither seat's run deck holds the card it needs (call 257)
	//   Escort      no escort of the type it needs came along
	//   ConvoyFull  an outcome, its fight's win counted with it, gives more escorts than the convoy has room for under
	//               four, so one along is dismissed first (calls 402, 403, and 408)
	//   Cost        the cargo and the stores together hold less than it costs of `resource`: `needed`, with `held`
	enum class ChoiceRefusal { Archetype, Card, Escort, ConvoyFull, Cost };

	struct ChoiceBlocker {
		ChoiceRefusal reason{ChoiceRefusal::Cost};
		map::Resource resource{map::Resource::Food};
		int			  needed{0};
		int			  held{0};

		bool operator==(const ChoiceBlocker&) const = default;
	};

	// Throws std::invalid_argument as landedOutcome does, and once the run has taken its choice at the stop.
	[[nodiscard]] std::optional<ChoiceBlocker>
	choiceBlocker(const Campaign& campaign, const Events& events, const MapLayers& map, std::string_view choice);

	// What taking a choice did, for the event scene.
	struct EventTaken {
		EventId event;
		// The outcome it landed on, by its place among the choice's.
		int outcome{0};
		// The escort that joined the convoy and the run.
		std::optional<ConvoyId> escort;
		// Someone new riding home.
		std::vector<DriverId> recruits;
		// Cards on offer to pick from, as after a won fight.
		std::vector<CardId> reward;
		// It turned into a fight, waiting at the stop.
		bool fight{false};
	};

	// Takes a choice at the stop's event: its cost paid from the cargo, then the stores (call 251), and the outcome it
	// lands on given. Resources and settlers go in the cargo and losses come out of it, then the stores, never below 0;
	// cards ride home as cards won; an escort joins the convoy and the run (joinConvoy); someone new, recruitArchetype's
	// on the stream's `driver` fork, rides home (takeFoundDriver); and HP and structure change on every seat, a loss
	// stopping at 1 and a gain at the most (calls 252, 259, and 275). Then an outcome that turns into a fight waits at the
	// stop for startRunFight, what winning it gives fixed now (the run's EventHandOff); one with the card pick opens the
	// reward; and any other drives on. Throws std::invalid_argument for a choice choiceBlocker refuses, and as it does.
	EventTaken takeEventChoice(
		Campaign&					 campaign,
		const Content&				 content,
		const CampaignRules&		 rules,
		const Events&				 events,
		const MapLayers&			 map,
		const std::vector<DriverId>& unlocked,
		std::string_view			 choice
	);

	// A won hand-off's gains, before its reward opens (call 255): what winning it gives, as takeEventChoice gives an
	// outcome's. Throws std::invalid_argument with no run out.
	void giveHandOff(Campaign& campaign, const Content& content, const EventHandOff& handOff);

} // namespace rules::campaign
