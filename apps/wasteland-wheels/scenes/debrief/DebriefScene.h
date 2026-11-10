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
		// A run lost or abandoned at a fight: what went with it, and what became of each seat there.
		std::optional<rules::campaign::RunLost>		lost;
		std::vector<rules::campaign::SeatWriteBack> seats;
		// The night after it; none when the run's end ended the campaign.
		std::optional<rules::campaign::DayEnd> night;
	};

	// The run debrief (Game Flow 6.1), in the atlas: where the run went and what it brought home, stamped LOOTED, or what a
	// failed one lost, stamped LOST; the crew as they stand after the night; and the night itself; then back to the
	// compound, or to the campaign's end when that night or that fight ended it.
	class DebriefScene final : public GameScene<DebriefArgs> {
	  public:
		explicit DebriefScene(DebriefArgs args);

		const char* name() const override { return "debrief"; }
		std::string exportState() const override;

	  protected:
		const ui::Theme& sceneTheme() const override;
		void			 enter() override;

	  private:
		DebriefArgs debrief;
	};

} // namespace game
