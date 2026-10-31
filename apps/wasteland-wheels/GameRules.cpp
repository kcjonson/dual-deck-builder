#include "GameRules.h"

#include <rules/campaign/Founding.h>

#include <array>

namespace game {

	namespace {

		std::filesystem::path basePack(const std::filesystem::path& packsDirectory) {
			return packsDirectory / "base";
		}

		rules::Content loadContent(const std::filesystem::path& packsDirectory) {
			const std::array<std::filesystem::path, 1> roots{basePack(packsDirectory)};
			return rules::loadPacks(roots);
		}

	} // namespace

	GameRules::GameRules(const std::filesystem::path& packsDirectory)
		: content(loadContent(packsDirectory)),
		  campaign(rules::campaign::loadCampaignRules(content)),
		  events(rules::campaign::loadEvents(content)),
		  raiders(content),
		  unlocked(rules::campaign::unlockedAtStart(content)),
		  mapContent(rules::map::readMapContent(basePack(packsDirectory))),
		  routes(rules::map::readRouteTuning(basePack(packsDirectory) / "map" / "routes.json")) {}

	std::unique_ptr<GameRules> loadGameRules(const std::filesystem::path& packsDirectory) {
		return std::make_unique<GameRules>(packsDirectory);
	}

} // namespace game
