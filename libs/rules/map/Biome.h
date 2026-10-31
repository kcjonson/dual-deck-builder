#pragma once

#include <rules/core/JsonReader.h>

namespace rules::map {

	// The regions the lore names (Area Map Generation, Pipeline, 3. Biomes, hazards, and cost), read off the
	// land's and the water's fields, as categories the game reads: stop tables, POI types, faction fit. The
	// map never paints them; its colour blends the fields. Ruins aren't a biome; they lie over whatever land
	// they stand on.
	enum class Biome { Scrub, Desert, Mire, Badlands, Canyons, Mountains };

	inline constexpr EnumNames<Biome, 6> kBiomeNames{{
		{"scrub", Biome::Scrub},
		{"desert", Biome::Desert},
		{"mire", Biome::Mire},
		{"badlands", Biome::Badlands},
		{"canyons", Biome::Canyons},
		{"mountains", Biome::Mountains},
	}};

	// The fields a biome is read from, each 0 to 1.
	struct BiomeFields {
		// 1 on the river or lake the ground drains to, 0.5 at the map's lowland level above it.
		double lowland{0};
		double moisture{0};
		double contamination{0};
		// 1 in range country, its ridges and valleys alike.
		double mountains{0};
		// 1 deep in a river valley cut into dry country.
		double canyons{0};
		// 1 on the most broken ground outside the ranges.
		double badlands{0};
	};

	// Where each biome starts: terrain-fields.md's, for the Map Lab to tune. The parameters move the fields,
	// not these. Mire is wet, low ground, contamination counting toward wet at `mireContamination`.
	struct BiomeThresholds {
		double mountains = 0.5;
		double canyons = 0.5;
		double mireWetness = 0.75;
		double mireContamination = 0.25;
		double mireLowland = 0.5;
		double badlands = 0.5;
		// Badlands wetter than this aren't.
		double badlandsMoisture = 0.6;
		// Drier than this is desert.
		double desertMoisture = 0.3;
	};

	inline constexpr BiomeThresholds kBiomeThresholds;

	// First match wins: mountains, canyons, mire, badlands, desert, and scrub for the middling rest.
	[[nodiscard]] Biome classifyBiome(const BiomeFields& fields);

} // namespace rules::map
