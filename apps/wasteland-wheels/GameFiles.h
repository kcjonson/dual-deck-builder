#pragma once

// Where the game's own files are, its packs and its faces: Contents/Resources in a macOS app bundle, the executable's
// folder otherwise, where CMakeLists.txt stages them on every build. Never the working directory, so the game runs from
// wherever it's unpacked.

#include <filesystem>

namespace game {

	// Throws std::runtime_error when the executable's folder can't be found.
	[[nodiscard]] const std::filesystem::path& filesDirectory();

	// The packs under filesDirectory(), the base pack's folder among them.
	[[nodiscard]] std::filesystem::path packsDirectory();

} // namespace game
