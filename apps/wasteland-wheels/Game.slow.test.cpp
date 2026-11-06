// The rules' own map making on the scenes' workers, makeCampaignMap and loadCampaign through rulesMapMakers: a whole
// generation each, which is why these are the slow lane's. A founding made to the end is the rules' slow lane's
// (CampaignMap.slow.test.cpp); here a founding is cancelled part way, Continue makes a saved map again, and the area map
// draws a real one, its land baked off the frame.

#include "GameTesting.h"
#include "scenes/map/MapPicture.h"
#include "scenes/map/MapView.h"

#include <primitives/Primitives.h>
#include <ui/debug/LayoutLint.h>

#include <chrono>
#include <functional>
#include <string>
#include <thread>

namespace {

	using namespace game;
	using namespace game::testing;

	class RealMaps : public GameTest {
	  protected:
		// Frames until `done`, for as long as a generation can take in Debug.
		bool frameFor(const std::function<bool()>& done) {
			const auto until = std::chrono::steady_clock::now() + std::chrono::minutes(2);
			while (std::chrono::steady_clock::now() < until) {
				if (done()) {
					return true;
				}
				frame();
				std::this_thread::sleep_for(std::chrono::milliseconds(2));
			}
			return done();
		}
	};

	TEST_F(RealMaps, ContinueMakesTheSavedMapAgainOnAWorker) {
		// Founded on the fixture map, which is what the pipeline makes of its params on every first attempt, so the load
		// makes it for real.
		MapMakers makers = rulesMapMakers(testRules());
		makers.found = fixtureMakers().found;
		start(std::move(makers));
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("new_campaign"));
		ASSERT_TRUE(frameFor([this] { return top() == scenes::kCompound; }));
		const rules::campaign::Campaign founded = played();

		context->session.reset();
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("continue"));
		ASSERT_TRUE(frameFor([this] { return top() == scenes::kCompound; })) << state();
		EXPECT_EQ(played(), founded);
		ASSERT_NE(context->session->map->areaMap(), nullptr);
		EXPECT_EQ(rules::campaign::mapFingerprint(*context->session->map->areaMap()), founded.mapOrigin.fingerprint);
		EXPECT_EQ(context->session->layers().stops.stops.size(), rules::campaigns::testLayers().stops.stops.size());
	}

	TEST_F(RealMaps, TheAreaMapDrawsARealMapWithItsDressingOverTheLandBakedOffTheFrame) {
		MapMakers makers = rulesMapMakers(testRules());
		makers.found = fixtureMakers().found;
		start(std::move(makers), true);
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("new_campaign"));
		ASSERT_TRUE(frameFor([this] { return top() == scenes::kCompound; }));
		context->session.reset();
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("continue"));
		ASSERT_TRUE(frameFor([this] { return top() == scenes::kCompound; })) << state();
		MapPicture* picture = context->session->map->picture();
		ASSERT_NE(picture, nullptr);
		ASSERT_TRUE(frameFor([picture] { return picture->baked(); }));
		ASSERT_TRUE(press("plan_run"));
		ASSERT_EQ(top(), scenes::kAreaMap);
		frame();
		Renderer::Primitives::beginFrameStats();
		frame();
		const Renderer::Primitives::RenderStats drawn = Renderer::Primitives::getStats();

		auto* view = dynamic_cast<MapView*>(find("map"));
		ASSERT_NE(view, nullptr);
		nlohmann::json described;
		view->describe(described);
		EXPECT_TRUE(described["land"].get<bool>());
		EXPECT_GT(described["markers"].get<int>(), 0);
		EXPECT_GT(described["labels"].get<int>(), 1) << "Home's and the dressing's";
		const ui::LintResult lint = ui::lint(app->scenes().top()->ui(), {1280.0F, 800.0F});
		EXPECT_TRUE(lint.violations.empty()) << lint.violations.size() << " violations, the first at " << lint.violations.front().path;
		std::printf(
			"[ map      ] land baked at radius %d in %lld ms (Debug); a frame of the area map: %u vertices, %u triangles\n",
			context->session->layers().params.radius,
			static_cast<long long>(picture->bakeTime().count()),
			drawn.vertexCount,
			drawn.triangleCount
		);
	}

	TEST_F(RealMaps, ACancelledFoundingStopsAtTheNextStageAndKeepsNothing) {
		start(rulesMapMakers(testRules()));
		// A Mixed map, as small as a roll makes one (CampaignMap.slow.test.cpp).
		nextSeed = 60;
		go(scenes::kMainMenu);
		ASSERT_TRUE(press("new_campaign"));
		ASSERT_TRUE(frameFor([this] { return state()["progress"].get<std::string>().starts_with("Making the area map: "); }));
		ASSERT_TRUE(press("cancel"));
		ASSERT_TRUE(frameFor([this] { return top() == scenes::kMainMenu; }));
		EXPECT_FALSE(context->session.has_value());
		EXPECT_EQ(context->store.status().state, SaveState::None);
	}

} // namespace
