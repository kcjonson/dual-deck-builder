#include <rules/map/MapParams.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <variant>

namespace {

	using namespace rules::map;

	bool onGrid(const NumberParamSpec& spec, double value) {
		return snapToStep(spec.step, value) == value;
	}

	bool inside(const ParamRange& outer, const ParamRange& inner) {
		return outer.min <= inner.min && inner.max <= outer.max && inner.min <= inner.max;
	}

	double stepOf(const NumberParamSpec& spec) {
		return static_cast<double>(spec.step.units) / spec.step.perUnit;
	}

	TEST(MapParams, TakesWholeNumbersForCountsDegreesRadiusAndTiersAndFractionsForTheRest) {
		for (const NumberParamSpec& spec : kNumberParams) {
			const bool whole = std::holds_alternative<int MapParams::*>(spec.field);
			EXPECT_EQ(whole, spec.step.perUnit == 1) << spec.key;
		}
		EXPECT_TRUE(std::holds_alternative<int MapParams::*>(paramSpec(NumberParam::HighwaySeparation).field));
		EXPECT_TRUE(std::holds_alternative<double MapParams::*>(paramSpec(NumberParam::DaylightHours).field));
	}

	TEST(MapParams, KeepsDefaultsAndCampaignRangesInsideTheTuningRangesOnTheStepGrid) {
		for (const NumberParamSpec& spec : kNumberParams) {
			EXPECT_TRUE(inside(spec.tuning, spec.campaign)) << spec.key;
			EXPECT_GE(spec.defaultValue, spec.campaign.min) << spec.key;
			EXPECT_LE(spec.defaultValue, spec.campaign.max) << spec.key;
			for (const double value : {spec.tuning.min, spec.tuning.max, spec.campaign.min, spec.campaign.max, spec.defaultValue}) {
				EXPECT_TRUE(onGrid(spec, value)) << spec.key << " " << value;
			}
		}
	}

	TEST(MapParams, SnapsToTheGridWithNoFloatNoise) {
		const NumberParamSpec& aridity = paramSpec(NumberParam::Aridity);
		EXPECT_EQ(snapToStep(aridity.step, 0.1499), 0.15);
		EXPECT_EQ(snapToStep(aridity.step, 0.0251), 0.05);
		EXPECT_EQ(snapToStep(paramSpec(NumberParam::Radius).step, 1024), 1000);
		EXPECT_EQ(snapToStep(paramSpec(NumberParam::DaylightHours).step, 13.3), 13.5);
	}

	TEST(MapParams, LetsEnvironmentsSetTheLandNeverTheRulesEachValueAStepInsideItsCampaignRange) {
		for (const EnvironmentSpec& environment : kEnvironments) {
			for (const ParamValue& value : environment.values) {
				const NumberParamSpec& spec = paramSpec(value.param);
				EXPECT_NE(spec.group, ParamGroup::Gameplay) << environment.label << " sets " << spec.key;
				EXPECT_TRUE(onGrid(spec, value.value)) << environment.label << " " << spec.key;
				EXPECT_NE(value.value, spec.defaultValue) << environment.label << " sets " << spec.key << " to the default";
				const bool	 onPurpose = environment.environment == Environment::HighDesert && value.param == NumberParam::Lakes;
				const double step = stepOf(spec);
				EXPECT_GE(value.value, spec.campaign.min + (onPurpose ? 0 : step) - 1e-9) << environment.label << " " << spec.key;
				EXPECT_LE(value.value, spec.campaign.max - step + 1e-9) << environment.label << " " << spec.key;
			}
		}
		EXPECT_TRUE(environmentSpec(Environment::Mixed).values.empty());
	}

	TEST(MapParams, PutsEveryCampaignEndWithinReachOfSomeEnvironmentsValue) {
		for (const NumberParamSpec& spec : kNumberParams) {
			const double reach = (spec.campaign.max - spec.campaign.min) / 2;
			bool		 lowReached = false;
			bool		 highReached = false;
			for (const EnvironmentSpec& environment : kEnvironments) {
				const double value = paramValue(environmentDefaults(0, environment.environment), spec);
				lowReached = lowReached || value - reach <= spec.campaign.min + 1e-9;
				highReached = highReached || value + reach >= spec.campaign.max - 1e-9;
			}
			EXPECT_TRUE(lowReached && highReached) << spec.key;
		}
	}

	TEST(MapParams, FillsAnEnvironmentsDefaultsOverTheTables) {
		const MapParams mixed = environmentDefaults(7, Environment::Mixed);
		EXPECT_EQ(mixed.seed, 7U);
		for (const NumberParamSpec& spec : kNumberParams) {
			EXPECT_EQ(paramValue(mixed, spec), spec.defaultValue) << spec.key;
		}
		const MapParams desert = environmentDefaults(7, Environment::HighDesert);
		EXPECT_EQ(desert.environment, Environment::HighDesert);
		EXPECT_EQ(desert.aridity, 0.15);
		EXPECT_EQ(desert.lakes, 0);
		EXPECT_EQ(desert.radius, 1000);
		EXPECT_EQ(desert.strongholds, mixed.strongholds);
	}

	TEST(MapParams, LetsAnOverrideWinOverTheEnvironmentAndTheTable) {
		MapParamSet set{.seed = 3, .environment = Environment::Floodlands, .overrides = {}};
		set.overrides[static_cast<size_t>(NumberParam::Lakes)] = 1;
		set.overrides[static_cast<size_t>(NumberParam::Radius)] = 5000;
		const MapParams params = resolveMapParams(set);
		EXPECT_EQ(params.lakes, 1);
		EXPECT_EQ(params.radius, 5000);
		EXPECT_EQ(params.riverMeander, 0.75);
		EXPECT_EQ(params.towns, 5);
	}

} // namespace
