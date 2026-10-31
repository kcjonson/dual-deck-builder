#include "StopData.h"

#include "MoveCost.h"

#include <string>
#include <utility>

namespace rules::map {

	StopTuning readStopTuning(const std::filesystem::path& file) {
		const nlohmann::json json = readJsonFile(file);
		JsonReader			 reader(json, file.generic_string());
		StopTuning			 tuning;

		JsonReader spacing = reader.requireObject("spacing");
		for (const auto& [name, road] : kRoadClassNames) {
			tuning.spacing[static_cast<size_t>(road)] = readAtLeast(spacing, name, 1);
		}
		spacing.finish();
		JsonReader clearance = reader.requireObject("clearance");
		tuning.clearance = {.ends = readAtLeast(clearance, "ends", 0), .junctions = readAtLeast(clearance, "junctions", 0)};
		clearance.finish();
		tuning.minGap = readAtLeast(reader, "minGap", 1);
		tuning.tightGap = readAtLeast(reader, "tightGap", 1);
		if (tuning.tightGap > tuning.minGap) {
			reader.failAt("tightGap", "must be at most minGap");
		}
		tuning.jitter = readShare(reader, "jitter");

		JsonReader types = reader.requireObject("types");
		for (const auto& [name, type] : kStopTypeNames) {
			JsonReader kind = types.requireObject(name);
			tuning.types[static_cast<size_t>(type)] = {.label = kind.requireString("label"), .hours = readAtLeast(kind, "hours", 0)};
			kind.finish();
		}
		types.finish();

		JsonReader bands = reader.requireObject("bands");
		for (int tier = 1; tier <= kStopTiers; ++tier) {
			const std::string key = std::to_string(tier);
			JsonReader		  band = bands.requireObject(key);
			const StopBand	  read{.stops = readIntRange(band, "stops", 0), .fights = readIntRange(band, "fights", 1)};
			if (read.fights.min > read.stops.min) {
				band.failAt("fights", "has a floor past the band's least stops");
			}
			if (read.fights.max > read.stops.max) {
				band.failAt("fights", "has more than the band's most stops");
			}
			band.finish();
			tuning.bands[static_cast<size_t>(tier - 1)] = read;
		}
		bands.finish();

		tuning.extras = reader.requireInts("extras");
		for (size_t index = 0; index < tuning.extras.size(); ++index) {
			if (tuning.extras[index] < 1 || (index > 0 && tuning.extras[index] <= tuning.extras[index - 1])) {
				reader.failAt("extras", "must be game stages from 1, rising");
			}
		}
		JsonReader objective = reader.requireObject("objectiveHours");
		tuning.objectiveHours = {.poi = readAtLeast(objective, "poi", 0), .stronghold = readAtLeast(objective, "stronghold", 0)};
		objective.finish();
		tuning.unknownStopHours = readAtLeast(reader, "unknownStopHours", 0);
		tuning.dawn = readAtLeast(reader, "dawn", 0);
		if (tuning.dawn >= 24) {
			reader.failAt("dawn", "must be an hour of the day, under 24");
		}
		JsonReader skulls = reader.requireObject("skulls");
		tuning.skulls = {.step = readAtLeast(skulls, "step", 0), .warband = readIntAtLeast(skulls, "warband", 0)};
		if (tuning.skulls.warband > 2) {
			skulls.failAt("warband", "must be at most 2");
		}
		skulls.finish();

		JsonReader finds = reader.requireObject("driverFinds");
		tuning.driverFinds.floorTiers = readIntAtLeast(finds, "floorTiers", 1);
		if (tuning.driverFinds.floorTiers > kStopTiers) {
			finds.failAt("floorTiers", "must be a tier");
		}
		const nlohmann::json& rates = finds.requireValue("rates");
		if (!rates.is_array() || rates.size() != static_cast<size_t>(kStopTiers)) {
			finds.failAt("rates", "must give a share for each of the 5 tiers");
		}
		for (size_t tier = 0; tier < rates.size(); ++tier) {
			if (!rates[tier].is_number() || rates[tier].get<double>() < 0 || rates[tier].get<double>() > 1) {
				finds.failAt("rates", "must give a share from 0 to 1 for each tier");
			}
			tuning.driverFinds.rates[tier] = rates[tier].get<double>();
		}
		finds.finish();

		JsonReader contents = reader.requireObject("contents");
		tuning.contents.hazards = contents.requireStrings("hazards");
		if (tuning.contents.hazards.empty()) {
			contents.failAt("hazards", "must name a hazard");
		}
		JsonReader	 hours = contents.requireObject("hazardHours");
		const double least = readAtLeast(hours, "min", 0);
		tuning.contents.hazardHours = {.min = least, .max = readAtLeast(hours, "max", least), .step = readAtLeast(hours, "step", 0.01)};
		hours.finish();
		JsonReader supplies = contents.requireObject("supplies");
		for (const auto& [name, resource] : kResourceNames) {
			tuning.contents.supplies[static_cast<size_t>(resource)] = readIntRange(supplies, name, 0);
		}
		supplies.finish();
		contents.finish();
		reader.finish();
		return tuning;
	}

} // namespace rules::map
