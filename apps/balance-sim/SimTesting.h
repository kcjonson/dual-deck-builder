#pragma once

// Shared by the sim's tests: the base pack, loaded once, and the rules every run plays with.

#include "Fights.h"

#include <rules/packs/Pack.h>

#include <filesystem>
#include <vector>

namespace sim::tests {

	inline const rules::Content& baseContent() {
		static const rules::Content content = [] {
			const std::vector<std::filesystem::path> roots{std::filesystem::path(DDB_PACKS_DIR) / "base"};
			return rules::loadPacks(roots);
		}();
		return content;
	}

	inline const SimRules& baseRules() {
		static const SimRules rules(baseContent());
		return rules;
	}

	inline FightsConfig configOf(const nlohmann::json& json) {
		return readFightsConfig(json, "test.json", baseContent());
	}

} // namespace sim::tests
