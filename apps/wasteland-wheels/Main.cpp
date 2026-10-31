// Wasteland Wheels: the game on salal's App, its scenes over the rules and the AI (game-app.md). The packs load before
// the window, so a pack that's wrong fails before anything opens; then the App, the game's context, its scenes and dev
// routes, and the splash, or --scene's.

#include "BaseShader.h"
#include "DevRoutes.h"
#include "GameContext.h"
#include "scenes/Scenes.h"

#include <application/App.h>
#include <application/CommandLine.h>
#include <platform/Platform.h>
#include <primitives/FontFamily.h>
#include <random/FreshSeed.h>
#include <rules/campaign/CampaignJson.h>
#include <utils/Log.h>

#include <array>
#include <cstdio>
#include <exception>
#include <memory>
#include <optional>
#include <utility>
#include <vector>

namespace {

	constexpr const char* kTitle = "Wasteland Wheels";
	constexpr int		  kDevServerPort = 8070;

	// JetBrains Mono, salal's sandbox atlas, until the art decision picks the game's faces (game-app.md). Staged beside
	// the exe by CMakeLists.txt.
	constexpr Renderer::FontFamily				   kMonoFont{0};
	const std::array<Renderer::FontAtlasSource, 1> kFontAtlases{{
		{.family = kMonoFont, .pngPath = "fonts/JetBrainsMono-SDF.png", .jsonPath = "fonts/JetBrainsMono-SDF.json"},
	}};

} // namespace

int main(int argc, char* argv[]) {
	const app::CommandLine commandLine = app::parseCommandLine(argc, argv);
	if (commandLine.help || !commandLine.valid) {
		std::fprintf(commandLine.valid ? stdout : stderr, "Usage: wasteland-wheels [--scene=<name>] [--http-port <port>] [--help]\n");
		return commandLine.valid ? 0 : 1;
	}

	std::unique_ptr<game::GameRules> packs;
	try {
		packs = game::loadGameRules(DDB_PACKS_DIR);
	} catch (const std::exception& error) {
		std::fprintf(stderr, "The packs don't load: %s\n", error.what());
		return 1;
	}

	std::unique_ptr<app::Platform> platform = app::createGlfwPlatform({.title = kTitle});
	if (platform == nullptr) {
		return 1;
	}
	std::unique_ptr<app::App> app = app::App::create(
		{.organization = "Bear Cave Interactive",
		 .applicationName = kTitle,
		 .baseShader = base_shader::source(),
		 .fontAtlases = kFontAtlases,
		 .defaultFont = kMonoFont,
		 .settingsFile = "settings.json",
		 .savesDirectory = "saves",
		 .saveFormat = {.version = rules::campaign::kSaveVersion},
		 // On wherever the server is compiled in, so a Release build, which has none, logs nothing.
		 .devServer =
			 {.enabled = app::kDevServerCompiledIn || commandLine.httpPort.has_value(),
			  .port = commandLine.httpPort.value_or(kDevServerPort)},
		 .metrics = true},
		std::move(platform)
	);
	if (app == nullptr) {
		return 1;
	}

	game::GameContext context{
		.rules = *packs,
		.store = game::CampaignStore(app->saves(), packs->content),
		.maps = game::rulesMapMakers(*packs),
		.newSeed = [] { return foundation::freshSeed(); },
		.session = std::nullopt,
	};
	app->setContext(context);
	game::scenes::addScenes(app->scenes());
	const std::vector<app::DevServer::Registration> devRoutes = game::registerDevRoutes(*app);

	if (!app->scenes().switchTo(commandLine.scene.value_or(game::scenes::kSplash))) {
		app->scenes().switchTo(game::scenes::kSplash);
	}

	app->run();
	app->shutdown();
	if (!app->settings().save()) {
		LOG_ERROR(Game, "The settings file couldn't be saved at exit");
	}
	return 0;
}
