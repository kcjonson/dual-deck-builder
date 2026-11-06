// The art gallery: every piece salal_art embeds loads and tessellates whole, the gallery shows each one, and it lints 0
// at the sizes the game opens at. A piece the gallery leaves out fails here, so a new SVG in art/ gets looked at.

#include "GameTesting.h"
#include "atlas/Art.h"
#include "atlas/ArtView.h"

#include <ui/debug/LayoutLint.h>

#include <sstream>
#include <string>

namespace {

	using namespace game;
	using namespace game::testing;

	class ArtGallery : public GameTest {
	  protected:
		[[nodiscard]] std::string lintAt(int width, int height) {
			platform->resize(width, height);
			frame();
			frame();
			const ui::LintResult result = ui::lint(app->scenes().top()->ui(), {static_cast<float>(width), static_cast<float>(height)});
			std::ostringstream	 found;
			for (const ui::LintViolation& violation : result.violations) {
				const Foundation::Rect& box = violation.bounds;
				found << ui::lintRuleName(violation.rule) << " " << violation.path << " at " << box.x << "," << box.y << " " << box.width
					  << "x" << box.height << (violation.otherPath.empty() ? "" : " against " + violation.otherPath) << "\n";
			}
			return found.str();
		}
	};

	TEST_F(ArtGallery, EveryPieceLoadsShowsAndLintsZero) {
		start(fixtureMakers(), true);
		go(scenes::kArtGallery);
		ASSERT_EQ(top(), scenes::kArtGallery);
		ASSERT_FALSE(art::artNames().empty());
		for (const std::string_view name : art::artNames()) {
			const atlas::ArtMesh* mesh = atlas::artMesh(name);
			ASSERT_NE(mesh, nullptr) << name;
			EXPECT_GT(mesh->size.x, 0.0F) << name;
			EXPECT_FALSE(mesh->chunks.front().indices.empty()) << name;
			EXPECT_NE(find("art_" + std::string(name)), nullptr) << name << " isn't in the gallery";
		}
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

} // namespace
