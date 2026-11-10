// The area map and the run route in the atlas: each lints 0 at the sizes the game opens at and at 150% ui scale, where
// the body scrolls rather than squeezing its heading and primary (DDB-602); a destination chosen by its row or its
// marker fills its box; Plan a run here opens its run route, whose cards pick a route; and Load out the crew goes to load
// out on it, or is off with the reason while the stores can't fuel it.

#include "GameTesting.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Paper.h"
#include "atlas/Tokens.h"
#include "scenes/map/MapView.h"
#include "scenes/map/Planning.h"

#include <ui/debug/LayoutLint.h>
#include <ui/shapes/Text.h>

#include <sstream>
#include <string>

namespace {

	using namespace game;
	using namespace game::testing;

	class AreaMap : public GameTest {
	  protected:
		void SetUp() override { start(fixtureMakers(), true); }

		void foundAndOpen() {
			go(scenes::kMainMenu);
			ASSERT_TRUE(press("new_campaign"));
			ASSERT_TRUE(frameUntil([this] { return top() == scenes::kCompound; }));
			played().stores.fuel = 100;
			ASSERT_TRUE(press("plan_run"));
			ASSERT_EQ(top(), scenes::kAreaMap);
			frame();
		}

		// The first destination a run can be planned to.
		[[nodiscard]] int plannable() {
			const Planning planned = planning(*context->session);
			for (const Destination& destination : planned.destinations) {
				if (!planBlocker(played(), destination)) {
					return destination.poi;
				}
			}
			ADD_FAILURE() << "the fixture map has no destination found that a run can go to";
			return -1;
		}

		void chooseRow(int poi) {
			ui::Component* row = find("poi_" + std::to_string(poi));
			ASSERT_NE(row, nullptr);
			row->focus();
			frame();
		}

		[[nodiscard]] std::string lintAt(int width, int height, float scale = 1.0F) {
			app->setUiScale(scale);
			platform->resize(width, height);
			frame();
			frame();
			const float			 logicalWidth = static_cast<float>(width) / scale;
			const float			 logicalHeight = static_cast<float>(height) / scale;
			const ui::LintResult result = ui::lint(app->scenes().top()->ui(), {logicalWidth, logicalHeight});
			std::ostringstream	 found;
			for (const ui::LintViolation& violation : result.violations) {
				const Foundation::Rect& box = violation.bounds;
				found << ui::lintRuleName(violation.rule) << " " << violation.path << " at " << box.x << "," << box.y << " " << box.width
					  << "x" << box.height << (violation.otherPath.empty() ? "" : " against " + violation.otherPath) << "\n";
			}
			return found.str();
		}

		[[nodiscard]] std::string textOf(std::string_view id) {
			const auto* text = dynamic_cast<const ui::Text*>(find(id));
			return text != nullptr ? text->getText() : "";
		}

		void clickAt(Foundation::Vec2 at) {
			platform->push({.type = foundation::InputEvent::Type::PointerMove, .position = at});
			platform->push(
				{.type = foundation::InputEvent::Type::PointerDown, .mouseButton = foundation::MouseButton::Left, .position = at}
			);
			platform->push({.type = foundation::InputEvent::Type::PointerUp, .mouseButton = foundation::MouseButton::Left, .position = at});
			frame();
		}
	};

	TEST_F(AreaMap, ItLintsZeroAtEverySizeAndScrollsItsBodyAt150Percent) {
		foundAndOpen();
		EXPECT_FALSE(state()["pois"].empty());
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
		EXPECT_EQ(lintAt(1280, 800, 1.5F), "");
	}

	TEST_F(AreaMap, ItShowsTheCampaignsFuelBesideTheDay) {
		foundAndOpen();
		EXPECT_EQ(textOf("fuel_value"), "100");
		EXPECT_EQ(textOf("fuel_name"), "Fuel");
	}

	TEST_F(AreaMap, TheDisabledPlanButtonsLabelHoldsFourAndAHalfToOneOnItsFill) {
		foundAndOpen();
		ASSERT_FALSE(enabled("plan_here")) << "nothing chosen yet";
		const auto* label = dynamic_cast<const ui::Text*>(find("plan_here_label"));
		ASSERT_NE(label, nullptr);
		ASSERT_TRUE(label->getStyle().color.has_value());
		const ui::Theme& theme = atlas::theme();
		EXPECT_GE(atlas::contrastRatio(*label->getStyle().color, theme.get(atlas::tokens::palette::index)), 4.5F);
		chooseRow(plannable());
		ASSERT_TRUE(enabled("plan_here"));
		EXPECT_GE(atlas::contrastRatio(*label->getStyle().color, theme.get(atlas::tokens::palette::highway)), 3.0F)
			<< "enabled label restored";
	}

	TEST_F(AreaMap, ADestinationChosenByItsRowFillsItsBoxAndPlansItsRunRoute) {
		foundAndOpen();
		EXPECT_FALSE(enabled("plan_here")) << "nothing chosen yet";
		const int poi = plannable();
		chooseRow(poi);
		EXPECT_EQ(state()["selected"], poi);
		const Planning	   planned = planning(*context->session);
		const Destination* destination = planned.find(poi);
		ASSERT_NE(destination, nullptr);
		EXPECT_EQ(textOf("chosen_name"), destination->name);
		ASSERT_TRUE(enabled("plan_here"));
		ASSERT_TRUE(press("plan_here"));
		ASSERT_EQ(top(), "run_route");
		EXPECT_EQ(state()["poi"], poi);
		EXPECT_EQ(lintAt(1280, 800, 1.5F), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
		EXPECT_EQ(lintAt(1280, 800), "");

		ASSERT_TRUE(press("back_to_map"));
		ASSERT_EQ(top(), scenes::kAreaMap);
		EXPECT_EQ(state()["selected"], poi) << "the area map is as it was left";
	}

	TEST_F(AreaMap, AMarkerClickedChoosesItsPoiAndAClickOffEveryMarkerChoosesNone) {
		foundAndOpen();
		auto* view = dynamic_cast<MapView*>(find("map"));
		ASSERT_NE(view, nullptr);
		const int							  poi = plannable();
		const std::optional<Foundation::Vec2> marker = view->markerAt(poi);
		ASSERT_TRUE(marker.has_value());
		const Foundation::Rect box = view->screenBounds();
		clickAt({box.x + marker->x, box.y + marker->y});
		EXPECT_EQ(state()["selected"], poi);
		EXPECT_EQ(textOf("chosen_name"), planning(*context->session).find(poi)->name);

		// The corner farthest from the marker is off every marker on a map fitted round them.
		const Foundation::Vec2 corner{
			marker->x < box.width * 0.5F ? box.width - 2.0F : 2.0F,
			marker->y < box.height * 0.5F ? box.height - 2.0F : 2.0F,
		};
		bool nearMarker = false;
		for (const Destination& destination : planning(*context->session).destinations) {
			if (const std::optional<Foundation::Vec2> at = view->markerAt(destination.poi)) {
				nearMarker = nearMarker || std::hypot(at->x - corner.x, at->y - corner.y) < 20.0F;
			}
		}
		ASSERT_FALSE(nearMarker);
		clickAt({box.x + corner.x, box.y + corner.y});
		EXPECT_TRUE(state()["selected"].is_null());
		EXPECT_FALSE(enabled("plan_here"));
	}

	TEST_F(AreaMap, TheRunRoutePicksARouteAndLoadsOutOnIt) {
		foundAndOpen();
		const int poi = plannable();
		chooseRow(poi);
		ASSERT_TRUE(press("plan_here"));
		ASSERT_EQ(top(), "run_route");
		const Planning	   planned = planning(*context->session);
		const Destination* destination = planned.find(poi);
		ASSERT_NE(destination, nullptr);
		ASSERT_GE(destination->routes.size(), 2U) << "every POI has two routes or three";
		EXPECT_EQ(state()["picked"], destination->routes.front().route.route) << "the quickest, with fuel to spare";
		const int other = destination->routes[1].route.route;
		ASSERT_TRUE(press("route_" + std::to_string(poi) + "_" + std::to_string(other)));
		EXPECT_EQ(state()["picked"], other);
		ASSERT_TRUE(state()["loadOut"].get<bool>());
		ASSERT_TRUE(press("load_out_crew"));
		EXPECT_EQ(top(), "load_out");
	}

	TEST_F(AreaMap, EachStopOnTheRunRouteCarriesItsTypeAsATag) {
		foundAndOpen();
		const int poi = plannable();
		chooseRow(poi);
		ASSERT_TRUE(press("plan_here"));
		ASSERT_EQ(top(), "run_route");
		const Planning	   planned = planning(*context->session);
		const Destination* destination = planned.find(poi);
		ASSERT_NE(destination, nullptr);
		const rules::map::RouteOutlook& outlook = destination->routes.front().outlook;
		ASSERT_FALSE(outlook.stops.empty());
		for (size_t index = 0; index < outlook.stops.size(); ++index) {
			const std::string id = "stop_" + std::to_string(index) + "_tag";
			if (outlook.stops[index].type) {
				EXPECT_EQ(textOf(id), stopTag(*outlook.stops[index].type)) << id;
				EXPECT_FALSE(textOf(id).empty()) << id;
			} else {
				EXPECT_EQ(find(id), nullptr) << "an unknown stop has no type to tag";
			}
		}
		EXPECT_EQ(lintAt(1280, 800), "");
		EXPECT_EQ(lintAt(1440, 900), "");
		EXPECT_EQ(lintAt(1920, 1080), "");
		EXPECT_EQ(stopTag(rules::map::StopType::Ambush), "FIGHT");
		EXPECT_EQ(stopTag(rules::map::StopType::Wreck), "WRECK");
		EXPECT_EQ(stopTag(rules::map::StopType::Distress), "DISTRESS");
	}

	TEST_F(AreaMap, LoadOutIsOffWithTheReasonWhileTheStoresCantFuelTheRoute) {
		foundAndOpen();
		const int poi = plannable();
		chooseRow(poi);
		played().stores.fuel = 0;
		ASSERT_TRUE(press("plan_here"));
		ASSERT_EQ(top(), "run_route");
		EXPECT_FALSE(state()["loadOut"].get<bool>());
		EXPECT_FALSE(enabled("load_out_crew"));
		EXPECT_NE(textOf("load_out_reason").find("fuel"), std::string::npos) << textOf("load_out_reason");
	}

} // namespace
