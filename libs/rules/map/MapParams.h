#pragma once

#include <rules/core/JsonReader.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <span>
#include <string_view>
#include <variant>

namespace rules::map {

	// In the Map Lab's order. rollParams picks one by its place here, so reordering moves which
	// environment a seed rolls, and with it every number.
	enum class Environment { HighDesert, RustBelt, Floodlands, Badlands, Mixed };

	inline constexpr EnumNames<Environment, 5> kEnvironmentNames{{
		{"highDesert", Environment::HighDesert},
		{"rustBelt", Environment::RustBelt},
		{"floodlands", Environment::Floodlands},
		{"badlands", Environment::Badlands},
		{"mixed", Environment::Mixed},
	}};

	enum class ParamGroup { World, Network, Gameplay, Dressing };

	// Everything generation reads (Area Map Generation, Map parameters), flat, as the spec names it.
	// kNumberParams describes each number. Build one with environmentDefaults or resolveMapParams, and
	// run generation on what validateMapParams returns.
	struct MapParams {
		uint32_t	seed{0};
		Environment environment{Environment::Mixed};

		// World units.
		int	   radius{0};
		double aridity{0};
		double mountainCoverage{0};
		double ruggedness{0};
		// Outlets on the land grid's edge: the main rivers. 0 is a closed basin.
		int	   rivers{0};
		double riverDensity{0};
		double riverMeander{0};
		int	   lakes{0};
		double contamination{0};
		int	   hotspots{0};
		// The metro's radius as a share of `radius`.
		double metroSize{0};
		int	   towns{0};
		int	   villages{0};

		int highways{0};
		// Degrees between neighbouring highway exits at the rim.
		int	   highwaySeparation{0};
		double roadDensity{0};
		double loops{0};
		double curviness{0};
		double trailShare{0};
		int	   brokenHighways{0};

		int	   strongholds{0};
		double poiDensity{0};
		int	   routesTarget{0};
		double routeSplit{0};
		// Tiers.
		int	   startingReveal{0};
		double stopDensity{0};
		double dangerCurve{0};
		int	   driverFinds{0};
		double daylightHours{0};
		double travelPace{0};

		double dressing{0};
		double streetGrids{0};
		int	   railLines{0};

		bool operator==(const MapParams&) const = default;
	};

	// Every number in MapParams, in table order.
	enum class NumberParam {
		Radius,
		Aridity,
		MountainCoverage,
		Ruggedness,
		Rivers,
		RiverDensity,
		RiverMeander,
		Lakes,
		Contamination,
		Hotspots,
		MetroSize,
		Towns,
		Villages,
		Highways,
		HighwaySeparation,
		RoadDensity,
		Loops,
		Curviness,
		TrailShare,
		BrokenHighways,
		Strongholds,
		PoiDensity,
		RoutesTarget,
		RouteSplit,
		StartingReveal,
		StopDensity,
		DangerCurve,
		DriverFinds,
		DaylightHours,
		TravelPace,
		Dressing,
		StreetGrids,
		RailLines,
	};

	inline constexpr size_t kNumberParamCount = 33;

	struct ParamRange {
		double min{0};
		double max{0};
	};

	// A control's increment, `units` over `perUnit`: radius steps by 50 / 1, aridity by 1 / 20. A snapped
	// value is a whole number of units divided by perUnit, which rounds exactly, so 3 / 20 reads as 0.15
	// where 3 * 0.05 would read 0.15000000000000002.
	struct StepGrid {
		int units{1};
		int perUnit{1};
	};

	// Whole numbers are int fields, fractions double ones.
	using ParamField = std::variant<int MapParams::*, double MapParams::*>;

	struct NumberParamSpec {
		NumberParam		 param{};
		std::string_view key;
		std::string_view label;
		ParamGroup		 group{};
		ParamField		 field;
		// What the Map Lab allows and the guarantees must survive.
		ParamRange tuning;
		StepGrid   step;
		// When the environment doesn't set one. Mixed sets none, so these are Mixed's.
		double defaultValue{0};
		// What rollParams draws from: inside the tuning range, and round every environment's value.
		ParamRange campaign;
	};

	// The spec's table, its starting values for the Map Lab to settle. A roll centres on the environment's
	// value and reaches at most half the campaign range either side, so each campaign range holds every
	// environment's value and has each end within that reach of one of them.
	inline constexpr std::array<NumberParamSpec, kNumberParamCount> kNumberParams{{
		{.param = NumberParam::Radius,
		 .key = "radius",
		 .label = "Radius",
		 .group = ParamGroup::World,
		 .field = &MapParams::radius,
		 .tuning = {600, 1600},
		 .step = {50, 1},
		 .defaultValue = 1000,
		 .campaign = {800, 1200}},
		{.param = NumberParam::Aridity,
		 .key = "aridity",
		 .label = "Aridity",
		 .group = ParamGroup::World,
		 .field = &MapParams::aridity,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.5,
		 .campaign = {0.1, 0.9}},
		{.param = NumberParam::MountainCoverage,
		 .key = "mountainCoverage",
		 .label = "Mountains",
		 .group = ParamGroup::World,
		 .field = &MapParams::mountainCoverage,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.25,
		 .campaign = {0.05, 0.45}},
		{.param = NumberParam::Ruggedness,
		 .key = "ruggedness",
		 .label = "Ruggedness",
		 .group = ParamGroup::World,
		 .field = &MapParams::ruggedness,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.5,
		 .campaign = {0.15, 0.85}},
		{.param = NumberParam::Rivers,
		 .key = "rivers",
		 .label = "Main rivers",
		 .group = ParamGroup::World,
		 .field = &MapParams::rivers,
		 .tuning = {0, 6},
		 .step = {1, 1},
		 .defaultValue = 2,
		 .campaign = {0, 5}},
		{.param = NumberParam::RiverDensity,
		 .key = "riverDensity",
		 .label = "River density",
		 .group = ParamGroup::World,
		 .field = &MapParams::riverDensity,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.5,
		 .campaign = {0.3, 0.7}},
		{.param = NumberParam::RiverMeander,
		 .key = "riverMeander",
		 .label = "River meander",
		 .group = ParamGroup::World,
		 .field = &MapParams::riverMeander,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.5,
		 .campaign = {0.2, 0.8}},
		{.param = NumberParam::Lakes,
		 .key = "lakes",
		 .label = "Lakes",
		 .group = ParamGroup::World,
		 .field = &MapParams::lakes,
		 .tuning = {0, 8},
		 .step = {1, 1},
		 .defaultValue = 2,
		 .campaign = {0, 6}},
		{.param = NumberParam::Contamination,
		 .key = "contamination",
		 .label = "Contamination",
		 .group = ParamGroup::World,
		 .field = &MapParams::contamination,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.3,
		 .campaign = {0.1, 0.7}},
		{.param = NumberParam::Hotspots,
		 .key = "hotspots",
		 .label = "Hotspots",
		 .group = ParamGroup::World,
		 .field = &MapParams::hotspots,
		 .tuning = {0, 6},
		 .step = {1, 1},
		 .defaultValue = 3,
		 .campaign = {1, 5}},
		{.param = NumberParam::MetroSize,
		 .key = "metroSize",
		 .label = "Metro size",
		 .group = ParamGroup::World,
		 .field = &MapParams::metroSize,
		 .tuning = {0.08, 0.25},
		 .step = {1, 100},
		 .defaultValue = 0.15,
		 .campaign = {0.12, 0.2}},
		{.param = NumberParam::Towns,
		 .key = "towns",
		 .label = "Towns",
		 .group = ParamGroup::World,
		 .field = &MapParams::towns,
		 .tuning = {0, 12},
		 .step = {1, 1},
		 .defaultValue = 5,
		 .campaign = {2, 9}},
		{.param = NumberParam::Villages,
		 .key = "villages",
		 .label = "Villages",
		 .group = ParamGroup::World,
		 .field = &MapParams::villages,
		 .tuning = {0, 40},
		 .step = {1, 1},
		 .defaultValue = 20,
		 .campaign = {12, 28}},
		{.param = NumberParam::Highways,
		 .key = "highways",
		 .label = "Highways",
		 .group = ParamGroup::Network,
		 .field = &MapParams::highways,
		 .tuning = {3, 9},
		 .step = {1, 1},
		 .defaultValue = 6,
		 .campaign = {5, 7}},
		{.param = NumberParam::HighwaySeparation,
		 .key = "highwaySeparation",
		 .label = "Highway separation",
		 .group = ParamGroup::Network,
		 .field = &MapParams::highwaySeparation,
		 .tuning = {20, 60},
		 .step = {1, 1},
		 .defaultValue = 35,
		 .campaign = {25, 45}},
		{.param = NumberParam::RoadDensity,
		 .key = "roadDensity",
		 .label = "Road density",
		 .group = ParamGroup::Network,
		 .field = &MapParams::roadDensity,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.5,
		 .campaign = {0.35, 0.65}},
		{.param = NumberParam::Loops,
		 .key = "loops",
		 .label = "Loops",
		 .group = ParamGroup::Network,
		 .field = &MapParams::loops,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.5,
		 .campaign = {0.3, 0.7}},
		{.param = NumberParam::Curviness,
		 .key = "curviness",
		 .label = "Curviness",
		 .group = ParamGroup::Network,
		 .field = &MapParams::curviness,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.5,
		 .campaign = {0.25, 0.75}},
		{.param = NumberParam::TrailShare,
		 .key = "trailShare",
		 .label = "Trail share",
		 .group = ParamGroup::Network,
		 .field = &MapParams::trailShare,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.5,
		 .campaign = {0.25, 0.75}},
		{.param = NumberParam::BrokenHighways,
		 .key = "brokenHighways",
		 .label = "Broken highways",
		 .group = ParamGroup::Network,
		 .field = &MapParams::brokenHighways,
		 .tuning = {0, 4},
		 .step = {1, 1},
		 .defaultValue = 2,
		 .campaign = {1, 4}},
		{.param = NumberParam::Strongholds,
		 .key = "strongholds",
		 .label = "Strongholds",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::strongholds,
		 .tuning = {2, 8},
		 .step = {1, 1},
		 .defaultValue = 4,
		 .campaign = {3, 5}},
		{.param = NumberParam::PoiDensity,
		 .key = "poiDensity",
		 .label = "POI density",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::poiDensity,
		 .tuning = {0.5, 2},
		 .step = {1, 10},
		 .defaultValue = 1,
		 .campaign = {0.8, 1.2}},
		{.param = NumberParam::RoutesTarget,
		 .key = "routesTarget",
		 .label = "Routes per POI",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::routesTarget,
		 .tuning = {2, 3},
		 .step = {1, 1},
		 .defaultValue = 3,
		 .campaign = {3, 3}},
		{.param = NumberParam::RouteSplit,
		 .key = "routeSplit",
		 .label = "Route split",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::routeSplit,
		 .tuning = {0.3, 0.7},
		 .step = {1, 20},
		 .defaultValue = 0.5,
		 .campaign = {0.5, 0.5}},
		{.param = NumberParam::StartingReveal,
		 .key = "startingReveal",
		 .label = "Starting reveal",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::startingReveal,
		 .tuning = {1, 2},
		 .step = {1, 1},
		 .defaultValue = 1,
		 .campaign = {1, 1}},
		{.param = NumberParam::StopDensity,
		 .key = "stopDensity",
		 .label = "Stop density",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::stopDensity,
		 .tuning = {0.5, 2},
		 .step = {1, 10},
		 .defaultValue = 1,
		 .campaign = {0.8, 1.2}},
		{.param = NumberParam::DangerCurve,
		 .key = "dangerCurve",
		 .label = "Danger curve",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::dangerCurve,
		 .tuning = {0.5, 2},
		 .step = {1, 10},
		 .defaultValue = 1,
		 .campaign = {0.9, 1.1}},
		{.param = NumberParam::DriverFinds,
		 .key = "driverFinds",
		 .label = "Driver finds",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::driverFinds,
		 .tuning = {1, 4},
		 .step = {1, 1},
		 .defaultValue = 2,
		 .campaign = {2, 2}},
		{.param = NumberParam::DaylightHours,
		 .key = "daylightHours",
		 .label = "Daylight hours",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::daylightHours,
		 .tuning = {10, 16},
		 .step = {1, 2},
		 .defaultValue = 14,
		 .campaign = {13, 15}},
		{.param = NumberParam::TravelPace,
		 .key = "travelPace",
		 .label = "Travel pace",
		 .group = ParamGroup::Gameplay,
		 .field = &MapParams::travelPace,
		 .tuning = {0.5, 2},
		 .step = {1, 10},
		 .defaultValue = 1,
		 .campaign = {0.9, 1.1}},
		{.param = NumberParam::Dressing,
		 .key = "dressing",
		 .label = "Amount",
		 .group = ParamGroup::Dressing,
		 .field = &MapParams::dressing,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.6,
		 .campaign = {0.4, 0.8}},
		{.param = NumberParam::StreetGrids,
		 .key = "streetGrids",
		 .label = "Street grids",
		 .group = ParamGroup::Dressing,
		 .field = &MapParams::streetGrids,
		 .tuning = {0, 1},
		 .step = {1, 20},
		 .defaultValue = 0.7,
		 .campaign = {0.5, 0.9}},
		{.param = NumberParam::RailLines,
		 .key = "railLines",
		 .label = "Rail lines",
		 .group = ParamGroup::Dressing,
		 .field = &MapParams::railLines,
		 .tuning = {0, 4},
		 .step = {1, 1},
		 .defaultValue = 1,
		 .campaign = {0, 3}},
	}};

	struct ParamValue {
		NumberParam param{};
		double		value{0};
	};

	struct EnvironmentSpec {
		Environment		 environment{};
		std::string_view label;
		// What it sets over the table's defaults: world, road network, and dressing parameters, never
		// gameplay ones, so the land changes and the rules don't.
		std::span<const ParamValue> values;
	};

	// The spec's Environments table. Each value sits at least a step inside its campaign range, since half
	// an environment's rolls land either side of its value however little room that side has. High
	// Desert's 0 lakes is the one on an end, on purpose: most High Desert maps have none.
	inline constexpr std::array<ParamValue, 14> kHighDesertValues{{
		{NumberParam::Aridity, 0.15},
		{NumberParam::MountainCoverage, 0.35},
		{NumberParam::Ruggedness, 0.65},
		{NumberParam::Rivers, 1},
		{NumberParam::RiverDensity, 0.35},
		{NumberParam::RiverMeander, 0.3},
		{NumberParam::Lakes, 0},
		{NumberParam::Contamination, 0.2},
		{NumberParam::Hotspots, 2},
		{NumberParam::Towns, 3},
		{NumberParam::Villages, 14},
		{NumberParam::RoadDensity, 0.4},
		{NumberParam::Loops, 0.4},
		{NumberParam::Curviness, 0.4},
	}};

	inline constexpr std::array<ParamValue, 15> kRustBeltValues{{
		{NumberParam::Aridity, 0.55},
		{NumberParam::MountainCoverage, 0.15},
		{NumberParam::Ruggedness, 0.35},
		{NumberParam::Rivers, 3},
		{NumberParam::Contamination, 0.45},
		{NumberParam::Hotspots, 4},
		{NumberParam::MetroSize, 0.18},
		{NumberParam::Towns, 8},
		{NumberParam::Villages, 26},
		{NumberParam::RoadDensity, 0.6},
		{NumberParam::Loops, 0.6},
		{NumberParam::TrailShare, 0.35},
		{NumberParam::BrokenHighways, 3},
		{NumberParam::StreetGrids, 0.85},
		{NumberParam::RailLines, 2},
	}};

	inline constexpr std::array<ParamValue, 9> kFloodlandsValues{{
		{NumberParam::Aridity, 0.85},
		{NumberParam::MountainCoverage, 0.1},
		{NumberParam::Ruggedness, 0.25},
		{NumberParam::Rivers, 4},
		{NumberParam::RiverDensity, 0.65},
		{NumberParam::RiverMeander, 0.75},
		{NumberParam::Lakes, 5},
		{NumberParam::Contamination, 0.4},
		{NumberParam::Curviness, 0.6},
	}};

	inline constexpr std::array<ParamValue, 14> kBadlandsValues{{
		{NumberParam::Aridity, 0.3},
		{NumberParam::MountainCoverage, 0.35},
		{NumberParam::Ruggedness, 0.8},
		{NumberParam::Rivers, 1},
		{NumberParam::RiverDensity, 0.4},
		{NumberParam::Lakes, 1},
		{NumberParam::Contamination, 0.6},
		{NumberParam::Hotspots, 4},
		{NumberParam::Towns, 3},
		{NumberParam::Villages, 14},
		{NumberParam::RoadDensity, 0.4},
		{NumberParam::Loops, 0.4},
		{NumberParam::Curviness, 0.65},
		{NumberParam::TrailShare, 0.7},
	}};

	// In kEnvironmentNames' order.
	inline constexpr std::array<EnvironmentSpec, 5> kEnvironments{{
		{.environment = Environment::HighDesert, .label = "High Desert", .values = kHighDesertValues},
		{.environment = Environment::RustBelt, .label = "Rust Belt", .values = kRustBeltValues},
		{.environment = Environment::Floodlands, .label = "Floodlands", .values = kFloodlandsValues},
		{.environment = Environment::Badlands, .label = "Badlands", .values = kBadlandsValues},
		{.environment = Environment::Mixed, .label = "Mixed", .values = {}},
	}};

	[[nodiscard]] const NumberParamSpec& paramSpec(NumberParam param);
	[[nodiscard]] const EnvironmentSpec& environmentSpec(Environment environment);

	[[nodiscard]] double paramValue(const MapParams& params, const NumberParamSpec& spec);
	// Asserts that a whole-number parameter gets a whole number.
	void setParamValue(MapParams& params, const NumberParamSpec& spec, double value);

	// The nearest value on the step's grid, which counts from 0.
	[[nodiscard]] double snapToStep(StepGrid step, double value);

	// Every value from the table, with the environment's over it.
	[[nodiscard]] MapParams environmentDefaults(uint32_t seed, Environment environment);

	// What a person sets: a seed, an environment, and the values that override the environment's. A preset
	// file is one, and so is a complete set of params, every value an override.
	struct MapParamSet {
		uint32_t											 seed{0};
		Environment											 environment{Environment::Mixed};
		std::array<std::optional<double>, kNumberParamCount> overrides{};
	};

	// The environment's defaults with the set's overrides over them, unvalidated: a value outside its range
	// comes back as it was set, for validateMapParams to clamp and report.
	[[nodiscard]] MapParams resolveMapParams(const MapParamSet& set);

} // namespace rules::map
