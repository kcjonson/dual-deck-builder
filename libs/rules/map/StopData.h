#pragma once

#include "ContentReading.h"
#include "PoiData.h"

#include <rules/core/JsonReader.h>

#include <array>
#include <filesystem>
#include <string>
#include <vector>

namespace rules::map {

	// The spec's stop table, with Find split by what it finds (stops-and-routes.md, Types and the stop tables).
	enum class StopType {
		Ambush,
		Warband,
		Checkpoint,
		Wreck,
		Distress,
		Garage,
		Hazard,
		FindDriver,
		FindSettlers,
		FindVehicle,
		FindCards,
		FindSupplies,
	};

	inline constexpr EnumNames<StopType, 12> kStopTypeNames{{
		{"ambush", StopType::Ambush},
		{"warband", StopType::Warband},
		{"checkpoint", StopType::Checkpoint},
		{"wreck", StopType::Wreck},
		{"distress", StopType::Distress},
		{"garage", StopType::Garage},
		{"hazard", StopType::Hazard},
		{"findDriver", StopType::FindDriver},
		{"findSettlers", StopType::FindSettlers},
		{"findVehicle", StopType::FindVehicle},
		{"findCards", StopType::FindCards},
		{"findSupplies", StopType::FindSupplies},
	}};

	[[nodiscard]] constexpr bool isFight(StopType type) {
		return type == StopType::Ambush || type == StopType::Warband;
	}

	// Destination tiers, 1 to 5.
	inline constexpr int kStopTiers = 5;

	// A destination tier's stops and fights a route carries (Runs and Encounters, How many stops).
	struct StopBand {
		IntRange stops;
		// Its min is the fight floor, never 0.
		IntRange fights;
	};

	// How stops are placed and what they take, a pack's map/stops.json (stops-and-routes.md).
	struct StopTuning {
		struct Clearance {
			// World units a stop keeps from a leg's ends and from a junction partway along it.
			double ends{0};
			double junctions{0};
		};
		struct StopKind {
			std::string label;
			double		hours{0};
		};
		struct Objective {
			double poi{0};
			double stronghold{0};
		};
		struct Skulls {
			double step{0};
			int	   warband{0};
		};
		struct DriverFinds {
			int floorTiers{0};
			// By tier from 1, a share.
			std::array<double, kStopTiers> rates{};
		};
		struct HourSteps {
			double min{0};
			double max{0};
			double step{0};
		};
		struct Contents {
			std::vector<std::string> hazards;
			HourSteps				 hazardHours;
			// By Resource.
			std::array<IntRange, 5> supplies{};
		};

		// World units of road a stop earns, by RoadClass.
		std::array<double, 3> spacing{};
		Clearance			  clearance;
		// World units between a leg's stops: the widest, and the closest a full leg packs them.
		double minGap{0};
		double tightGap{0};
		double jitter{0};
		// By StopType.
		std::array<StopKind, 12> types;
		// By tier from 1.
		std::array<StopBand, kStopTiers> bands{};
		// Game stages a route's dormant extras turn on at, rising.
		std::vector<int> extras;
		Objective		 objectiveHours;
		// Hours a stop of unknown type counts in an estimate, and the hour a run leaves.
		double		unknownStopHours{0};
		double		dawn{0};
		Skulls		skulls;
		DriverFinds driverFinds;
		Contents	contents;
	};

	// A pack's map/stops.json, every field read and range-checked: a band's fight floor at least 1, no more than
	// its least stops, and its most fights no more than its most stops; tightGap at most minGap; extras rising.
	// Anything else fails with a ContentError naming the file and the field.
	[[nodiscard]] StopTuning readStopTuning(const std::filesystem::path& file);

} // namespace rules::map
