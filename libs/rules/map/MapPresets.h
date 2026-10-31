#pragma once

#include "MapParams.h"

#include <rules/core/JsonReader.h>

#include <filesystem>
#include <string>
#include <vector>

namespace rules::map {

	// A parameter set kept as JSON in a pack's map/presets/ (Area Map Generation, The Map Lab).
	struct MapPreset {
		// The file's name without `.json`.
		std::string name;
		MapParamSet params;
	};

	// A preset object: `seed` (0 to 2^32 - 1) and `environment`, then any parameter by its key, a whole
	// number for a whole-number parameter. Anything else fails, an unknown key included, so a misspelt
	// parameter can't be dropped. A value outside its tuning range is kept for the validator to report.
	[[nodiscard]] MapParamSet readMapParamSet(JsonReader reader);

	// Every .json file in `folder`, sorted by name. A ContentError names the file and the field for
	// anything wrong, and the folder for anything in it that isn't a .json file.
	[[nodiscard]] std::vector<MapPreset> readMapPresets(const std::filesystem::path& folder);

} // namespace rules::map
