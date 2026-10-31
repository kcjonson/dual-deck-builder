#include <rules/map/ParamValidator.h>

#include <gtest/gtest.h>

namespace {

	using namespace rules::map;

	MapParams mixed() {
		return environmentDefaults(5, Environment::Mixed);
	}

	TEST(ParamValidator, LeavesValidParamsAlone) {
		for (const EnvironmentSpec& environment : kEnvironments) {
			const MapParams			 params = environmentDefaults(5, environment.environment);
			const ValidatedMapParams validated = validateMapParams(params);
			EXPECT_TRUE(validated.clamps.empty()) << environment.label;
			EXPECT_EQ(validated.params, params);
		}
	}

	TEST(ParamValidator, ClampsEachValueIntoItsTuningRangeAndSaysSo) {
		MapParams params = mixed();
		params.radius = 5000;
		params.aridity = -0.5;
		const ValidatedMapParams validated = validateMapParams(params);
		EXPECT_EQ(validated.params.radius, 1600);
		EXPECT_EQ(validated.params.aridity, 0);
		ASSERT_EQ(validated.clamps.size(), 2U);
		EXPECT_EQ(validated.clamps[0], (ParamClamp{.param = "radius", .from = 5000, .to = 1600, .reason = "tuning range 600 to 1600"}));
		EXPECT_EQ(describeClamp(validated.clamps[1]), "aridity raised to 0 (tuning range 0 to 1)");
	}

	TEST(ParamValidator, RaisesHighwaysToStrongholdsPlusTwo) {
		MapParams params = mixed();
		params.strongholds = 5;
		params.highways = 5;
		const ValidatedMapParams validated = validateMapParams(params);
		EXPECT_EQ(validated.params.highways, 7);
		ASSERT_EQ(validated.clamps.size(), 1U);
		EXPECT_EQ(describeClamp(validated.clamps[0]), "highways raised to 7 (strongholds + 2)");
	}

	TEST(ParamValidator, LowersStrongholdsWhenEvenTheMostHighwaysCantMakeRoom) {
		MapParams params = mixed();
		params.strongholds = 8;
		params.highwaySeparation = 50;
		const ValidatedMapParams validated = validateMapParams(params);
		EXPECT_EQ(validated.params.strongholds, 7);
		EXPECT_EQ(validated.params.highways, 9);
		ASSERT_EQ(validated.clamps.size(), 3U);
		EXPECT_EQ(describeClamp(validated.clamps[0]), "strongholds lowered to 7 (highways max - 2)");
		EXPECT_EQ(describeClamp(validated.clamps[1]), "highways raised to 9 (strongholds + 2)");
		EXPECT_EQ(describeClamp(validated.clamps[2]), "highwaySeparation lowered to 40 (360 / highways)");
	}

	TEST(ParamValidator, FitsTheSeparationToTheHighways) {
		MapParams params = mixed();
		params.highways = 8;
		params.highwaySeparation = 60;
		const ValidatedMapParams validated = validateMapParams(params);
		EXPECT_EQ(validated.params.highwaySeparation, 45);
		EXPECT_EQ(validateMapParams(validated.params).clamps.size(), 0U);
	}

	TEST(ParamValidator, ReturnsAValidCombinationFromAnyCornerWhichASecondPassLeavesAlone) {
		for (const int strongholds : {0, 2, 5, 8, 20}) {
			for (const int highways : {-1, 3, 6, 9, 30}) {
				for (const int separation : {0, 20, 60, 400}) {
					MapParams params = mixed();
					params.strongholds = strongholds;
					params.highways = highways;
					params.highwaySeparation = separation;
					const ValidatedMapParams validated = validateMapParams(params);
					EXPECT_GE(validated.params.highways, validated.params.strongholds + 2);
					EXPECT_LE(validated.params.highways * validated.params.highwaySeparation, 360);
					EXPECT_TRUE(validateMapParams(validated.params).clamps.empty());
				}
			}
		}
	}

	TEST(ParamValidator, KeepsEveryCombinationOfCampaignValuesInsideTheCampaignRanges) {
		const NumberParamSpec& strongholds = paramSpec(NumberParam::Strongholds);
		const NumberParamSpec& highways = paramSpec(NumberParam::Highways);
		const NumberParamSpec& separation = paramSpec(NumberParam::HighwaySeparation);
		for (auto s = static_cast<int>(strongholds.campaign.min); s <= strongholds.campaign.max; ++s) {
			for (auto h = static_cast<int>(highways.campaign.min); h <= highways.campaign.max; ++h) {
				for (auto d = static_cast<int>(separation.campaign.min); d <= separation.campaign.max; ++d) {
					MapParams params = mixed();
					params.strongholds = s;
					params.highways = h;
					params.highwaySeparation = d;
					const MapParams valid = validateMapParams(params).params;
					EXPECT_LE(valid.highways, highways.campaign.max);
					EXPECT_GE(valid.highwaySeparation, separation.campaign.min);
				}
			}
		}
	}

} // namespace
