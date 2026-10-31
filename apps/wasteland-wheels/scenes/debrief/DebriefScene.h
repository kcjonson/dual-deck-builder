#pragma once

#include "scenes/GameScene.h"

#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/RunDecks.h>

#include <optional>
#include <vector>

namespace game {

	struct DebriefArgs {
		// A run home: what it brought back.
		std::optional<rules::campaign::Unloaded> home;
		// A run failed at a fight: what went with it, and what became of each seat there.
		std::optional<rules::campaign::RunLost>		lost;
		std::vector<rules::campaign::SeatWriteBack> seats;
		// The night after it; none when the run's end ended the campaign.
		std::optional<rules::campaign::DayEnd> night;
	};

	// The run debrief (Game Flow 6.1): what a run brought home and when, or what a failed one lost, and the night after
	// it, then back to the compound, or to the campaign's end when that night or that fight ended it.
	class DebriefScene final : public GameScene<DebriefArgs> {
	  public:
		explicit DebriefScene(DebriefArgs args);

		const char* name() const override { return "debrief"; }
		std::string exportState() const override;

	  protected:
		void enter() override;

	  private:
		DebriefArgs debrief;
	};

} // namespace game
