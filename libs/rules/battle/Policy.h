#pragma once

#include "BattleAction.h"
#include "BattleState.h"

#include <rules/packs/Pack.h>

#include <random/Rng.h>

#include <functional>
#include <span>

namespace rules {

	// How a raider plans its coming turn, one card at a time (rules-ai-and-packs.md). libs/ai implements policies;
	// the rules only ever call this, and never include or link the AI.
	class Policy {
	  public:
		Policy() = default;
		Policy(const Policy&) = delete;
		Policy& operator=(const Policy&) = delete;
		Policy(Policy&&) = delete;
		Policy& operator=(Policy&&) = delete;
		virtual ~Policy() = default;

		// The acting raider's next step on `board`, the enemy turn rehearsed on a copy of the fight with its earlier
		// steps already played out: one of `actions`, its legal actions there, EndTurn last, which ends its plan.
		// It may play candidates out with apply on copies of `board`; anything random draws from `rng`.
		[[nodiscard]] virtual Action
		choose(const BattleState& board, const Content& content, std::span<const Action> actions, foundation::Rng& rng) const = 0;
	};

	// The policy the raider in this seat of `board` plans with. Raiders arriving in a later wave take new seats, so a
	// binding reads the seat off the board it's asked about rather than the fight it started with.
	using PolicyFor = std::function<const Policy&(const BattleState& board, DriverIndex raider)>;

} // namespace rules
