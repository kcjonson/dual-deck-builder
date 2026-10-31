#pragma once

#include <rules/core/JsonReader.h>

#include <string_view>

// Number fields the map's pack files share, read strictly: each fails with a ContentError naming its path.
namespace rules::map {

	struct IntRange {
		int min{0};
		int max{0};
	};

	[[nodiscard]] double readAtLeast(JsonReader& reader, std::string_view key, double least);
	[[nodiscard]] int	 readIntAtLeast(JsonReader& reader, std::string_view key, int least);
	// From 0 to 1.
	[[nodiscard]] double readShare(JsonReader& reader, std::string_view key);
	// {"min", "max"}, whole numbers from `least`, max at least min.
	[[nodiscard]] IntRange readIntRange(JsonReader& reader, std::string_view key, int least);

} // namespace rules::map
