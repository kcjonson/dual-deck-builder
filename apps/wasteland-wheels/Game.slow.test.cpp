// The rules' own map making on the scenes' workers, makeCampaignMap and loadCampaign through rulesMapMakers: a whole
// generation each, which is why these are the slow lane's. A founding made to the end is the rules' slow lane's
// (CampaignMap.slow.test.cpp); here a founding is cancelled part way, and Continue makes a saved map again.

#include "GameTesting.h"

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
