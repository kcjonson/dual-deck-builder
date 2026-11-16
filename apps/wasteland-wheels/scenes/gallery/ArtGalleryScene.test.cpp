// The art gallery: every piece salal_art embeds loads and tessellates whole, the gallery shows each one, and it lints 0
// on every canvas. A piece the gallery leaves out fails here, so a new SVG in art/ gets looked at.

#include "GameTesting.h"
#include "atlas/Art.h"
#include "atlas/ArtView.h"

#include <string>

namespace {

	using namespace game;
	using namespace game::testing;

	class ArtGallery : public GameTest {};

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
		EXPECT_EQ(lintCanvases(), "");
	}

} // namespace
