#pragma once

#include <DevServer/DevServer.h>
#include <application/App.h>

#include <vector>

namespace game {

	// The game's routes on salal's dev server (salal app-api.md, Dev server), for a session driving the game headless
	// beside the engine's tree, lint, input, and scene control:
	//
	//   /api/state?what=game     the top scene, the save's status, and the campaign being played as its save JSON
	//   /api/dev/found?seed=N    a new campaign founded on seed N (a fresh one without), through the founding scene
	//   /api/dev/continue        the save continued, through the loading scene
	//
	// The battle scene adds its own while it's up (BattleScene.h). Registered only where the server is compiled in
	// (SALAL_DEV_SERVER, Debug and RelWithDebInfo); elsewhere this registers nothing. Held until the App goes.
	[[nodiscard]] std::vector<app::DevServer::Registration> registerDevRoutes(app::App& app);

} // namespace game
