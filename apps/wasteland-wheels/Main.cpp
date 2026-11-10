// Wasteland Wheels: the game on salal's App, its scenes over the rules and the AI (game-app.md). The packs load before
// the window, so a pack that's wrong fails before anything opens; then the App, the game's context, its scenes and dev
// routes, and the splash, or --scene's. --check loads the packs and the faces as startup does, with no window, and exits.

#include "BaseShader.h"
#include "Build.h"
#include "DevRoutes.h"
#include "Fonts.h"
#include "GameContext.h"
#include "GameFiles.h"
#include "atlas/Paper.h"
#include "scenes/Scenes.h"

#include <application/App.h>
#include <application/CommandLine.h>
#include <platform/HeadlessPlatform.h>
#include <platform/Platform.h>
#include <primitives/Primitives.h>
#include <random/FreshSeed.h>
#include <rules/campaign/CampaignJson.h>
#include <utils/Log.h>

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <exception>
#include <memory>
#include <optional>
#include <set>
#include <span>
#include <string_view>
#include <utility>
#include <vector>

namespace {

	constexpr const char* kTitle = "Wasteland Wheels";
	constexpr int		  kDevServerPort = 8070;

	bool hasFlag(std::span<char*> args, std::string_view flag) {
		for (const std::string_view arg : args.subspan(args.empty() ? 0 : 1)) {
			if (arg == flag) {
				return true;
			}
		}
		return false;
	}

	// The faces, into an App on the headless platform, once the packs have loaded. Each has to come with an atlas of its
	// own, since a face that doesn't load draws in the body face; the App's log names the file that failed.
	int checkFaces() {
		const std::unique_ptr<app::App> headless = app::App::create(
			{.baseShader = base_shader::source(), .fontAtlases = game::fonts::atlases(), .defaultFont = game::fonts::kBody},
			std::make_unique<app::HeadlessPlatform>(1280, 800)
		);
		const Renderer::FontRenderer* renderer = Renderer::Primitives::getFontRenderer();
		std::set<uint32_t>			  atlases;
		if (headless != nullptr && renderer != nullptr) {
			for (const Renderer::FontAtlasSource& face : game::fonts::atlases()) {
				atlases.insert(renderer->getAtlasTexture(face.family).value);
			}
		}
		if (atlases.size() != game::fonts::atlases().size()) {
			std::fprintf(stderr, "The faces don't all load from %s\n", (game::filesDirectory() / "fonts").string().c_str());
			return 1;
		}
		std::printf(
			"Wasteland Wheels, %s: the packs and the faces load from %s\n", game::buildLine(), game::filesDirectory().string().c_str()
		);
		return 0;
	}

} // namespace

int main(int argc, char* argv[]) {
	const app::CommandLine commandLine = app::parseCommandLine(argc, argv);
	if (commandLine.help || !commandLine.valid) {
		std::fprintf(
			commandLine.valid ? stdout : stderr, "Usage: wasteland-wheels [--scene=<name>] [--http-port <port>] [--check] [--help]\n"
		);
		return commandLine.valid ? 0 : 1;
	}

	std::unique_ptr<game::GameRules> packs;
	try {
		packs = game::loadGameRules(game::packsDirectory());
	} catch (const std::exception& error) {
		std::fprintf(stderr, "The packs don't load: %s\n", error.what());
		return 1;
	}
	if (hasFlag(std::span(argv, static_cast<std::size_t>(argc)), "--check")) {
		return checkFaces();
	}

	std::unique_ptr<app::Platform> platform = app::createGlfwPlatform({.title = kTitle});
	if (platform == nullptr) {
		return 1;
	}
	std::unique_ptr<app::App> app = app::App::create(
		{.organization = "Bear Cave Interactive",
		 .applicationName = kTitle,
		 .baseShader = base_shader::source(),
		 .fontAtlases = game::fonts::atlases(),
		 .defaultFont = game::fonts::kBody,
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
	LOG_INFO(Game, "Wasteland Wheels, %s, its files in %s", game::buildLine(), game::filesDirectory().string().c_str());
	game::atlas::tunePaper();

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
