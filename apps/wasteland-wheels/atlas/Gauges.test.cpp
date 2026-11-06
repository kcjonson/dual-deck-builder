// The atlas's gauges and markers (UI Art Direction, Components): the scale bar alternates as a map's scale or fills as a
// count, the cased bar fills its track inside its casing, each marker takes its box, and all of them lay out on a sheet
// and lint 0.

#include "atlas/Gauges.h"
#include "GameTesting.h"
#include "atlas/LegendBox.h"
#include "atlas/Markers.h"
#include "atlas/Sheet.h"

namespace {

	using namespace game;
	using namespace game::testing;

	TEST(ScaleBar, AlternatesAsAScaleOrFillsFromTheLeftAsACount) {
		const atlas::ScaleBar scale({.segments = 5});
		EXPECT_EQ(scale.filledCount(), 3);
		EXPECT_TRUE(scale.isFilled(0));
		EXPECT_FALSE(scale.isFilled(1));
		EXPECT_TRUE(scale.isFilled(4));

		atlas::ScaleBar count({.segments = 10, .value = 0.34F, .tone = atlas::ScaleTone::Highway});
		EXPECT_EQ(count.filledCount(), 3);
		EXPECT_TRUE(count.isFilled(2));
		EXPECT_FALSE(count.isFilled(3));
		count.setValue(7.0F);
		EXPECT_EQ(count.filledCount(), 10) << "a value is held to 0 to 1";
	}

	TEST(Markers, TheShieldIsNarrowerThanTallAndTheRestSquare) {
		EXPECT_EQ(atlas::Marker::boxFor(atlas::MarkerKind::Shield, 49.0F), (Foundation::Vec2{40.0F, 49.0F}));
		EXPECT_EQ(atlas::Marker::boxFor(atlas::MarkerKind::Circled, 24.0F), (Foundation::Vec2{24.0F, 24.0F}));
		for (const Foundation::Vec2 point : atlas::shieldOutline()) {
			EXPECT_GE(point.x, 0.0F);
			EXPECT_LE(point.x, 1.0F);
			EXPECT_GE(point.y, 0.0F);
			EXPECT_LE(point.y, 1.0F);
		}
	}

	class Kit : public GameTest {};

	TEST_F(Kit, GaugesAndMarkersLayOutAtTheirSizesAndLintZero) {
		start(fixtureMakers(), true);
		openParts([](ui::Ref<ui::Component> root) {
			ui::Ref<atlas::Sheet> sheet = root.addChild<atlas::Sheet>({
				.id = "sheet",
				.size = {ui::percent(100.0F), ui::percent(100.0F)},
				.layout =
					{.display = ui::Display::Flex,
					 .flexDirection = ui::FlexDirection::Column,
					 .gap = 18.0F,
					 .alignItems = ui::AlignItems::Start},
				.identity = "kit",
			});
			ui::Layout			  padded = sheet.get()->getLayout();
			padded.padding = ui::Edges(60.0F);
			sheet.get()->setLayout(padded);
			ui::Ref<atlas::LegendBox> box = sheet.addChild<atlas::LegendBox>({.id = "gauges", .title = "Gauges"});
			// Unstretched, so each takes its own width.
			ui::Ref<ui::Component> gauges = box.addChild<ui::Component>(
				{.layout = {
					 .display = ui::Display::Flex,
					 .flexDirection = ui::FlexDirection::Column,
					 .gap = 10.0F,
					 .alignItems = ui::AlignItems::Start
				 }}
			);
			gauges.addChild<atlas::ScaleBar>({.id = "scale"});
			gauges.addChild<atlas::ScaleBar>(
				{.id = "loader", .size = {240.0F, 12.0F}, .segments = 10, .value = 0.6F, .tone = atlas::ScaleTone::Highway, .frame = 2.0F}
			);
			gauges.addChild<atlas::CasedBar>({.id = "hp_a", .value = 0.7F, .seat = 0});
			gauges.addChild<atlas::CasedBar>({.id = "hp_b", .size = {220.0F, 14.0F}, .value = 0.35F, .seat = 1});
			ui::Ref<atlas::LegendBox> markers = sheet.addChild<atlas::LegendBox>({.id = "markers", .title = "Markers"});
			ui::Ref<ui::Component>	  row = markers.addChild<ui::Component>(
				   {.layout = {
						.display = ui::Display::Flex,
						.flexDirection = ui::FlexDirection::Row,
						.gap = 12.0F,
						.alignItems = ui::AlignItems::Center
					}}
			   );
			row.addChild<atlas::Marker>({.id = "letter", .kind = atlas::MarkerKind::Circled, .text = "B"});
			row.addChild<atlas::Marker>({.id = "number", .kind = atlas::MarkerKind::Circled, .text = "12", .extent = 30.0F});
			row.addChild<atlas::Marker>({.id = "day", .kind = atlas::MarkerKind::Shield, .text = "9", .extent = 38.0F});
			row.addChild<atlas::Marker>(
				{.id = "route", .kind = atlas::MarkerKind::Shield, .text = "112", .extent = 38.0F, .tone = atlas::ShieldTone::Paper}
			);
			row.addChild<atlas::Marker>({.id = "arrow", .kind = atlas::MarkerKind::Shield, .extent = 38.0F});
			row.addChild<atlas::Marker>({.id = "hostile", .kind = atlas::MarkerKind::Diamond, .extent = 16.0F});
			row.addChild<atlas::Marker>({.id = "home", .kind = atlas::MarkerKind::Star, .extent = 22.0F});
			row.addChild<atlas::Marker>({.id = "gone", .kind = atlas::MarkerKind::Circled, .text = "C", .faded = true});
		});
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(find("scale")->getSize(), (Foundation::Vec2{160.0F, 8.0F}));
		EXPECT_EQ(find("loader")->getSize(), (Foundation::Vec2{240.0F, 12.0F}));
		EXPECT_EQ(find("hp_a")->getSize(), (Foundation::Vec2{160.0F, 12.0F}));
		const auto* cased = dynamic_cast<const atlas::CasedBar*>(find("hp_b"));
		ASSERT_NE(cased, nullptr);
		EXPECT_FLOAT_EQ(cased->casingWidth(), 3.0F);
		EXPECT_FLOAT_EQ(cased->fillWidth(), (220.0F - 6.0F) * 0.35F);
		EXPECT_EQ(find("day")->getSize(), (Foundation::Vec2{31.0F, 38.0F}));
		EXPECT_EQ(find("home")->getSize(), (Foundation::Vec2{22.0F, 22.0F}));
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
	}

} // namespace
