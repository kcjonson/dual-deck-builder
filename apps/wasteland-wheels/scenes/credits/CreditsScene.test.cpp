// The credits name every face the game bundles, and each one's licence ships with it.

#include "Fonts.h"
#include "GameFiles.h"
#include "scenes/credits/Credits.h"

#include <gtest/gtest.h>

#include <filesystem>
#include <string>

namespace {

	using namespace game;

	TEST(Credits, EveryBundledFaceIsCreditedWithItsLicence) {
		for (const Renderer::FontAtlasSource& face : fonts::atlases()) {
			const std::string file = std::filesystem::path(face.pngPath).filename().string();
			bool			  credited = false;
			for (const CreditSection& section : credits()) {
				for (const CreditEntry& entry : section.entries) {
					if (!entry.asset.empty() && file.starts_with(entry.asset + "-")) {
						credited = true;
						EXPECT_TRUE(std::filesystem::exists(filesDirectory() / "fonts" / (entry.asset + "-OFL.txt"))) << entry.asset;
					}
				}
			}
			EXPECT_TRUE(credited) << file;
		}
	}

} // namespace
