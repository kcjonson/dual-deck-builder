#pragma once

#include "scenes/GameScene.h"

#include <rules/campaign/CombatBridge.h>

namespace game {

	struct BattleResultArgs {
		// The fight as it ended, and what writing it back did to the run.
		rules::campaign::CampaignFight	fight;
		rules::campaign::FightWriteBack back;
	};

	// A fight's result on a run (battleResult in the TypeScript), for a fight won or broken off: the outcome, then what
	// the run carries out of it (the down revived, the crashed out picked up, the haulers' pay and heal, the escorts
	// wrecked), and back on the road. A lost fight ends the run, so its result is the debrief's.
	class BattleResultScene final : public GameScene<BattleResultArgs> {
	  public:
		explicit BattleResultScene(BattleResultArgs args);

		const char* name() const override { return "battle_result"; }
		std::string exportState() const override;

	  protected:
		const ui::Theme& sceneTheme() const override;
		void			 enter() override;

	  private:
		BattleResultArgs fought;
	};

} // namespace game
