#pragma once

// The game's scenes by name (Game Flow and UI Specification), for the command line, the dev server, and the scenes'
// own switches. A scene that takes arguments is pushed by its type from its own header and has no name.

#include <scene/SceneStack.h>

#include <memory>

namespace game::scenes {

	inline constexpr const char* kSplash = "splash";
	inline constexpr const char* kMainMenu = "main_menu";
	inline constexpr const char* kSettings = "settings";
	inline constexpr const char* kFounding = "founding";
	inline constexpr const char* kLoading = "loading";
	inline constexpr const char* kCompound = "compound";
	inline constexpr const char* kAreaMap = "area_map";
	inline constexpr const char* kRun = "run";
	inline constexpr const char* kCampaignEnd = "campaign_end";

	// Every scene above, under its name.
	void addScenes(app::SceneStack& stack);

	// The scenes that take no arguments, each defined in its own file.
	[[nodiscard]] std::unique_ptr<app::Scene> makeSplashScene();
	[[nodiscard]] std::unique_ptr<app::Scene> makeMainMenuScene();
	[[nodiscard]] std::unique_ptr<app::Scene> makeSettingsScene();
	[[nodiscard]] std::unique_ptr<app::Scene> makeLoadingScene();
	[[nodiscard]] std::unique_ptr<app::Scene> makeCompoundScene();
	[[nodiscard]] std::unique_ptr<app::Scene> makeAreaMapScene();
	[[nodiscard]] std::unique_ptr<app::Scene> makeRunScene();
	[[nodiscard]] std::unique_ptr<app::Scene> makeCampaignEndScene();

} // namespace game::scenes
