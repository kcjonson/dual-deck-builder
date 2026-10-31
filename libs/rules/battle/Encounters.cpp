#include "Encounters.h"

#include <algorithm>
#include <stdexcept>
#include <string>

namespace rules {

	namespace {

		// The fewest raiders a lone driver meets, and the game stages per extra grow raider (Runs and Encounters).
		constexpr int kSoloLeast = 4;
		constexpr int kStagesPerGrowth = 2;

		int raidersIn(const std::vector<EncounterWave>& waves) {
			int raiders = 0;
			for (const EncounterWave& wave : waves) {
				raiders += static_cast<int>(wave.raiders.size());
			}
			return raiders;
		}

		std::vector<EncounterWave> sizedWaves(const EncounterDefinition& encounter, bool solo, int stage) {
			std::vector<EncounterWave> waves = encounter.waves;
			std::vector<OpponentId>&   last = waves.back().raiders;
			last.insert(last.end(), static_cast<size_t>(stage / kStagesPerGrowth), encounter.grow);
			if (!solo) {
				return waves;
			}
			const int total = raidersIn(waves);
			int		  cut = total - std::min(total, std::max(kSoloLeast, (total + 1) / 2));
			for (size_t index = waves.size(); index-- > 0 && cut > 0;) {
				std::vector<OpponentId>& raiders = waves[index].raiders;
				const int				 taken = std::min(cut, static_cast<int>(raiders.size()) - (index == 0 ? 1 : 0));
				raiders.resize(raiders.size() - static_cast<size_t>(taken));
				cut -= taken;
			}
			std::erase_if(waves, [](const EncounterWave& wave) { return wave.raiders.empty(); });
			return waves;
		}

	} // namespace

	std::vector<EncounterId> encountersFor(const Content& content, int skulls, int tier) {
		const auto forTier = [&](int band) {
			std::vector<EncounterId> ids;
			for (const auto& [id, encounter] : content.encounters) {
				if (encounter.skulls == skulls && std::ranges::find(encounter.tiers, band) != encounter.tiers.end()) {
					ids.push_back(id);
				}
			}
			return ids;
		};
		std::vector<EncounterId> own = forTier(tier);
		return own.empty() && tier == kMostTier ? forTier(kMostTier - 1) : own;
	}

	EncounterId pickEncounter(const Content& content, int skulls, int tier, uint32_t seed) {
		if (skulls < 1 || skulls > kMostSkulls || tier < 1 || tier > kMostTier) {
			throw std::invalid_argument(
				"pickEncounter: a fight has 1 to " + std::to_string(kMostSkulls) + " skulls, on tiers 1 to " + std::to_string(kMostTier)
			);
		}
		const std::vector<EncounterId> pool = encountersFor(content, skulls, tier);
		if (pool.empty()) {
			throw std::invalid_argument(
				"pickEncounter: no loaded pack has a " + std::to_string(skulls) + "-skull encounter for tier " + std::to_string(tier)
			);
		}
		RandomStreams	streams(seed);
		foundation::Rng rng = streams.next("encounter");
		return rng.pick(pool);
	}

	void fieldEncounter(BattleSetup& setup, const Content& content, const EncounterId& encounter, int stage) {
		const auto found = content.encounters.find(encounter);
		if (found == content.encounters.end()) {
			throw std::invalid_argument("fieldEncounter: no loaded pack defines encounter " + encounter.value);
		}
		if (stage < 0 || stage > kMostStage) {
			throw std::invalid_argument("fieldEncounter: game stage runs 0 to " + std::to_string(kMostStage));
		}
		if (setup.players.empty() || setup.players.size() > 2) {
			throw std::invalid_argument("fieldEncounter: an encounter is sized for one or two of the player's drivers");
		}
		std::vector<EncounterWave> waves = sizedWaves(found->second, setup.players.size() == 1, stage);
		setup.raiders.clear();
		for (const OpponentId& raider : waves.front().raiders) {
			setup.raiders.push_back(RaiderSeat{.opponent = raider, .slot = std::nullopt, .ambush = std::nullopt});
		}
		setup.waves.assign(waves.begin() + 1, waves.end());
		setup.roadCap = found->second.roadCap;
		setup.stage = stage;
	}

} // namespace rules
