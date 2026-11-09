#pragma once

// The hand's targeting rules (targeting-preview.md, slot-targeting.md, hand-target-preview.md) over the plays
// legalActions offers, so the screen can't offer a play apply would refuse: a card's steps, the picks open at each, the
// legal action the picks make, and what it would do, read off apply on a copy of the fight. It never reads what a card's
// effects do; the one thing it takes from a card's shape is the order of its steps (a caster's own picked move before its
// target, a target's picked move after it), which the plays on offer can't say.

#include "scenes/battle/BattleAim.h"

#include <rules/battle/BattleAction.h>
#include <rules/battle/BattleState.h>
#include <rules/packs/Pack.h>

#include <cstddef>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace game::battle {

	class Targeting {
	  public:
		// Over the fight as it stands and legalActions' list for it, both of which must outlive it; the scene makes a new
		// one after every action.
		Targeting(const rules::BattleState& state, const rules::Content& content, std::span<const rules::Action> legal);

		// Some legal play uses it, so it can be picked up.
		[[nodiscard]] bool playable(HandCard card) const;
		// Its driver has the adrenaline for it.
		[[nodiscard]] bool affordable(HandCard card) const;
		// The strip across a card its driver can pay for but can't play (call 366): NO ATTACKS for a passenger's attack,
		// NO TARGET for a card with nothing it could pick, CAN'T PLAY for the rest; none for a playable card or an
		// unaffordable one, whose cost goes dark red instead.
		[[nodiscard]] std::optional<std::string> blockLabel(HandCard card) const;

		// Its steps in order; empty for a card that takes no pick and plays wherever it's dropped on the road.
		[[nodiscard]] std::vector<AimStep> steps(HandCard card) const;
		// The picks open at the step after `picked`, in legalActions' order; empty once the picks are complete. A slot step
		// the plays don't need (Shoulder Check on a raider boxed in) is skipped.
		[[nodiscard]] std::vector<AimPick> options(HandCard card, std::span<const AimPick> picked) const;
		// The index into legal of the play the picks make, once they're complete; none before.
		[[nodiscard]] std::optional<size_t> action(HandCard card, std::span<const AimPick> picked) const;
		// What the play would do with the picks: complete, or as far as they go, for the first legal play they could still
		// make. Worked out once per card and picks.
		[[nodiscard]] AimPreview preview(HandCard card, std::span<const AimPick> picked) const;
		// Whether every legal play of the card does the same to the road, so its preview's arrows are solid; otherwise
		// they hang on a pick and draw dotted.
		[[nodiscard]] bool certain(HandCard card) const;
		// Each raider on the road's range from where the card would act with the picks so far, the last of them perhaps
		// the one under the pointer; empty for a card that lands only on the player's side.
		[[nodiscard]] std::vector<RangeChip> ranges(HandCard card, std::span<const AimPick> picked) const;

	  private:
		const rules::BattleState&	   state;
		const rules::Content&		   content;
		std::span<const rules::Action> legal;
		// Everything below is the implementer's to change.

		// How far a card's picks take its legal plays: the plays they still allow, by index into legal, and the step
		// waiting on its pick, none once they're complete. A pick no play allows leaves no plays.
		struct Walk {
			std::vector<size_t>	   plays;
			std::optional<AimStep> open;
		};

		[[nodiscard]] const rules::BattleCard*		 inHand(HandCard card) const;
		[[nodiscard]] const std::vector<size_t>&	 playsOf(HandCard card) const;
		[[nodiscard]] const rules::action::PlayCard& playAt(size_t index) const;
		[[nodiscard]] Walk							 walk(HandCard card, std::span<const AimPick> picked) const;
		// What one legal play does, off apply on a copy, worked out once.
		[[nodiscard]] const AimPreview& playPreview(size_t index) const;
		// The range to a raider at `at` for a card the escorts carry out: from the order's carrier for the play aimed there,
		// or else the nearest ready escort that could carry it.
		[[nodiscard]] int escortRange(HandCard card, std::optional<size_t> aimedAt, rules::RoadSlot at) const;

		// Each card's legal plays, by driver and place in hand.
		std::map<std::pair<int, int>, std::vector<size_t>> plays;
		mutable std::map<size_t, AimPreview>			   previews;
		mutable std::map<std::pair<int, int>, bool>		   certainty;
	};

} // namespace game::battle
