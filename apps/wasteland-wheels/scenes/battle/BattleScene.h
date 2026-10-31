#pragma once

#include "scenes/GameScene.h"

#include <DevServer/DevServer.h>
#include <rules/battle/BattleAction.h>
#include <rules/battle/BattleEvent.h>
#include <rules/campaign/CombatBridge.h>

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

namespace game {

	struct BattleArgs {
		rules::campaign::CampaignFightStart start;
	};

	// A run's fight (Game Flow 2), as rows until the battle screen lands: each driver's hand, a card's targets once it's
	// picked, and the raiders with their intents and who's arriving. Every play is one of legalActions', made with apply;
	// the raiders plan each turn through their own policies. It finishes with the fight once it's over, for the run to
	// write back.
	class BattleScene final : public GameScene<BattleArgs, rules::campaign::CampaignFight> {
	  public:
		explicit BattleScene(BattleArgs args);

		const char* name() const override { return "battle"; }
		std::string exportState() const override;

		[[nodiscard]] const rules::campaign::CampaignFight& current() const { return fight; }
		// What the player can do now, legalActions' list, and doing one; the rows and the dev routes both act through it.
		[[nodiscard]] const std::vector<rules::Action>& actions() const { return legal; }
		void											act(size_t index);
		// The rest of the fight played with the player's seats on the first playable card, for a headless session or a
		// test that needs the fight over, not played well.
		void playOut();
		// Hands the fight to the run once it's over.
		void leave();

	  protected:
		void enter() override;

	  private:
		// The raiders plan when a turn opens, then the plays on offer are taken again and the page rebuilt.
		void					  afterAction();
		void					  build();
		void					  hand(ui::Ref<ui::Component> list, rules::DriverIndex driver);
		[[nodiscard]] std::string actionText(const rules::Action& action) const;

		rules::campaign::CampaignFight fight;
		std::vector<rules::Action>	   legal;
		// The card picked to aim, by driver and place in hand.
		std::optional<std::pair<rules::DriverIndex, int>> picked;
		std::string										  lastLine;
		bool											  leaving = false;
		std::vector<app::DevServer::Registration>		  devRoutes;
	};

} // namespace game
