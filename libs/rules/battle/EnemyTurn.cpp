#include "EnemyTurn.h"

#include "Battle.h"
#include "CardPlay.h"
#include "Statuses.h"
#include "Turns.h"

#include <algorithm>
#include <stdexcept>
#include <string>
#include <utility>

namespace rules {

	namespace {

		// More steps than any hand holds; a policy past it is looping on free cards and draws.
		constexpr size_t kMostSteps = 40;

		// "plan:raiders:0", by seat among the raiders, so each raider's picks draw from a stream of their own.
		std::string planStream(const BattleState& state, DriverIndex raider) {
			const auto seat = std::count_if(state.drivers.begin(), state.drivers.begin() + raider.value, [](const BattleDriver& driver) {
				return driver.side == Side::Raiders;
			});
			return "plan:raiders:" + std::to_string(seat);
		}

		// The vehicle that the first of a wreck's survivors still in the fight now rides in.
		std::optional<VehicleIndex> followWreck(const BattleState& state, VehicleIndex wreck) {
			for (const DriverIndex survivor : state.vehicle(wreck).escaped) {
				if (driverInFight(state, survivor)) {
					return vehicleCarrying(state, survivor);
				}
			}
			return std::nullopt;
		}

		// A fizzled card is spent: it goes to discard, and costs what adrenaline the raider has toward its price.
		void spend(BattleState& state, const Content& content, DriverIndex raider, int handIndex) {
			BattleDriver&	 driver = state.driver(raider);
			const BattleCard card = driver.hand[static_cast<size_t>(handIndex)];
			driver.hand.erase(driver.hand.begin() + handIndex);
			driver.discard.push_back(card);
			driver.adrenaline -= std::min(driver.adrenaline, cardCost(definitionOf(content, card.card), card.upgraded));
		}

		// The escort drawing fire across the target's row, if the card can reach it from where the raider is: the last
		// one played that's still in the fight, and never the target itself (Combat Rules, Enemy intents). Draw Fire
		// protects and never cancels, so a card that can't reach it keeps its target.
		std::optional<VehicleIndex> coverFor(
			const BattleState& state,
			const Content&	   content,
			DriverIndex		   raider,
			int				   handIndex,
			const PlannedStep& step,
			VehicleIndex	   target
		) {
			const BattleVehicle& aimed = state.vehicle(target);
			for (auto cover = state.drawFireCovers.rbegin(); cover != state.drawFireCovers.rend(); ++cover) {
				const BattleVehicle& escort = state.vehicle(*cover);
				if (!vehicleInFight(state, *cover) || escort.side != aimed.side || escort.slot.row != aimed.slot.row) {
					continue;
				}
				if (*cover == target) {
					return std::nullopt;
				}
				const action::PlayCard redirected{
					.driver = raider, .handIndex = handIndex, .target = *cover, .occupant = step.occupant, .destination = step.destination
				};
				return actionBlocker(state, content, redirected) ? std::nullopt : std::optional(*cover);
			}
			return std::nullopt;
		}

		void playStep(
			BattleState&		state,
			const Content&		content,
			DriverIndex			raider,
			int					number,
			const PlannedStep&	step,
			std::vector<Event>& events
		) {
			const std::vector<BattleCard>& hand = state.driver(raider).hand;
			const auto					   found = std::ranges::find(hand, step.card);
			const auto					   fizzle = [&](std::string reason, std::optional<int> handIndex) {
				if (handIndex) {
					spend(state, content, raider, *handIndex);
				}
				events.emplace_back(
					event::PlannedStepFizzled{.raider = raider, .step = number, .card = step.card, .reason = std::move(reason)}
				);
			};
			if (found == hand.end()) {
				fizzle("it isn't in hand", std::nullopt);
				return;
			}
			const int handIndex = static_cast<int>(found - hand.begin());

			std::optional<VehicleIndex> target = step.target;
			if (target && state.vehicle(*target).structure == 0) {
				const std::optional<VehicleIndex> follow = followWreck(state, *target);
				if (!follow) {
					fizzle("its target is wrecked and nobody who got out is still in the fight", handIndex);
					return;
				}
				events.emplace_back(event::PlanRedirected{.raider = raider, .step = number, .from = *target, .to = *follow});
				target = follow;
			}
			const CardDefinition& definition = definitionOf(content, step.card.card);
			if (target && landsOnTarget(definition, step.card.upgraded)) {
				if (const std::optional<VehicleIndex> cover = coverFor(state, content, raider, handIndex, step, *target)) {
					events.emplace_back(event::FireDrawn{.raider = raider, .step = number, .from = *target, .to = *cover});
					target = cover;
				}
			}

			const action::PlayCard play{
				.driver = raider, .handIndex = handIndex, .target = target, .occupant = step.occupant, .destination = step.destination
			};
			if (const std::optional<std::string> blocker = actionBlocker(state, content, play)) {
				fizzle(*blocker, handIndex);
				return;
			}
			const CardPlay aimed{
				.caster = raider,
				.actor = *vehicleCarrying(state, raider),
				.target = target,
				.occupant = step.occupant,
				.destination = step.destination
			};
			if (movesCasterTo(state, definition, step.card.upgraded, aimed) != step.movesTo) {
				fizzle("its move no longer goes where it was planned", handIndex);
				return;
			}
			events.emplace_back(event::PlannedStepPlayed{.raider = raider, .step = number});
			playCard(state, content, play, events);
		}

		bool sideOf(const BattleState& state, DriverIndex driver, Side side) {
			return state.driver(driver).side == side;
		}

		bool sideOf(const BattleState& state, VehicleIndex vehicle, Side side) {
			return state.vehicle(vehicle).side == side;
		}

	} // namespace

	std::vector<Event> planEnemyTurn(BattleState& state, const Content& content, const PolicyFor& policyFor) {
		if (state.phase != Phase::Planning) {
			throw std::invalid_argument("planEnemyTurn: the raiders plan as the player's turn starts");
		}
		for (BattleDriver& driver : state.drivers) {
			driver.plan.clear();
		}

		BattleState		   board = state;
		std::vector<Event> rehearsal;
		takeDeathMarks(board, Side::Player, rehearsal);
		if (!endIfOver(board, rehearsal)) {
			beginEnemyTurn(board, rehearsal);
			passToNextRaider(board, rehearsal);
		}
		std::vector<Event> events;
		while (board.phase == Phase::EnemyTurn) {
			const DriverIndex		  raider = *board.actingRaider;
			const Policy&			  policy = policyFor(board, raider);
			foundation::Rng			  rng = state.random.next(planStream(state, raider));
			std::vector<PlannedStep>& plan = state.driver(raider).plan;
			while (board.phase == Phase::EnemyTurn && board.actingRaider == raider) {
				const std::vector<Action> actions = legalActions(board, content);
				const Action			  choice = policy.choose(board, content, actions, rng);
				if (std::ranges::find(actions, choice) == actions.end()) {
					throw std::logic_error("planEnemyTurn: a policy chose an action that wasn't on offer");
				}
				if (const auto* play = std::get_if<action::PlayCard>(&choice)) {
					if (plan.size() >= kMostSteps) {
						throw std::logic_error("planEnemyTurn: a raider planned more cards than any turn holds");
					}
					const BattleCard& card = board.driver(raider).hand[static_cast<size_t>(play->handIndex)];
					const CardPlay	  aimed{
						   .caster = raider,
						   .actor = *vehicleCarrying(board, raider),
						   .target = play->target,
						   .occupant = play->occupant,
						   .destination = play->destination,
					   };
					plan.push_back(
						PlannedStep{
							.card = card,
							.target = play->target,
							.occupant = play->occupant,
							.destination = play->destination,
							.movesTo = movesCasterTo(board, definitionOf(content, card.card), card.upgraded, aimed),
						}
					);
				}
				(void)apply(board, content, choice);
			}
			events.emplace_back(event::PlanCommitted{.raider = raider, .steps = static_cast<int>(plan.size())});
		}
		state.phase = Phase::PlayerTurn;
		return events;
	}

	void playEnemyTurn(BattleState& state, const Content& content, std::vector<Event>& events) {
		takeDeathMarks(state, Side::Player, events);
		if (endIfOver(state, events) || breakOffIfQuiet(state, events)) {
			return;
		}
		beginEnemyTurn(state, events);
		for (int index = 0; index < static_cast<int>(state.drivers.size()) && state.phase == Phase::EnemyTurn; ++index) {
			const DriverIndex raider{index};
			if (!sideOf(state, raider, Side::Raiders)) {
				continue;
			}
			const std::vector<PlannedStep> plan = std::exchange(state.driver(raider).plan, {});
			if (!raiderAtTheWheel(state, raider)) {
				if (!plan.empty()) {
					events.emplace_back(event::PlanDropped{.raider = raider});
				}
				continue;
			}
			if (!canAct(state, raider)) {
				events.emplace_back(event::RaiderStunned{.raider = raider});
				continue;
			}
			state.actingRaider = raider;
			events.emplace_back(event::RaiderActing{.raider = raider});
			for (int step = 0; step < static_cast<int>(plan.size()); ++step) {
				if (!canAct(state, raider)) {
					events.emplace_back(event::PlanDropped{.raider = raider});
					break;
				}
				playStep(state, content, raider, step, plan[static_cast<size_t>(step)], events);
				if (endIfOver(state, events)) {
					return;
				}
			}
		}
		if (state.phase == Phase::EnemyTurn) {
			finishEnemyTurn(state, events);
		}
	}

	std::vector<Intent> intentsOf(const BattleState& state, const Content& content) {
		if (state.phase != Phase::PlayerTurn) {
			return {};
		}
		BattleState				 future = state;
		const std::vector<Event> events = apply(future, content, action::EndTurn{});

		std::vector<Intent>			intents;
		std::optional<Intent>		current;
		std::optional<VehicleIndex> redirected;
		bool						inVehicleHit = false;
		bool						moved = false;
		const auto					close = [&] {
			 if (!current) {
				 return;
			 }
			 Intent& intent = *current;
			 if (!intent.hits.empty() || intent.misses > 0) {
				 intent.kind = IntentKind::Attack;
			 } else if (!intent.statuses.empty()) {
				 intent.kind = IntentKind::Debuff;
			 } else if (intent.defense > 0) {
				 intent.kind = IntentKind::Defend;
			 } else if (moved) {
				 intent.kind = IntentKind::Move;
			 }
			 const OpponentId& opponent = std::get<OpponentId>(state.driver(intent.raider).profile);
			 if (content.opponents.at(opponent).intentTier != IntentTier::Basic) {
				 intent.hidden = true;
				 intent.card.reset();
				 intent.hits.clear();
				 intent.misses = 0;
				 intent.defense = 0;
				 intent.statuses.clear();
			 }
			 intents.push_back(std::move(intent));
			 current.reset();
		};

		for (const Event& event : events) {
			const bool wasVehicleHit = std::exchange(inVehicleHit, false);
			if (const auto* played = std::get_if<event::PlannedStepPlayed>(&event)) {
				close();
				const PlannedStep& step = state.driver(played->raider).plan[static_cast<size_t>(played->step)];
				const bool		   area = definitionOf(content, step.card.card).target == CardTarget::EnemyAll;
				current = Intent{
					.raider = played->raider,
					.step = played->step,
					.kind = IntentKind::Buff,
					.target = redirected ? redirected : step.target,
					.area = area,
					.movesTo = step.movesTo,
					.hidden = false,
					.card = step.card.card,
				};
				redirected.reset();
				moved = false;
			} else if (const auto* redirect = std::get_if<event::PlanRedirected>(&event)) {
				close();
				redirected = redirect->to;
			} else if (const auto* drawn = std::get_if<event::FireDrawn>(&event)) {
				close();
				redirected = drawn->to;
			} else if (std::holds_alternative<event::PlannedStepFizzled>(event) || std::holds_alternative<event::RaiderActing>(event) ||
					   std::holds_alternative<event::RaiderStunned>(event) || std::holds_alternative<event::PlanDropped>(event) ||
					   std::holds_alternative<event::DeathMarkTaken>(event) || std::holds_alternative<event::TurnStarted>(event) ||
					   std::holds_alternative<event::RaiderArrived>(event) || std::holds_alternative<event::FightEnded>(event)) {
				close();
				redirected.reset();
			} else if (!current) {
				continue;
			} else if (const auto* hit = std::get_if<event::VehicleDamaged>(&event)) {
				if (sideOf(state, hit->vehicle, Side::Player)) {
					current->hits.push_back(hit->damage);
					inVehicleHit = true;
				}
			} else if (const auto* hurt = std::get_if<event::DriverDamaged>(&event)) {
				// An occupant's share of a vehicle hit follows it; a hit on the driver alone (Headshot) stands alone.
				inVehicleHit = wasVehicleHit;
				if (!wasVehicleHit && sideOf(state, hurt->driver, Side::Player)) {
					current->hits.push_back(hurt->hitpoints);
				}
			} else if (const auto* check = std::get_if<event::HitChecked>(&event)) {
				current->misses += !check->hit && sideOf(state, check->defender, Side::Player) ? 1 : 0;
			} else if (const auto* status = std::get_if<event::StatusApplied>(&event)) {
				if (sideOf(state, status->vehicle, Side::Player)) {
					current->statuses.push_back(status->status);
				}
			} else if (const auto* shield = std::get_if<event::ShieldGained>(&event)) {
				current->defense += sideOf(state, shield->vehicle, Side::Raiders) ? shield->shield : 0;
			} else if (const auto* armor = std::get_if<event::ArmorGained>(&event)) {
				current->defense += sideOf(state, armor->vehicle, Side::Raiders) ? armor->armor : 0;
			} else if (const auto* repair = std::get_if<event::Repaired>(&event)) {
				current->defense += sideOf(state, repair->vehicle, Side::Raiders) ? repair->structure + repair->armor : 0;
			} else if (const auto* move = std::get_if<event::VehicleMoved>(&event)) {
				moved = moved || (sideOf(state, move->vehicle, Side::Raiders) && move->cause != MoveCause::LostTheFlank &&
								  move->cause != MoveCause::CloseUp);
			}
		}
		close();
		return intents;
	}

} // namespace rules
