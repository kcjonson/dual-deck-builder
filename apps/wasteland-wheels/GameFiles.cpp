#include "GameFiles.h"

#include <utils/ResourcePath.h>

#include <stdexcept>

namespace game {

	namespace {

		std::filesystem::path findFilesDirectory() {
			const std::filesystem::path exe = Foundation::getExecutableDir();
			if (exe.empty()) {
				throw std::runtime_error("the executable's folder can't be found, so neither can the game's files");
			}
#ifdef __APPLE__
			// The executable of Wasteland Wheels.app is in Contents/MacOS, its files in Contents/Resources.
			if (exe.filename() == "MacOS" && exe.parent_path().filename() == "Contents") {
				return exe.parent_path() / "Resources";
			}
#endif
			return exe;
		}

	} // namespace

	const std::filesystem::path& filesDirectory() {
		static const std::filesystem::path kDirectory = findFilesDirectory();
		return kDirectory;
	}

	std::filesystem::path packsDirectory() {
		return filesDirectory() / "packs";
	}

} // namespace game
