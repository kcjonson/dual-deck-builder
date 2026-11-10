#pragma once

#include "scenes/GameScene.h"
#include "scenes/battle/BattleAim.h"
#include "scenes/battle/Playback.h"
#include "scenes/battle/Targeting.h"

#include <DevServer/DevServer.h>
#include <rules/battle/BattleAction.h>
#include <rules/battle/BattleEvent.h>
#include <rules/battle/EnemyTurn.h>
#include <rules/campaign/CombatBridge.h>

#include <cstddef>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace game {

	namespace road {
		class RoadView;
	}
	namespace battle {
		class Dock;
		class LogDrawer;
		class TopBar;
		class TurnBanner;
	} // namespace battle

	struct BattleArgs {
		rules::campaign::CampaignFightStart start;
	};

	// A run's fight (Battle Screen Design): the top bar, the road with every vehicle on it, the dock with each driver's
	// hand and End Turn, the log drawer, and the turn banner, in the dark theme. A card is dragged from the hand onto what
	// it's played at, by the pointer or the keys; a two-step play waits on the road for its next pick. Every play is one of
	// legalActions', made with apply, and what apply returns plays back through Playback, the raiders' turn beat by beat.
	// The raiders plan each turn through their own policies. It finishes with the fight once it's over, for the run to
	// write back.
	class BattleScene final : public GameScene<BattleArgs, rules::campaign::CampaignFight> {
	  public:
		explicit BattleScene(BattleArgs args);
		~BattleScene() override;

		BattleScene(const BattleScene&) = delete;
		BattleScene& operator=(const BattleScene&) = delete;
		BattleScene(BattleScene&&) = delete;
		BattleScene& operator=(BattleScene&&) = delete;

		const char* name() const override { return "battle"; }
		std::string exportState() const override;

		[[nodiscard]] const rules::campaign::CampaignFight& current() const { return fight; }
		// What the player can do now, legalActions' list, and doing one; the hand, End Turn and the dev routes act through it.
		[[nodiscard]] const std::vector<rules::Action>& actions() const { return legal; }
		void											act(size_t index);
		// The rest of the fight played with the player's seats on the first playable card, for a headless session or a
		// test that needs the fight over, not played well.
		void playOut();
		// Hands the fight to the run once it's over.
		void leave();

		// The last action's events still playing back, and the fight as the screen shows it meanwhile.
		[[nodiscard]] bool						playing() const { return playback.playing(); }
		[[nodiscard]] const rules::BattleState& shown() const { return playback.shown(); }
		// A two-step play waiting on the road for its next pick.
		[[nodiscard]] bool aiming() const { return pending.has_value(); }

		bool handleEvent(const foundation::InputEvent& event) override;
		void update(const app::FrameContext& frame) override;
		void onResize(const Renderer::Viewport& viewport) override;

	  protected:
		void						   enter() override;
		[[nodiscard]] const ui::Theme& sceneTheme() const override;

	  private:
		struct Pending {
			battle::HandCard			 card;
			std::vector<battle::AimPick> picks;
		};

		void build();
		void layOut();
		// After an action: the raiders plan when a turn opens, the plays on offer are taken again, and its events start
		// playing back.
		void afterAction(const rules::BattleState& before, std::vector<rules::Event> events);
		void land(const std::vector<battle::Beat>& beats);
		void showBeat(const battle::Beat& beat);
		// Everything shown from the fight as it stands, once nothing is playing back.
		void settle();
		void showRoad();
		void showTopBar();

		void								drop(const battle::HandCard& card, std::optional<battle::AimPick> pick);
		void								pick(const battle::AimPick& pick);
		void								choose(const battle::HandCard& card, const std::vector<battle::AimPick>& picks);
		void								cancelAim();
		bool								cancel();
		void								endTurn();
		[[nodiscard]] std::optional<size_t> endTurnIndex() const;
		void								toggleLog();

		[[nodiscard]] std::string actionText(const rules::Action& action) const;

		rules::campaign::CampaignFight	   fight;
		std::vector<rules::Action>		   legal;
		std::unique_ptr<battle::Targeting> targeting;
		battle::Playback				   playback;
		// The raiders' plan as the road shows it: kept while the enemy turn plays it, then the next turn's.
		std::vector<rules::Intent>		intents;
		std::vector<rules::RoadSlot>	arrivals;
		std::optional<Pending>			pending;
		std::optional<battle::HandCard> dragged;
		std::string						ticker;
		bool							logOpen = false;
		bool							leaving = false;
		bool							settled = true;
		// The run's seats by name, for the player's drivers (seatNames).
		std::vector<std::string> seats;

		ui::Ref<battle::TopBar>		top;
		ui::Ref<road::RoadView>		road;
		ui::Ref<battle::Dock>		dock;
		ui::Ref<battle::LogDrawer>	log;
		ui::Ref<battle::TurnBanner> banner;

		std::vector<app::DevServer::Registration> devRoutes;
	};

} // namespace game
