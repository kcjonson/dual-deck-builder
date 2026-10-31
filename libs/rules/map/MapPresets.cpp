#include "MapPresets.h"

#include <rules/core/ContentError.h>

#include <algorithm>
#include <cstdint>
#include <limits>

namespace rules::map {

	namespace {

		namespace fs = std::filesystem;

		uint32_t readSeed(JsonReader& reader) {
			const nlohmann::json& seed = reader.requireValue("seed");
			if (!seed.is_number_unsigned() || seed.get<uint64_t>() > std::numeric_limits<uint32_t>::max()) {
				reader.failAt("seed", "must be a whole number from 0 to 4294967295");
			}
			return static_cast<uint32_t>(seed.get<uint64_t>());
		}

	} // namespace

	MapParamSet readMapParamSet(JsonReader reader) {
		MapParamSet set{.seed = readSeed(reader), .environment = reader.requireEnum("environment", kEnvironmentNames), .overrides = {}};
		for (const NumberParamSpec& spec : kNumberParams) {
			if (!reader.has(spec.key)) {
				continue;
			}
			std::optional<double>& value = set.overrides[static_cast<size_t>(spec.param)];
			if (std::holds_alternative<int MapParams::*>(spec.field)) {
				value = reader.requireInt(spec.key);
				continue;
			}
			value = reader.requireNumber(spec.key);
		}
		reader.finish();
		return set;
	}

	std::vector<MapPreset> readMapPresets(const std::filesystem::path& folder) {
		if (!fs::is_directory(folder)) {
			throw ContentError(folder.generic_string() + " isn't a folder of map presets");
		}
		std::vector<fs::path> files;
		for (const fs::directory_entry& entry : fs::directory_iterator(folder)) {
			if (!entry.is_regular_file() || entry.path().extension() != ".json") {
				throw ContentError(
					entry.path().generic_string() + " isn't a .json file, and nothing in " + folder.generic_string() + " reads it"
				);
			}
			files.push_back(entry.path());
		}
		std::ranges::sort(files);
		std::vector<MapPreset> presets;
		presets.reserve(files.size());
		for (const fs::path& file : files) {
			const nlohmann::json json = readJsonFile(file);
			presets.push_back({.name = file.stem().string(), .params = readMapParamSet(JsonReader(json, file.generic_string()))});
		}
		return presets;
	}

} // namespace rules::map
