#pragma once

#include <ai/OpponentPolicies.h>
#include <rules/campaign/CampaignRules.h>
#include <rules/campaign/Events.h>
#include <rules/map/AreaMapPipeline.h>
#include <rules/map/RouteDescriptors.h>
#include <rules/packs/Pack.h>

#include <filesystem>
#include <memory>
#include <vector>

namespace game {

	// Everything the game reads from its packs, loaded once at launch and read by every scene through the context
	// (game-app.md). The packs are the base pack alone until mods load.
	struct GameRules {
		explicit GameRules(const std::filesystem::path& packsDirectory);

		GameRules(const GameRules&) = delete;
		GameRules& operator=(const GameRules&) = delete;
		GameRules(GameRules&&) = delete;
		GameRules& operator=(GameRules&&) = delete;

		rules::Content				   content;
		rules::campaign::CampaignRules campaign;
		rules::campaign::Events		   events;
		// Every opponent's behavior bound to its policy, which the battle plans the raiders' turns with.
		ai::OpponentPolicies raiders;
		// What founding deals the pool from, and a find or an event turns someone new up from.
		std::vector<rules::DriverId> unlocked;
		rules::map::MapContent		 mapContent;
		rules::map::RouteTuning		 routes;
	};

	// Throws a rules::ContentError naming the file for anything the packs get wrong.
	[[nodiscard]] std::unique_ptr<GameRules> loadGameRules(const std::filesystem::path& packsDirectory);

} // namespace game
