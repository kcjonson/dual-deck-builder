#pragma once

// What the game's tests share: the base pack loaded once, the App on salal's headless platform with the null renderer,
// the game's context over a save directory of the test's own, and pressing a component by its id through the App's
// own input, the way a player or a dev-server session does. The fast lane's maps are the map tests' fixture
// (rules::campaigns::testMap and testLayers), handed back at once or held until cancelled; the slow lane makes real ones.

#include "BaseShader.h"
#include "Fonts.h"
#include "GameContext.h"
#include "InterfaceScale.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Icons.h"
#include "atlas/Paper.h"
#include "atlas/Sheet.h"
#include "scenes/GameScene.h"
#include "scenes/Scenes.h"

#include <application/App.h>
#include <platform/HeadlessPlatform.h>
#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignMap.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/map/MapPipeline.h>
#include <testing/HeadlessLayout.h>
#include <ui/Component.h>
#include <ui/Context.h>

#include <gtest/gtest.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <initializer_list>
#include <memory>
#include <optional>
#include <random>
#include <span>
#include <sstream>
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

	// A scene a test lays out by hand on the atlas theme, to lay out and lint parts no game scene shows yet.
	class PartsScene final : public GameScene<> {
	  public:
		using Build = std::function<void(ui::Ref<ui::Component>)>;

		explicit PartsScene(Build build)
			: build(std::move(build)) {}

		[[nodiscard]] const char* name() const override { return "parts"; }

	  protected:
		[[nodiscard]] const ui::Theme& sceneTheme() const override { return atlas::theme(); }

		void background(ui::Ref<ui::Component> layer) override { atlas::layTable(layer); }

		void enter() override {
			if (!ui().icons().has("food")) {
				ui().icons().add(icons::iconAtlas());
			}
			build(root());
		}

	  private:
		Build build;
	};

	class GameTest : public ::testing::Test {
	  protected:
		void TearDown() override {
			app.reset();
			context.reset();
		}

		// The App in a 1920x1080 window, the canvas at 100%, held to the game's minimum, with every scene added and none on
		// the stack yet; seeds count from 1. With `faces`, the game's fonts load, so text measures as it draws, for a test
		// that lays a scene out to lint it.
		void start(MapMakers makers = fixtureMakers(), bool faces = false) {
			auto headless = std::make_unique<app::HeadlessPlatform>(1920, 1080);
			headless->setMinimumSize(kMinWindowWidth, kMinWindowHeight);
			platform = headless.get();
			app = app::App::create(
				{.applicationName = "wasteland-wheels-tests",
				 .uiScale = uiScaleConfig(),
				 .baseShader = base_shader::source(),
				 .fontAtlases = faces ? fonts::atlases() : std::span<const Renderer::FontAtlasSource>(),
				 .defaultFont = fonts::kBody,
				 .settingsFile = dir.path() / "settings.json",
				 .savesDirectory = dir.path() / "saves",
				 .saveFormat = {.version = rules::campaign::kSaveVersion}},
				std::move(headless)
			);
			ASSERT_NE(app, nullptr);
			atlas::tunePaper();
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

		// A PartsScene with what `build` lays out under its root, on top.
		void openParts(const PartsScene::Build& build) {
			app->scenes().add("parts", [build] { return std::make_unique<PartsScene>(build); });
			go("parts");
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

		// A point of the ui, in ui px, as the pointer position the platform reports there, in the window's logical pixels.
		[[nodiscard]] Foundation::Vec2 inWindow(Foundation::Vec2 point) const { return point * app->uiLayoutScale(); }

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
			const Foundation::Vec2 at = inWindow(middle);
			platform->push({.type = foundation::InputEvent::Type::PointerMove, .position = at});
			platform->push(
				{.type = foundation::InputEvent::Type::PointerDown, .mouseButton = foundation::MouseButton::Left, .position = at}
			);
			platform->push({.type = foundation::InputEvent::Type::PointerUp, .mouseButton = foundation::MouseButton::Left, .position = at});
			frame();
			return true;
		}

		// A pointer drag from the middle of one component to the middle of another, through the App's own input: the press,
		// moves along the line past the drag threshold, and the release, a frame between each; false, with a failure, when
		// either isn't there.
		bool drag(std::string_view from, std::string_view to) {
			ui::Component* source = find(from);
			ui::Component* target = find(to);
			if (source == nullptr || target == nullptr) {
				ADD_FAILURE() << "nothing shown has the id " << (source == nullptr ? from : to) << " in " << top();
				return false;
			}
			const Foundation::Rect start = source->screenBounds();
			const Foundation::Rect end = target->screenBounds();
			const Foundation::Vec2 a = inWindow({start.x + start.width * 0.5F, start.y + start.height * 0.5F});
			const Foundation::Vec2 b = inWindow({end.x + end.width * 0.5F, end.y + end.height * 0.5F});
			platform->push({.type = foundation::InputEvent::Type::PointerMove, .position = a});
			platform->push(
				{.type = foundation::InputEvent::Type::PointerDown, .mouseButton = foundation::MouseButton::Left, .position = a}
			);
			frame();
			for (int step = 1; step <= 4; ++step) {
				const float along = static_cast<float>(step) / 4.0F;
				platform->push({.type = foundation::InputEvent::Type::PointerMove, .position = a + (b - a) * along});
				frame();
			}
			platform->push({.type = foundation::InputEvent::Type::PointerUp, .mouseButton = foundation::MouseButton::Left, .position = b});
			frame();
			return true;
		}

		// A key pressed and let go, then a frame.
		void key(foundation::Key pressed) {
			platform->push({.type = foundation::InputEvent::Type::KeyDown, .key = pressed});
			platform->push({.type = foundation::InputEvent::Type::KeyUp, .key = pressed});
			frame();
		}

		[[nodiscard]] bool enabled(std::string_view id) {
			ui::Component* component = find(id);
			return component != nullptr && component->isEnabledInTree();
		}

		[[nodiscard]] rules::campaign::Campaign& played() { return context->session->campaign; }

		// One of Interface Scaling's canvases, reached as a player reaches it: a window in device pixels at an interface size.
		struct Canvas {
			std::string_view name; // the canvas's size in ui px
			int				 width;
			int				 height;
			float			 interfaceSize;
		};
		static constexpr std::array<Canvas, 7> kCanvases{{
			{.name = "1600x900", .width = 1920, .height = 1080, .interfaceSize = 1.2F},
			{.name = "1920x1080", .width = 1920, .height = 1080, .interfaceSize = 1.0F},
			{.name = "1920x1200", .width = 1920, .height = 1200, .interfaceSize = 1.0F},
			{.name = "1920x1440", .width = 1920, .height = 1440, .interfaceSize = 1.0F},
			{.name = "2600x1080", .width = 2600, .height = 1080, .interfaceSize = 1.0F},
			{.name = "2600x1350", .width = 2600, .height = 1350, .interfaceSize = 0.8F},
			{.name = "2400x1440", .width = 2400, .height = 1440, .interfaceSize = 0.8F},
		}};

		// The top scene laid out on a canvas through the game's scale and frame, and linted by salal's helper: a line per
		// violation, empty when there are none. The window keeps the size.
		[[nodiscard]] std::string lintOn(const Canvas& canvas) {
			app->setUiScale(canvas.interfaceSize);
			return app::lintAt(*app, *platform, canvas.width, canvas.height);
		}

		// On the 1920x1080 canvas, the size the tests otherwise run at.
		[[nodiscard]] std::string lint() { return lintOn(kCanvases[1]); }

		// A 32:9 window at 100%, whose canvas is wider than the frame: the frame sits 2600 across in its middle.
		static constexpr Canvas kPastTheFrame{.name = "3840x1080", .width = 5120, .height = 1440, .interfaceSize = 1.0F};

		// The top scene is framed, its frame centred in the canvas, and something in its background covers the whole window:
		// a line for each that isn't so, empty when all are.
		[[nodiscard]] std::string backgroundCoversWindow() {
			app::Scene&			   scene = *app->scenes().top();
			ui::Context&		   context = scene.ui();
			const Foundation::Vec2 canvas = context.getCanvas();
			const Foundation::Rect frame = context.getFrame();
			std::string			   found;
			if (!scene.framed()) {
				found += "it isn't framed\n";
			}
			const Foundation::Vec2 cap{uiScaleConfig().frameWidth, uiScaleConfig().frameHeight};
			const Foundation::Vec2 size{std::min(canvas.x, cap.x), std::min(canvas.y, cap.y)};
			if (frame.width != size.x || frame.height != size.y || std::abs(frame.x - (canvas.x - size.x) * 0.5F) > 1.0F ||
				std::abs(frame.y - (canvas.y - size.y) * 0.5F) > 1.0F) {
				found += "its frame is " + describe(frame) + " in a canvas of " + describe({0.0F, 0.0F, canvas.x, canvas.y}) + "\n";
			}
			const auto background = std::ranges::find_if(context.getRoots(), [&context](ui::ComponentId root) {
				const ui::Component* component = context.find(root);
				return component != nullptr && component->getId() == "background";
			});
			if (background == context.getRoots().end()) {
				return found + "it has no background\n";
			}
			const auto covers = [&context, canvas](ui::ComponentId child) {
				const ui::Component* component = context.find(child);
				if (component == nullptr || !component->isShown()) {
					return false;
				}
				const Foundation::Rect box = component->screenBounds();
				return box.x <= 0.0F && box.y <= 0.0F && box.x + box.width >= canvas.x && box.y + box.height >= canvas.y;
			};
			if (std::ranges::none_of(context.find(*background)->getChildren(), covers)) {
				found += "nothing in its background covers the window, " + describe({0.0F, 0.0F, canvas.x, canvas.y}) + "\n";
			}
			return found;
		}

		// On every canvas but those in `failing`, each line led by its canvas, with the window back at 1920x1080 and 100%
		// after. `failing` names the canvases a scene doesn't hold together on yet; one that lints clean, or isn't a
		// canvas, is a line too, so the list can't outlive its reason.
		[[nodiscard]] std::string lintCanvases(std::initializer_list<std::string_view> failing = {}) {
			std::string found;
			for (const std::string_view name : failing) {
				if (std::ranges::none_of(kCanvases, [name](const Canvas& canvas) { return canvas.name == name; })) {
					found += std::string(name) + " isn't one of the canvases\n";
				}
			}
			for (const Canvas& canvas : kCanvases) {
				const bool		  expected = std::ranges::find(failing, canvas.name) != failing.end();
				const std::string lines = lintOn(canvas);
				if (expected && lines.empty()) {
					found += std::string(canvas.name) + " is listed as failing and lints clean\n";
				}
				if (!expected && !lines.empty()) {
					std::istringstream each(lines);
					for (std::string line; std::getline(each, line);) {
						found += std::string(canvas.name) + ": " + line + "\n";
					}
				}
			}
			(void)lint();
			return found;
		}

		TempDir					   dir;
		app::HeadlessPlatform*	   platform = nullptr;
		std::unique_ptr<app::App>  app;
		std::optional<GameContext> context;
		uint32_t				   nextSeed = 1;

	  private:
		static std::string describe(const Foundation::Rect& box) {
			std::ostringstream text;
			text << box.x << "," << box.y << " " << box.width << "x" << box.height;
			return text.str();
		}

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
