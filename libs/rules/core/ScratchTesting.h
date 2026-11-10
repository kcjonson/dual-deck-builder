#pragma once

// Scratch files for the rules tests. Tests only: nothing in the library includes it.

#include <filesystem>
#include <random>
#include <string>
#include <string_view>
#include <system_error>

namespace rules::fixtures {

	// A folder under the system temp folder that belongs to this test process alone, removed when it exits.
	// Fixed names there collided when several checkouts ran their tests at once.
	inline const std::filesystem::path& processScratch() {
		struct Root {
			std::filesystem::path path;

			Root() {
				std::random_device random;
				path = std::filesystem::temp_directory_path() /
					   ("ddb-rules-tests-" + std::to_string(random()) + "-" + std::to_string(random()));
				std::filesystem::create_directories(path);
			}
			~Root() {
				std::error_code error;
				std::filesystem::remove_all(path, error);
			}
			Root(const Root&) = delete;
			Root& operator=(const Root&) = delete;
			Root(Root&&) = delete;
			Root& operator=(Root&&) = delete;
		};
		static const Root root;
		return root.path;
	}

	inline std::filesystem::path scratchPath(std::string_view name) {
		return processScratch() / std::string(name);
	}

} // namespace rules::fixtures
