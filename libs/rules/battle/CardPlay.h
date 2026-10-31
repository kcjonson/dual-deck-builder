#pragma once

#include "BattleEvent.h"
#include "BattleState.h"

#include <rules/core/Card.h>
#include <rules/packs/Pack.h>

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace rules {

	// A fight's card as the content defines it, failing loud for one the content doesn't.
	[[nodiscard]] const CardDefinition& definitionOf(const Content& content, const CardId& card);

	// A card's face as played, base or upgraded.
	[[nodiscard]] int						 cardCost(const CardDefinition& card, bool upgraded);
	[[nodiscard]] const std::vector<Effect>& cardEffects(const CardDefinition& card, bool upgraded);
	[[nodiscard]] bool						 cardHasTag(const CardDefinition& card, bool upgraded, std::string_view tag);

	// What of this card the rules can't play yet: an effect, a condition, or a target they don't carry out.
	// Such a card is never a legal play, so nothing it does is silently skipped.
	[[nodiscard]] std::optional<std::string> unimplementedPart(const CardDefinition& card, bool upgraded);

	// Whether a card is played at a vehicle.
	[[nodiscard]] bool takesTarget(CardTarget target);

	// Whether a card lands on one person aboard a vehicle (Medical Kit), so a play names which.
	[[nodiscard]] bool picksOccupant(const std::vector<Effect>& effects);

	// A card played from `actor` by `caster`, at its target and occupant, if it takes them.
	struct CardPlay {
		DriverIndex					caster;
		VehicleIndex				actor;
		std::optional<VehicleIndex> target;
		std::optional<DriverIndex>	occupant;
	};

	// Why this card can't go at this target and occupant: who it may target, range, and who it lands on.
	[[nodiscard]] std::optional<std::string>
	targetBlocker(const BattleState& state, const CardDefinition& card, bool upgraded, const CardPlay& play);

	// Carries out a paid-for card's effects in order. The play has to have passed targetBlocker, and the card
	// unimplementedPart.
	void resolveCard(BattleState& state, const std::vector<Effect>& effects, const CardPlay& play, std::vector<Event>& events);

} // namespace rules
