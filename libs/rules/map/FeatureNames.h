#pragma once

#include <rules/core/JsonReader.h>

#include <random/Rng.h>

#include <array>
#include <cstddef>
#include <filesystem>
#include <string>
#include <vector>

namespace rules::map {

	// What a named feature of the land is called: a river, a creek, a lake, a reservoir, a range, or a pass.
	enum class FeatureKind { River, Creek, Lake, Reservoir, Mountains, Hills, Pass };

	inline constexpr EnumNames<FeatureKind, 7> kFeatureKindNames{{
		{"river", FeatureKind::River},
		{"creek", FeatureKind::Creek},
		{"lake", FeatureKind::Lake},
		{"reservoir", FeatureKind::Reservoir},
		{"mountains", FeatureKind::Mountains},
		{"hills", FeatureKind::Hills},
		{"pass", FeatureKind::Pass},
	}};

	// The marker a kind's pattern holds where its root goes.
	inline constexpr std::string_view kFeatureRoot = "{root}";

	// The words the land's features are named from: a root, and a pattern for each kind that the root goes in, so
	// "Mercer" makes the Mercer River, Lake Mercer, or Mercer Pass.
	struct FeatureNamePool {
		std::vector<std::string> roots;
		// By FeatureKind.
		std::array<std::string, kFeatureKindNames.size()> patterns;
	};

	// A pack's map/feature-names.json: {"roots": [...], "patterns": {"river": "{root} River", ...}}, the roots
	// distinct and non-empty, and a pattern for every kind, each holding {root} once. Anything else fails with a
	// ContentError naming the file and the field.
	[[nodiscard]] FeatureNamePool readFeatureNames(const std::filesystem::path& file);

	// Hands out feature names, a root a name, no root twice while one is left, one draw a root; past the list the roots
	// come round again numbered ("Mercer 2"), which only a map with more features than roots reaches.
	class FeatureNamer {
	  public:
		// The pool has to outlive the namer; `rng` is the dressing's `features` fork.
		FeatureNamer(const FeatureNamePool& pool, foundation::Rng&& rng);

		[[nodiscard]] std::string next(FeatureKind kind);

	  private:
		const FeatureNamePool* pool;
		foundation::Rng		   rng;
		std::vector<size_t>	   left;
		int					   round{0};
	};

} // namespace rules::map
