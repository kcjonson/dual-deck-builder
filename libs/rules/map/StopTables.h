#pragma once

#include "Biome.h"
#include "MoveCost.h"
#include "StopData.h"

#include <array>
#include <filesystem>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace rules::map {

	// No one's ground, the one territory every stop is on until stage 8 gives the strongholds theirs.
	inline constexpr std::string_view kNoTerritory = "none";

	// The stop tables, compiled (Area Map Generation, 9. Stops; stops-and-routes.md, Types and the stop tables): for
	// each road class, biome, tier, and territory, a weight per type, its class's weight times its biome's, tier's,
	// and territory's multipliers, 1 where one leaves it out. A type the run can't resolve weighs 0 whatever the
	// tables give it. Built once, when the pack is read, so a draw is a search of one row.
	class StopTables {
	  public:
		struct Weights {
			// By RoadClass, a weight per StopType, 0 where left out.
			std::array<std::array<double, kStopTypeCount>, 3> classes{};
			// By Biome, by tier from 1, and by territory, a multiplier per StopType, 1 where left out.
			std::array<std::array<double, kStopTypeCount>, 6>		   biomes{};
			std::array<std::array<double, kStopTypeCount>, kStopTiers> tiers{};
			std::vector<std::array<double, kStopTypeCount>>			   territories;
		};

		// Fails with a ContentError, naming `where` and the row, on any row that weighs no fight or no calm type the
		// run resolves, so a stop would have nothing to be.
		StopTables(const Weights& weights, std::vector<std::string> territories, const std::string& where);

		// By name, as the JSON object reads.
		[[nodiscard]] std::span<const std::string> territories() const { return names; }
		// A territory's index, which draws take; asserts on one the tables don't have.
		[[nodiscard]] int territory(std::string_view name) const;

		// The type `draw`, in [0, 1), picks at a stop: a fight, or a calm type.
		[[nodiscard]] StopType draw(RoadClass roadClass, Biome biome, int tier, int territory, double draw, bool fight) const;

	  private:
		std::vector<std::string> names;
		// Per row, cumulative over the types in StopType order: fights in one, calm types in the other.
		std::vector<std::array<double, kStopTypeCount>> fights;
		std::vector<std::array<double, kStopTypeCount>> calms;

		[[nodiscard]] size_t rowOf(RoadClass roadClass, Biome biome, int tier, int territory) const;
	};

	// A pack's map/stop-tables.json: {"classes": {class: {type: weight}}, "biomes", "tiers", and "territories", each
	// {key: {type: multiplier}}}, every class given, territories holding "none", and every number at least 0.
	// Anything else, or a row with nothing to draw, fails with a ContentError naming the file and the field.
	[[nodiscard]] StopTables readStopTables(const std::filesystem::path& file);

} // namespace rules::map
