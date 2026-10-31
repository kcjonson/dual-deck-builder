#include <rules/map/RollParams.h>

#include <gtest/gtest.h>

#include <set>

namespace {

	using namespace rules::map;

	constexpr uint32_t kSeeds = 400;

	TEST(RollParams, RollsTheSameParamsForTheSameSeedAndOthersForOthers) {
		const ValidatedMapParams first = rollParams(2183746551);
		EXPECT_EQ(first.params, rollParams(2183746551).params);
		EXPECT_EQ(first.params.seed, 2183746551U);
		EXPECT_NE(first.params, rollParams(2183746552).params);
	}

	TEST(RollParams, LandsEveryValueInItsCampaignRangeOnItsStepWithinReachOfItsEnvironmentsValue) {
		for (uint32_t seed = 0; seed < kSeeds; ++seed) {
			const MapParams params = rollParams(seed).params;
			const MapParams centres = environmentDefaults(seed, params.environment);
			for (const NumberParamSpec& spec : kNumberParams) {
				const double value = paramValue(params, spec);
				EXPECT_GE(value, spec.campaign.min) << spec.key << " on seed " << seed;
				EXPECT_LE(value, spec.campaign.max) << spec.key << " on seed " << seed;
				EXPECT_EQ(snapToStep(spec.step, value), value) << spec.key << " on seed " << seed;
				if (spec.param == NumberParam::Highways) {
					continue;
				}
				const RollBounds bounds = rollBounds(spec, paramValue(centres, spec));
				const double	 halfStep = static_cast<double>(spec.step.units) / spec.step.perUnit / 2;
				EXPECT_GE(value, bounds.min - halfStep - 1e-9) << spec.key << " on seed " << seed;
				EXPECT_LE(value, bounds.max + halfStep + 1e-9) << spec.key << " on seed " << seed;
			}
		}
	}

	TEST(RollParams, RollsEveryEnvironmentAndKeepsRouteSplitAtItsOneCampaignValue) {
		std::set<Environment> rolled;
		for (uint32_t seed = 0; seed < kSeeds; ++seed) {
			const MapParams params = rollParams(seed).params;
			rolled.insert(params.environment);
			EXPECT_EQ(params.routeSplit, 0.5);
			EXPECT_EQ(params.routesTarget, 3);
		}
		EXPECT_EQ(rolled.size(), kEnvironments.size());
	}

	TEST(RollParams, SpreadsValuesEitherSideOfTheEnvironmentsValue) {
		int below = 0;
		int above = 0;
		for (uint32_t seed = 0; seed < kSeeds; ++seed) {
			const MapParams params = rollParams(seed).params;
			const double	centre = environmentDefaults(seed, params.environment).aridity;
			below += params.aridity < centre ? 1 : 0;
			above += params.aridity > centre ? 1 : 0;
		}
		EXPECT_GT(below, static_cast<int>(kSeeds) / 4);
		EXPECT_GT(above, static_cast<int>(kSeeds) / 4);
	}

	TEST(RollParams, ReportsTheValidatorsOnlyChangeHighwaysRaisedInAboutOneRollInFive) {
		int raised = 0;
		for (uint32_t seed = 0; seed < kSeeds; ++seed) {
			const ValidatedMapParams rolled = rollParams(seed);
			for (const ParamClamp& clamp : rolled.clamps) {
				EXPECT_EQ(clamp.param, "highways") << "seed " << seed;
				EXPECT_EQ(clamp.reason, "strongholds + 2");
			}
			raised += rolled.clamps.empty() ? 0 : 1;
		}
		EXPECT_GT(raised, static_cast<int>(kSeeds) / 10);
		EXPECT_LT(raised, static_cast<int>(kSeeds) * 3 / 10);
	}

	TEST(RollBoundsTest, ReachesHalfTheCampaignRangeEitherSideCutToTheRange) {
		const NumberParamSpec& aridity = paramSpec(NumberParam::Aridity);
		const RollBounds	   middle = rollBounds(aridity, 0.5);
		EXPECT_DOUBLE_EQ(middle.min, 0.1);
		EXPECT_DOUBLE_EQ(middle.max, 0.9);
		const RollBounds dry = rollBounds(aridity, 0.15);
		EXPECT_DOUBLE_EQ(dry.min, 0.1);
		EXPECT_DOUBLE_EQ(dry.centre, 0.15);
		EXPECT_DOUBLE_EQ(dry.max, 0.55);
		const RollBounds outside = rollBounds(aridity, 2);
		EXPECT_DOUBLE_EQ(outside.centre, 0.9);
		EXPECT_DOUBLE_EQ(outside.min, 0.5);
		EXPECT_DOUBLE_EQ(outside.max, 0.9);
	}

} // namespace
