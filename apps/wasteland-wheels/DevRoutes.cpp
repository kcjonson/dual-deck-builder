#include "DevRoutes.h"

#include "GameContext.h"
#include "scenes/Scenes.h"
#include "scenes/founding/FoundingScene.h"

#include <rules/campaign/CampaignJson.h>

#include <nlohmann/json.hpp>

#include <charconv>
#include <cstdint>
#include <optional>
#include <string>

namespace game {

#ifdef SALAL_DEV_SERVER
	namespace {

		std::string saveStateName(SaveState state) {
			switch (state) {
				case SaveState::None:
					return "none";
				case SaveState::Saved:
					return "saved";
				case SaveState::Damaged:
					return "damaged";
				case SaveState::OtherFormat:
					return "other_format";
			}
			return "";
		}

	} // namespace

	std::vector<app::DevServer::Registration> registerDevRoutes(app::App& app) {
		app::DevServer&							  server = app.devServer();
		std::vector<app::DevServer::Registration> routes;
		routes.push_back(server.stateProvider("game", [&app] {
			GameContext&	 game = app.context<GameContext>();
			const SaveStatus status = game.store.status();
			return nlohmann::json{
				{"scene", std::string(app.scenes().topName())},
				{"save", {{"state", saveStateName(status.state)}, {"line", status.line}}},
				{"campaign",
				 game.session ? rules::campaign::writeCampaign(game.session->campaign, game.rules.content) : nlohmann::json(nullptr)},
			}
				.dump();
		}));
		routes.push_back(server.route("found", [&app](const app::DevRequest& request) {
			FoundingArgs args;
			if (const auto seed = request.params.find("seed"); seed != request.params.end()) {
				uint32_t   value = 0;
				const auto read = std::from_chars(seed->second.data(), seed->second.data() + seed->second.size(), value);
				if (read.ec != std::errc{} || read.ptr != seed->second.data() + seed->second.size()) {
					return app::DevResponse{.status = 400, .body = R"({"error":"seed is a whole number from 0 to 4294967295"})"};
				}
				args.seed = value;
			}
			app.scenes().reset<FoundingScene>(args);
			return app::DevResponse{.body = R"({"founding":true})"};
		}));
		routes.push_back(server.route("continue", [&app](const app::DevRequest& /*request*/) {
			app.scenes().switchTo(scenes::kLoading);
			return app::DevResponse{.body = R"({"continuing":true})"};
		}));
		return routes;
	}
#else
	std::vector<app::DevServer::Registration> registerDevRoutes(app::App& /*app*/) {
		return {};
	}
#endif

} // namespace game
