#pragma once

#include "CampaignStore.h"
#include "GameRules.h"
#include "Session.h"

#include <cstdint>
#include <functional>
#include <optional>

namespace game {

	// The game's state that outlives a scene, the App's context object (salal app-api.md, Game state and saves), which
	// every scene reaches as app.context<GameContext>(): the packs, the save, the campaign being played and its map,
	// and the seams a test swaps, how maps are made and where a new campaign's seed comes from.
	struct GameContext {
		const GameRules& rules;
		CampaignStore	 store;
		MapMakers		 maps;
		// A new campaign's seed; foundation::freshSeed() in the game.
		std::function<uint32_t()> newSeed;
		// Set by founding and Continue, cleared when the campaign ends or the menu leaves it.
		std::optional<Session> session;
	};

} // namespace game
