#pragma once

// What the game's tests share: the base pack loaded once, the App on salal's headless platform with the null renderer,
// the game's context over a save directory of the test's own, and pressing a component by its id through the App's
// own input, the way a player or a dev-server session does. The fast lane's maps are the map tests' fixture
// (rules::campaigns::testMap and testLayers), handed back at once or held until cancelled; the slow lane makes real ones.

#include "GameContext.h"
#include "scenes/Scenes.h"

#include <application/App.h>
#include <platform/HeadlessPlatform.h>
#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignMap.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/map/MapPipeline.h>
#include <ui/Component.h>
#include <ui/Context.h>

#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <random>
#include <string>
#include <string_view>
#include <thread>
#include <utility>

namespace game::testing {

	inline const GameRules& testRules() {
		static const std::unique_ptr<GameRules> loaded = loadGameRules(DDB_PACKS_DIR);
		return *loaded;
	}

	// The fast lane's maps: founding hands back the map tests' fixture at once, and a load reads the save strictly and
	// holds it to that map, fingerprint and ids, as loadCampaign holds a save to the map it makes.
	inline MapMakers fixtureMakers() {
		return MapMakers{
			.found =
				[](uint32_t /*seed*/, const rules::campaign::MapMaking& making) {
					if (making.onProgress) {
						making.onProgress(rules::map::StageAttempt{.stage = "stops", .index = 7, .count = 9});
					}
					return FoundingMap{
						.origin = rules::campaigns::testMap().origin,
						.map = std::make_unique<SessionMap>(rules::campaigns::testLayers()),
					};
				},
			.load =
				[](const nlohmann::json& save, const rules::campaign::MapMaking& /*making*/) {
					rules::campaign::Campaign campaign = rules::campaign::readCampaign(save, testRules().content);
					rules::campaign::checkCampaignMap(campaign, rules::campaigns::testMap().map);
					return Session{.campaign = std::move(campaign), .map = std::make_unique<SessionMap>(rules::campaigns::testLayers())};
				},
		};
	}

	// Founding that reports its first stage and then waits for its cancel, as a generation the player gives up on.
	inline MapMakers heldMakers() {
		MapMakers makers = fixtureMakers();
		makers.found = [](uint32_t seed, const rules::campaign::MapMaking& making) -> FoundingMap {
			making.onProgress(rules::map::StageAttempt{.stage = "terrain", .index = 0, .count = 9, .seed = seed});
			while (!making.cancel.stop_requested()) {
				std::this_thread::sleep_for(std::chrono::milliseconds(1));
			}
			throw rules::map::MapPipelineCancelled(seed, "water");
		};
		return makers;
	}

	// A directory of the test's own, removed with everything in it when the test ends.
	class TempDir {
	  public:
		TempDir() {
			const ::testing::TestInfo* test = ::testing::UnitTest::GetInstance()->current_test_info();
			const std::string name = (test != nullptr ? std::string(test->test_suite_name()) + "." + test->name() : std::string("test")) +
									 "-" + std::to_string(std::random_device{}());
			root = std::filesystem::temp_directory_path() / "ddb-game-tests" / name;
			std::filesystem::create_directories(root);
		}
		~TempDir() {
			std::error_code error;
			std::filesystem::remove_all(root, error);
		}

		TempDir(const TempDir&) = delete;
		TempDir& operator=(const TempDir&) = delete;
		TempDir(TempDir&&) = delete;
		TempDir& operator=(TempDir&&) = delete;

		[[nodiscard]] const std::filesystem::path& path() const { return root; }

	  private:
		std::filesystem::path root;
	};

	class GameTest : public ::testing::Test {
	  protected:
		void TearDown() override {
			app.reset();
			context.reset();
		}

		// The App at 1280x800 with every scene added and none on the stack yet; seeds count from 1.
		void start(MapMakers makers = fixtureMakers()) {
			auto headless = std::make_unique<app::HeadlessPlatform>(1280, 800);
			platform = headless.get();
			app = app::App::create(
				{.applicationName = "wasteland-wheels-tests",
				 .settingsFile = dir.path() / "settings.json",
				 .savesDirectory = dir.path() / "saves",
				 .saveFormat = {.version = rules::campaign::kSaveVersion}},
				std::move(headless)
			);
			ASSERT_NE(app, nullptr);
			context.emplace(
				GameContext{
					.rules = testRules(),
					.store = CampaignStore(app->saves(), testRules().content),
					.maps = std::move(makers),
					.newSeed = [this] { return nextSeed++; },
					.session = std::nullopt,
				}
			);
			app->setContext(*context);
			scenes::addScenes(app->scenes());
		}

		bool frame(double seconds = 1.0 / 60.0) {
			platform->clock().advance(seconds);
			return app->tick();
		}

		void go(std::string_view scene) {
			ASSERT_TRUE(app->scenes().switchTo(scene));
			frame();
		}

		// The top scene's own name, the unnamed ones' too.
		[[nodiscard]] std::string top() {
			app::Scene* scene = app->scenes().top();
			return scene != nullptr ? scene->name() : "";
		}

		[[nodiscard]] nlohmann::json state() { return nlohmann::json::parse(app->scenes().top()->exportState()); }

		// Frames until `done`, a worker's result say, sleeping a little between them; false if it never is.
		bool frameUntil(const std::function<bool()>& done, int frames = 2000) {
			for (int index = 0; index < frames; ++index) {
				if (done()) {
					return true;
				}
				frame();
				std::this_thread::sleep_for(std::chrono::milliseconds(1));
			}
			return done();
		}

		// The shown component with the id in the top scene's ui, or null.
		[[nodiscard]] ui::Component* find(std::string_view id) {
			ui::Context& context = app->scenes().top()->ui();
			for (const ui::ComponentId root : context.getRoots()) {
				if (ui::Component* found = findUnder(context, root, id)) {
					return found;
				}
			}
			return nullptr;
		}

		// A press and a release in the middle of the component with the id, which has to be the topmost hit there, then a
		// frame; false, with a failure, when it isn't there or something covers it.
		bool press(std::string_view id) {
			ui::Component* component = find(id);
			if (component == nullptr) {
				ADD_FAILURE() << "nothing shown has the id " << id << " in " << top();
				return false;
			}
			const Foundation::Rect box = component->screenBounds();
			const Foundation::Vec2 middle{box.x + box.width * 0.5F, box.y + box.height * 0.5F};
			ui::Context&		   context = app->scenes().top()->ui();
			if (!hits(context, context.hitTest(middle), component)) {
				ADD_FAILURE() << id << " isn't the topmost hit at its middle in " << top();
				return false;
			}
			platform->push({.type = foundation::InputEvent::Type::PointerMove, .position = middle});
			platform->push(
				{.type = foundation::InputEvent::Type::PointerDown, .mouseButton = foundation::MouseButton::Left, .position = middle}
			);
			platform->push(
				{.type = foundation::InputEvent::Type::PointerUp, .mouseButton = foundation::MouseButton::Left, .position = middle}
			);
			frame();
			return true;
		}

		[[nodiscard]] bool enabled(std::string_view id) {
			ui::Component* component = find(id);
			return component != nullptr && component->isEnabledInTree();
		}

		[[nodiscard]] rules::campaign::Campaign& played() { return context->session->campaign; }

		TempDir					   dir;
		app::HeadlessPlatform*	   platform = nullptr;
		std::unique_ptr<app::App>  app;
		std::optional<GameContext> context;
		uint32_t				   nextSeed = 1;

	  private:
		static ui::Component* findUnder(ui::Context& context, ui::ComponentId id, std::string_view wanted) {
			ui::Component* component = context.find(id);
			if (component == nullptr || !component->isShown()) {
				return nullptr;
			}
			if (component->getId() == wanted) {
				return component;
			}
			for (const ui::ComponentId child : component->getChildren()) {
				if (ui::Component* found = findUnder(context, child, wanted)) {
					return found;
				}
			}
			return nullptr;
		}

		// The hit is the component or under it.
		static bool hits(ui::Context& context, ui::ComponentId hit, const ui::Component* component) {
			for (ui::Component* at = context.find(hit); at != nullptr; at = at->parent().get()) {
				if (at == component) {
					return true;
				}
			}
			return false;
		}
	};

} // namespace game::testing
