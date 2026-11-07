#pragma once

// What the event scene says (event-screen.md), apart from the scene so its tests read the same words: a choice's band,
// the icons its card shows, and the ledger an outcome leaves. Every refusal is the rules' choiceBlocker, worded.

#include <rules/campaign/EventStops.h>
#include <rules/campaign/Events.h>
#include <rules/map/StopData.h>
#include <rules/packs/Pack.h>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace game::event {

	// The risk and reward icons (Game Flow 5.2): the stores' own, then strokes on the same 18 px grid for the rest.
	enum class Icon : uint8_t { Food, Water, Fuel, Meds, Scrap, People, Skull, Swords, Clock, Cards, Escort, Driver, Repair, Heal };

	// How an icon and its words read: ink, a cost or a danger in Stronghold, a gain in Sage.
	enum class Tone : uint8_t { Ink, Cost, Gain };

	struct IconItem {
		Icon		icon = Icon::Skull;
		Tone		tone = Tone::Ink;
		std::string value; // printed after the icon, in mono; none when empty
	};

	// A choice card's two rows: what it risks (a fight, its skulls, its costs, the most hours it can take) and what any of
	// its outcomes can give, never which one lands.
	struct ChoiceIcons {
		std::vector<IconItem> risks;
		std::vector<IconItem> gains;
	};

	struct LedgerLine {
		Icon		icon = Icon::Food;
		std::string text;
		Tone		tone = Tone::Ink;
	};

	// The stop's kind over the title: "Wreck", "Distress signal".
	[[nodiscard]] std::string kicker(rules::map::StopType type);

	// What the crew sees of an event stop from the road, before pulling over.
	[[nodiscard]] std::string fromTheRoad(rules::map::StopType type);

	// A choice's band (Game Flow 5.2): what it needs, "Mechanic only", "EMP Blast", "Med Truck", joined; why it's locked
	// when it is; and a need it meets kept beside a shortfall in the stores, "Mechanic / Need 8 scrap, have 5". Empty for
	// a choice anyone can take.
	[[nodiscard]] std::string bandText(
		const rules::campaign::EventChoice&					 choice,
		const std::optional<rules::campaign::ChoiceBlocker>& blocker,
		const rules::Content&								 content
	);

	[[nodiscard]] ChoiceIcons choiceIcons(const rules::campaign::EventChoice& choice);

	// What taking it paid and what the outcome landed on gave and took, line by line, the cards it gave aside (they're
	// drawn as cards): the cost, gains, losses, settlers, someone new, the card pick, an escort, structure, HP, the hours
	// and the fight it turned into.
	// `recruits` names whoever an outcome brought, takeEventChoice's; none says how many.
	[[nodiscard]] std::vector<LedgerLine> resultLines(
		const rules::campaign::EventChoice&	 choice,
		const rules::campaign::EventOutcome& outcome,
		const rules::Content&				 content,
		const std::vector<rules::DriverId>&	 recruits = {}
	);

	// The highway once an outcome's in: into its fight, to the reward, or on down the road.
	[[nodiscard]] std::string goLabel(const rules::campaign::EventOutcome& outcome);

	// "1.5 h".
	[[nodiscard]] std::string hoursText(double hours);

} // namespace game::event
