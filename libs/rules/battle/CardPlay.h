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

	// Whether a card's move goes to a slot the player picks (Juke, Strafe, Shoulder Check), so a play names it.
	[[nodiscard]] bool picksSlot(const std::vector<Effect>& effects);

	// Why the caster's own moves on this card can't happen, whatever it's played at: a flank from the shoulder
	// or boxed in, a swerve from the shoulder or with nowhere to go, a drop-back with no slot to go to, or a
	// swap with nobody to swap with (calls 285 and 341).
	[[nodiscard]] std::optional<std::string>
	moveBlocker(const BattleState& state, const CardDefinition& card, bool upgraded, DriverIndex caster);

	// A card played from `actor` by `caster`, at its target, occupant, and slot, if it takes them.
	struct CardPlay {
		DriverIndex					caster;
		VehicleIndex				actor;
		std::optional<VehicleIndex> target;
		std::optional<DriverIndex>	occupant;
		std::optional<RoadSlot>		destination;
	};

	// Why this card can't go at this target, occupant, and slot: who it may target, whether its moves can happen
	// and range from where they leave the caster, and who it lands on.
	[[nodiscard]] std::optional<std::string>
	targetBlocker(const BattleState& state, const CardDefinition& card, bool upgraded, const CardPlay& play);

	// Whether any of a card's effects lands on its target; a flank's target is only the vehicle it outruns.
	[[nodiscard]] bool landsOnTarget(const CardDefinition& card, bool upgraded);

	// An order at a raider, which the nearest ready escort that can carry it out does (Combat Rules, Orders).
	[[nodiscard]] bool isAttackOrder(const CardDefinition& card, bool upgraded);

	// Rally the Convoy: every ready escort fires at its own raider.
	[[nodiscard]] bool isRally(const CardDefinition& card, bool upgraded);

	// The escort that carries out an attack order at the play's target: the nearest ready one on the caster's side,
	// of the card's type for a signature order, that the play is legal from, ties to the inside lane, the outside,
	// then the other side's shoulder, and ahead, center, behind. None when no escort can.
	[[nodiscard]] std::optional<VehicleIndex>
	orderCarrier(const BattleState& state, const CardDefinition& card, bool upgraded, const CardPlay& play);

	// The ready escorts on a side, in the order Rally the Convoy fires them: the convoy's in roster order, then
	// vehicles carrying on as escorts (escorts.md, decision 42).
	[[nodiscard]] std::vector<VehicleIndex> rallyingEscorts(const BattleState& state, Side side);

	// Each ready escort fires the card at its nearest raider it reaches, picked again for each, then every escort
	// is spent.
	void resolveRally(BattleState& state, const CardDefinition& card, bool upgraded, DriverIndex caster, std::vector<Event>& events);

	// Where the card's own moves leave the caster, if they move it: what a plan names for a raider's move.
	[[nodiscard]] std::optional<RoadSlot>
	movesCasterTo(const BattleState& state, const CardDefinition& card, bool upgraded, const CardPlay& play);

	// Carries out a paid-for card's effects in order. The play has to have passed targetBlocker, and the card
	// unimplementedPart.
	void resolveCard(BattleState& state, const std::vector<Effect>& effects, const CardPlay& play, std::vector<Event>& events);

} // namespace rules
