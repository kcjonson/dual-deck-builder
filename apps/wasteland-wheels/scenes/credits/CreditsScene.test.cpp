// The credits name every face the game bundles, and each one's licence ships beside the exe.

#include "Fonts.h"
#include "scenes/credits/Credits.h"

#include <utils/ResourcePath.h>

#include <gtest/gtest.h>

#include <filesystem>
#include <string>

namespace {

	using namespace game;

	TEST(Credits, EveryBundledFaceIsCreditedWithItsLicence) {
		for (const Renderer::FontAtlasSource& face : fonts::kAtlases) {
			const std::string path = face.pngPath;
			bool			  credited = false;
			for (const CreditSection& section : credits()) {
				for (const CreditEntry& entry : section.entries) {
					if (!entry.asset.empty() && path.starts_with("fonts/" + entry.asset + "-")) {
						credited = true;
						EXPECT_TRUE(std::filesystem::exists(Foundation::getExecutableDir() / "fonts" / (entry.asset + "-OFL.txt")))
							<< entry.asset;
					}
				}
			}
			EXPECT_TRUE(credited) << path;
		}
	}

} // namespace
