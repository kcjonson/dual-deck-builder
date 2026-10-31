#include "FeatureNames.h"

#include <cassert>
#include <set>
#include <utility>

namespace rules::map {

	FeatureNamePool readFeatureNames(const std::filesystem::path& file) {
		const nlohmann::json json = readJsonFile(file);
		JsonReader			 reader(json, file.generic_string());
		FeatureNamePool		 pool{.roots = reader.requireStrings("roots"), .patterns = {}};
		if (pool.roots.empty()) {
			reader.failAt("roots", "must list at least one root");
		}
		std::set<std::string> seen;
		for (const std::string& root : pool.roots) {
			if (root.empty()) {
				reader.failAt("roots", "has an empty root");
			}
			if (!seen.insert(root).second) {
				reader.failAt("roots", "lists \"" + root + "\" twice");
			}
		}
		JsonReader patterns = reader.requireObject("patterns");
		for (const auto& [key, kind] : kFeatureKindNames) {
			std::string	 pattern = patterns.requireString(key);
			const size_t at = pattern.find(kFeatureRoot);
			if (at == std::string::npos || pattern.find(kFeatureRoot, at + 1) != std::string::npos) {
				patterns.failAt(key, "must hold " + std::string(kFeatureRoot) + " once");
			}
			pool.patterns[static_cast<size_t>(kind)] = std::move(pattern);
		}
		patterns.finish();
		reader.finish();
		return pool;
	}

	FeatureNamer::FeatureNamer(const FeatureNamePool& pool, foundation::Rng&& rng)
		: pool(&pool),
		  rng(std::move(rng)) {
		assert(!pool.roots.empty() && "FeatureNamer: a pool has roots");
	}

	std::string FeatureNamer::next(FeatureKind kind) {
		if (left.empty()) {
			for (size_t root = 0; root < pool->roots.size(); ++root) {
				left.push_back(root);
			}
			round += 1;
		}
		const auto	pick = static_cast<size_t>(rng.nextInt(0, static_cast<int>(left.size()) - 1));
		std::string root = pool->roots[left[pick]];
		left.erase(left.begin() + static_cast<std::ptrdiff_t>(pick));
		if (round > 1) {
			root += " " + std::to_string(round);
		}
		std::string name = pool->patterns[static_cast<size_t>(kind)];
		return name.replace(name.find(kFeatureRoot), kFeatureRoot.size(), root);
	}

} // namespace rules::map
