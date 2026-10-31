#include <rules/map/Biome.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules::map;

	constexpr BiomeFields kMiddling{.lowland = 0.2, .moisture = 0.45, .contamination = 0.1, .mountains = 0, .canyons = 0, .badlands = 0};

	BiomeFields with(BiomeFields fields, double BiomeFields::* field, double value) {
		fields.*field = value;
		return fields;
	}

	TEST(Biome, CallsMiddlingGroundScrub) {
		EXPECT_EQ(classifyBiome(kMiddling), Biome::Scrub);
	}

	TEST(Biome, ReadsEachBiomeFromItsFieldAtItsThreshold) {
		EXPECT_EQ(classifyBiome(with(kMiddling, &BiomeFields::mountains, 0.5)), Biome::Mountains);
		EXPECT_EQ(classifyBiome(with(kMiddling, &BiomeFields::mountains, 0.49)), Biome::Scrub);
		EXPECT_EQ(classifyBiome(with(kMiddling, &BiomeFields::canyons, 0.5)), Biome::Canyons);
		EXPECT_EQ(classifyBiome(with(kMiddling, &BiomeFields::badlands, 0.5)), Biome::Badlands);
		EXPECT_EQ(classifyBiome(with(kMiddling, &BiomeFields::moisture, 0.29)), Biome::Desert);
		const BiomeFields low = with(kMiddling, &BiomeFields::lowland, 0.5);
		EXPECT_EQ(classifyBiome(with(low, &BiomeFields::moisture, 0.75)), Biome::Mire);
		EXPECT_EQ(classifyBiome(with(low, &BiomeFields::moisture, 0.7)), Biome::Scrub);
	}

	TEST(Biome, CountsContaminationTowardWetForMireAndKeepsBadlandsDry) {
		const BiomeFields low = with(with(kMiddling, &BiomeFields::lowland, 0.6), &BiomeFields::moisture, 0.6);
		EXPECT_EQ(classifyBiome(with(low, &BiomeFields::contamination, 0.6)), Biome::Mire);
		EXPECT_EQ(classifyBiome(with(low, &BiomeFields::contamination, 0.5)), Biome::Scrub);
		const BiomeFields broken = with(kMiddling, &BiomeFields::badlands, 0.9);
		EXPECT_EQ(classifyBiome(with(broken, &BiomeFields::moisture, 0.6)), Biome::Scrub);
	}

	TEST(Biome, TakesTheFirstMatchMountainsCanyonsMireBadlandsDesert) {
		const BiomeFields everything{.lowland = 1, .moisture = 0.1, .contamination = 1, .mountains = 1, .canyons = 1, .badlands = 1};
		EXPECT_EQ(classifyBiome(everything), Biome::Mountains);
		EXPECT_EQ(classifyBiome(with(everything, &BiomeFields::mountains, 0)), Biome::Canyons);
		const BiomeFields open = with(with(everything, &BiomeFields::mountains, 0), &BiomeFields::canyons, 0);
		EXPECT_EQ(classifyBiome(with(open, &BiomeFields::moisture, 0.8)), Biome::Mire);
		EXPECT_EQ(classifyBiome(open), Biome::Badlands);
		EXPECT_EQ(classifyBiome(with(with(open, &BiomeFields::lowland, 0), &BiomeFields::badlands, 0)), Biome::Desert);
	}

} // namespace
