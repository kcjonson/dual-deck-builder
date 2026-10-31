#pragma once

#include "scenes/GameScene.h"

#include <rules/campaign/Campaign.h>
#include <rules/campaign/SupplyRun.h>

#include <optional>
#include <string>
#include <vector>

namespace game {

	struct LoadOutArgs {
		rules::campaign::RouteChoice route;
	};

	// Load out (Game Flow 1.2), as rows: two seats and the pool, each driver who can't be seated faded with the rules'
	// reason, and the convoy's escorts to bring or leave. Start run seats the drivers and leaves on the route, once a
	// departure tried on a copy of the campaign passes; a run of one goes only when nobody else can be seated (the
	// TypeScript's call, solo-driver-fights.md). Run decks stay the drivers' defaults until Customize lands.
	class LoadOutScene final : public GameScene<LoadOutArgs> {
	  public:
		explicit LoadOutScene(LoadOutArgs args);

		const char* name() const override { return "load_out"; }
		std::string exportState() const override;

	  protected:
		void enter() override;

	  private:
		void build();
		void seat(const rules::campaign::CrewId& driver);
		void unseat(const rules::campaign::CrewId& driver);
		// Why the run can't leave as it's loaded out now, or none.
		[[nodiscard]] std::optional<std::string> startBlocker() const;
		void									 startRun();

		rules::campaign::RouteChoice		   route;
		std::vector<rules::campaign::CrewId>   seats;
		std::vector<rules::campaign::ConvoyId> escorts;
	};

} // namespace game
