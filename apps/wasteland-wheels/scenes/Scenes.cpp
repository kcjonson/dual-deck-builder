#include "scenes/Scenes.h"

#include "scenes/founding/FoundingScene.h"

namespace game::scenes {

	void addScenes(app::SceneStack& stack) {
		stack.add(kSplash, makeSplashScene);
		stack.add(kMainMenu, makeMainMenuScene);
		stack.add(kSettings, makeSettingsScene);
		stack.add<FoundingScene>(kFounding);
		stack.add(kLoading, makeLoadingScene);
		stack.add(kCompound, makeCompoundScene);
		stack.add(kAreaMap, makeAreaMapScene);
		stack.add(kRun, makeRunScene);
		stack.add(kCampaignEnd, makeCampaignEndScene);
	}

} // namespace game::scenes
