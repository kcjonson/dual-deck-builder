#include "scenes/battle/BattleScene.h"

#include "Words.h"

#include <ai/OpponentPolicies.h>
#include <ai/PlayFight.h>
#include <rules/battle/Battle.h>
#include <rules/battle/EnemyTurn.h>
#include <rules/battle/Waves.h>

#include <nlohmann/json.hpp>

#include <cstdlib>
#include <memory>
#include <utility>
#include <variant>

namespace game {

	using rules::Action;
	using rules::BattleState;
	using rules::DriverIndex;
	using rules::Phase;
	using rules::VehicleIndex;

	namespace {

		std::string phaseText(Phase phase) {
			switch (phase) {
				case Phase::Planning:
					return "the raiders are planning";
				case Phase::PlayerTurn:
					return "your turn";
				case Phase::EnemyTurn:
					return "the raiders' turn";
				case Phase::Over:
					return "over";
			}
			return "";
		}

		std::string vehicleLine(const BattleState& state, VehicleIndex index) {
			const rules::BattleVehicle& vehicle = state.vehicle(index);
			std::string line = std::to_string(vehicle.structure) + "/" + std::to_string(vehicle.maxStructure) + " structure, " +
							   std::to_string(vehicle.armor) + " armor";
			if (vehicle.shield > 0) {
				line += ", " + std::to_string(vehicle.shield) + " shield";
			}
			line += ", speed " + std::to_string(rules::speedOf(state, index));
			for (const rules::VehicleStatus& status : vehicle.statuses) {
				line += ", " + std::string(nameOf(rules::kStatusNames, status.status));
			}
			if (!rules::vehicleInFight(state, index)) {
				line += ", out of the fight";
			}
			return line;
		}

	} // namespace

	BattleScene::BattleScene(BattleArgs args)
		: fight(std::move(args.start.fight)) {}

	void BattleScene::enter() {
		afterAction();
#ifdef SALAL_DEV_SERVER
		app::DevServer& server = app().devServer();
		devRoutes.push_back(server.stateProvider("battle", [this] { return exportState(); }));
		devRoutes.push_back(server.route("battle-act", [this](const app::DevRequest& request) {
			const auto found = request.params.find("index");
			char*	   end = nullptr;
			const long index = found == request.params.end() ? -1 : std::strtol(found->second.c_str(), &end, 10);
			if (index < 0 || static_cast<size_t>(index) >= legal.size() || (end != nullptr && *end != '\0')) {
				return app::DevResponse{.status = 400, .body = R"({"error":"index names no action on offer"})"};
			}
			act(static_cast<size_t>(index));
			return app::DevResponse{.body = exportState()};
		}));
		devRoutes.push_back(server.route("battle-play-out", [this](const app::DevRequest& /*request*/) {
			playOut();
			return app::DevResponse{.body = exportState()};
		}));
#endif
	}

	void BattleScene::act(size_t index) {
		if (index >= legal.size()) {
			LOG_ERROR(Game, "BattleScene: action %zu of %zu on offer", index, legal.size());
			return;
		}
		const Action action = legal[index];
		lastLine = actionText(action);
		// The events are the battle screen's to animate; the rows show the state they leave.
		(void)rules::apply(fight.state, game().rules.content, action);
		afterAction();
	}

	void BattleScene::playOut() {
		const std::unique_ptr<rules::Policy> standIn = ai::makePolicy(rules::Behavior{.policy = "first_playable"}, rules::Side::Player);
		ai::playFight(
			fight.state,
			game().rules.content,
			[&standIn](const BattleState& /*board*/, DriverIndex /*seat*/) -> const rules::Policy& { return *standIn; },
			game().rules.raiders.forRaiders()
		);
		lastLine = "Played out.";
		afterAction();
	}

	void BattleScene::leave() {
		if (fight.state.phase != Phase::Over || leaving) {
			LOG_ERROR(Game, "BattleScene: leaving a fight that isn't over");
			return;
		}
		leaving = true;
		finish(std::move(fight));
	}

	void BattleScene::afterAction() {
		const rules::Content& content = game().rules.content;
		if (fight.state.phase == Phase::Planning) {
			(void)rules::planEnemyTurn(fight.state, content, game().rules.raiders.forRaiders());
		}
		legal = rules::legalActions(fight.state, content);
		picked.reset();
		build();
	}

	std::string BattleScene::actionText(const Action& action) const {
		if (const auto* play = std::get_if<rules::action::PlayCard>(&action)) {
			const rules::BattleDriver& driver = fight.state.driver(play->driver);
			return fighterName(fight.state, game().rules.content, play->driver) + " plays " +
				   game().rules.content.cards.at(driver.hand[static_cast<size_t>(play->handIndex)].card).name + " " +
				   playText(fight.state, game().rules.content, *play);
		}
		return "End the turn";
	}

	void BattleScene::hand(ui::Ref<ui::Component> list, DriverIndex driver) {
		const rules::Content&	   content = game().rules.content;
		const rules::BattleDriver& fighter = fight.state.driver(driver);
		for (int place = 0; place < static_cast<int>(fighter.hand.size()); ++place) {
			const std::optional<std::string> blocked = rules::cardBlocker(fight.state, content, driver, place);
			const bool						 isPicked = picked && picked->first == driver && picked->second == place;
			kit::listRow(
				list,
				"hand_" + std::to_string(driver.value) + "_" + std::to_string(place),
				cardText(content, fighter.hand[static_cast<size_t>(place)].card),
				blocked.value_or(""),
				[this, driver, place] {
					// A card with one way to play it plays at once; one with more waits for its target.
					std::vector<size_t> ways;
					for (size_t index = 0; index < legal.size(); ++index) {
						const auto* play = std::get_if<rules::action::PlayCard>(&legal[index]);
						if (play && play->driver == driver && play->handIndex == place) {
							ways.push_back(index);
						}
					}
					if (ways.size() == 1) {
						act(ways.front());
						return;
					}
					picked = std::pair{driver, place};
					lastLine = ways.empty() ? "Nothing is in range of it." : "Pick its target.";
					build();
				},
				blocked.has_value(),
				isPicked
			);
		}
	}

	void BattleScene::build() {
		const rules::Content& content = game().rules.content;
		const BattleState&	  state = fight.state;
		page = kit::openPage(
			*this,
			page,
			"Fight: " + fight.encounter.value,
			"Turn " + std::to_string(state.turn) + ", " + phaseText(state.phase) + ", " +
				counted(static_cast<int>(state.reinforcements.queue.size()), "wave", "waves") + " to come"
		);

		ui::Ref<ui::Component> convoy = kit::panel(page, "Your convoy", "convoy");
		for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
			const DriverIndex		   driver{index};
			const rules::BattleDriver& fighter = state.driver(driver);
			if (fighter.side != rules::Side::Player) {
				continue;
			}
			kit::text(
				convoy,
				fighterName(state, content, driver) + ": " + std::to_string(fighter.hitpoints) + "/" +
					std::to_string(fighter.maxHitpoints) + " HP, " + std::to_string(fighter.adrenaline) + "/" +
					std::to_string(fighter.maxAdrenaline) + " adrenaline, deck " + std::to_string(fighter.deck.size()) + ", discard " +
					std::to_string(fighter.discard.size())
			);
			if (const std::optional<VehicleIndex> riding = rules::vehicleCarrying(state, driver)) {
				kit::caption(convoy, vehicleLine(state, *riding));
			}
			hand(convoy, driver);
		}
		for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
			const rules::BattleVehicle& vehicle = state.vehicle(VehicleIndex{index});
			if (vehicle.side == rules::Side::Player && vehicle.escort) {
				kit::caption(convoy, vehicleName(state, content, VehicleIndex{index}) + ": " + vehicleLine(state, VehicleIndex{index}));
			}
		}

		if (picked) {
			ui::Ref<ui::Component> targets = kit::panel(page, "Targets", "targets");
			for (size_t index = 0; index < legal.size(); ++index) {
				const auto* play = std::get_if<rules::action::PlayCard>(&legal[index]);
				if (play && play->driver == picked->first && play->handIndex == picked->second) {
					kit::listRow(targets, "target_" + std::to_string(index), playText(state, content, *play), "", [this, index] {
						act(index);
					});
				}
			}
		}

		ui::Ref<ui::Component>			 raiders = kit::panel(page, "Raiders", "raiders");
		const bool						 planned = state.phase == Phase::PlayerTurn;
		const std::vector<rules::Intent> intents = planned ? rules::intentsOf(state, content) : std::vector<rules::Intent>{};
		for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
			const DriverIndex		   driver{index};
			const rules::BattleDriver& fighter = state.driver(driver);
			if (fighter.side != rules::Side::Raiders) {
				continue;
			}
			const std::optional<VehicleIndex> riding = rules::vehicleCarrying(state, driver);
			kit::text(
				raiders,
				fighterName(state, content, driver) + ": " + std::to_string(fighter.hitpoints) + "/" +
					std::to_string(fighter.maxHitpoints) + " HP" + (riding ? ", " + vehicleLine(state, *riding) : "")
			);
			for (const rules::Intent& intent : intents) {
				if (intent.raider == driver) {
					kit::caption(raiders, "  intends: " + intentText(state, content, intent));
				}
			}
		}
		if (planned) {
			const size_t arriving = rules::arrivalsOf(state, content).size();
			if (arriving > 0) {
				kit::caption(raiders, std::to_string(arriving) + " arriving at the end of the turn");
			}
		}

		if (state.phase == Phase::Over) {
			kit::text(page.footer, outcomeText(state.outcome.value_or(rules::Outcome::Lost)), "outcome");
			kit::button(page.footer, "leave", "Leave the fight", [this] { leave(); }, ui::ButtonVariant::Primary);
		} else {
			for (size_t index = 0; index < legal.size(); ++index) {
				if (std::holds_alternative<rules::action::EndTurn>(legal[index])) {
					kit::button(page.footer, "end_turn", "End turn", [this, index] { act(index); }, ui::ButtonVariant::Primary);
				}
			}
			if (picked) {
				kit::button(page.footer, "unpick", "Put the card back", [this] {
					picked.reset();
					build();
				});
			}
		}
		kit::setNotice(page, lastLine);
	}

	std::string BattleScene::exportState() const {
		nlohmann::json offered = nlohmann::json::array();
		for (const Action& action : legal) {
			offered.push_back(actionText(action));
		}
		const BattleState& state = fight.state;
		return nlohmann::json{
			{"encounter", fight.encounter.value},
			{"turn", state.turn},
			{"phase", phaseText(state.phase)},
			{"outcome", state.outcome ? nlohmann::json(outcomeText(*state.outcome)) : nlohmann::json(nullptr)},
			{"actions", offered},
			{"last", lastLine},
		}
			.dump();
	}

} // namespace game
