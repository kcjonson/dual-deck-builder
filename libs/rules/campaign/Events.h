#pragma once

#include "Campaign.h"

#include <rules/core/Ids.h>
#include <rules/map/StopData.h>
#include <rules/packs/Pack.h>

#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace rules::campaign {

	// Events (event-screen.md; Game Flow 5): the stops that are a short scene with a choice, read from the packs'
	// events/ folders. This is the content and what it says; EventStops.h is the run taking one.

	using EventId = Id<struct EventTag>;

	// The stop types the run resolves as an event: a wreck and a distress signal (call 407). A checkpoint joins once the
	// stops stage places one.
	[[nodiscard]] constexpr bool resolvesAsEvent(map::StopType type) {
		return type == map::StopType::Wreck || type == map::StopType::Distress;
	}

	// What an outcome, or a won fight it turned into, does to the run.
	struct EventGains {
		// Into the cargo, settlers as people...
		Resources gained;
		// ...and out of the cargo, then the stores, never below 0 (call 259). A fight's takes nothing.
		Resources lost;
		// For the locker, through the cargo as cards won are.
		CardCounts cards;
		// The reward a won fight opens, once the outcome's done. Never a fight's, whose win opens it anyway.
		bool cardPick{false};
		// Joining the convoy and the run at once (call 402).
		std::optional<EscortId> escort;
		// Someone new, each of the archetype the compound has fewest of (call 273), riding home.
		int drivers{0};
		// On every seat's vehicle and driver (call 252): a loss stops at 1 (call 259), a gain at their most (call 275).
		// A fight's are gains.
		int structure{0};
		int hp{0};

		bool operator==(const EventGains&) const = default;
	};

	// A fight an outcome turns into (call 255), and what winning it gives.
	struct EventFight {
		int			skulls{1};
		std::string text;
		EventGains	won;

		bool operator==(const EventFight&) const = default;
	};

	struct EventOutcome {
		// Its chance against the choice's other outcomes.
		int			weight{1};
		std::string text;
		// Hours spent past the stop's own, in half hours, which nothing spends until the run keeps a clock (call 271).
		double					  hours{0};
		EventGains				  gains;
		std::optional<EventFight> fight;

		bool operator==(const EventOutcome&) const = default;
	};

	// What a choice needs of the party, every one given holding: a seated driver of the archetype, a copy of the card in
	// a seated driver's run deck, escort cards included and never the locker (call 257), and an escort of the type along.
	struct EventNeeds {
		std::optional<DriverId> archetype;
		std::optional<CardId>	card;
		std::optional<EscortId> escort;

		bool operator==(const EventNeeds&) const = default;
	};

	struct EventChoice {
		std::string id;
		// The action, "Charge the raiders", and a hint at what happens, never which outcome.
		std::string title;
		std::string preview;
		EventNeeds	needs;
		// Paid on taking it, from the cargo, then the stores (call 251); no people.
		Resources cost;
		// The skulls on its card, 0 to 3: how bad it can go.
		int						  danger{0};
		std::vector<EventOutcome> outcomes;

		bool operator==(const EventChoice&) const = default;
	};

	struct EventDefinition {
		EventId id;
		// The pack that defined it last.
		PackId		  pack;
		map::StopType stopType{map::StopType::Wreck};
		std::string	  title;
		// The plate's art, and its caption.
		std::string art;
		std::string caption;
		// What the crew comes on, and why there's a choice to make.
		std::string				 setup;
		std::string				 situation;
		std::vector<EventChoice> choices;

		bool operator==(const EventDefinition&) const = default;
	};

	// Every event the loaded packs define, by id, after every override.
	using Events = std::map<EventId, EventDefinition>;

	// Reads events/*.json from every loaded pack in load order, each {"events": [...]}, the TypeScript's events as data
	// (event-screen.md), read strictly: an unknown or missing field, a value out of its range, a card, archetype, or escort
	// no loaded pack defines, a signature card given, a fight with no encounter at some tier, or an event with no choice
	// that needs and costs nothing (call 254). A later pack adds events or overrides one by id, but only an event from a
	// pack it requires, directly or through another, the rule loadPacks holds content to, and every stop type that
	// resolves as an event has to have one. Anything else throws a ContentError naming the file and the path in it.
	[[nodiscard]] Events loadEvents(const Content& content);

	// The events a stop of `type` opens, in id order.
	[[nodiscard]] std::vector<const EventDefinition*> eventsFor(const Events& events, map::StopType type);

	// A choice that needs nothing and costs nothing, which any party can take.
	[[nodiscard]] bool isFree(const EventChoice& choice);

	// Throws std::invalid_argument for a choice the event doesn't have.
	[[nodiscard]] const EventChoice& choiceOf(const EventDefinition& event, std::string_view choice);

} // namespace rules::campaign
