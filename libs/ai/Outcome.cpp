#include "Outcome.h"

#include <rules/battle/Battle.h>
#include <rules/battle/CardPlay.h>
#include <rules/battle/Movement.h>

#include <algorithm>

namespace ai {

	namespace {

		using rules::BattleState;
		using rules::Side;
		using rules::VehicleIndex;
		namespace event = rules::event;

		bool canFlankAnyone(const BattleState& state, VehicleIndex flanker) {
			if (!rules::vehicleInFight(state, flanker)) {
				return false;
			}
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				const VehicleIndex other{index};
				if (state.vehicle(other).side != state.vehicle(flanker).side && !rules::flankBlocker(state, flanker, other, 0)) {
					return true;
				}
			}
			return false;
		}

		// A flanker holds the shoulder past the turn's end while it's faster than what it outran, or when there's no
		// slot to drop back to or nobody left to drop back from.
		bool holdsFlank(const BattleState& state, VehicleIndex flanker) {
			const std::optional<rules::FlankState>& flank = state.vehicle(flanker).flank;
			if (!flank || !flank->reservedSlot || !flank->outran || !rules::vehicleInFight(state, *flank->outran)) {
				return true;
			}
			return rules::speedOf(state, flanker) > rules::speedOf(state, *flank->outran);
		}

		double hurtFactor(int now, int most) {
			return 2.0 - static_cast<double>(now) / static_cast<double>(std::max(1, most));
		}

		std::optional<int> nearestDriven(const BattleState& state, VehicleIndex from) {
			if (!rules::vehicleInFight(state, from)) {
				return std::nullopt;
			}
			std::optional<int> nearest;
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				const rules::BattleVehicle& other = state.vehicles[static_cast<size_t>(index)];
				if (other.side == state.vehicle(from).side || other.isEscort() || !rules::vehicleInFight(state, VehicleIndex{index})) {
					continue;
				}
				const int range = rules::slotRange(state.vehicle(from).slot, other.slot);
				nearest = nearest ? std::min(*nearest, range) : range;
			}
			return nearest;
		}

	} // namespace

	Outcome outcomeOf(const BattleState& board, const rules::Content& content, const rules::action::PlayCard& play) {
		Outcome outcome{
			.after = board, .events = {}, .side = board.driver(play.driver).side, .actor = *rules::vehicleCarrying(board, play.driver)
		};
		const rules::BattleCard& card = board.driver(play.driver).hand[static_cast<size_t>(play.handIndex)];
		outcome.cost = rules::cardCost(rules::definitionOf(content, card.card), card.upgraded);
		outcome.events = rules::apply(outcome.after, content, play);
		const BattleState& after = outcome.after;
		const Side		   mine = outcome.side;
		const VehicleIndex actor = outcome.actor;

		for (int index = 0; index < static_cast<int>(board.vehicles.size()); ++index) {
			const rules::BattleVehicle& was = board.vehicles[static_cast<size_t>(index)];
			const rules::BattleVehicle& now = after.vehicles[static_cast<size_t>(index)];
			if (was.side == mine) {
				continue;
			}
			outcome.vehicles.push_back(
				Loss{
					.armor = std::max(0, was.armor - now.armor),
					.structure = std::max(0, was.structure - now.structure),
					.hitpoints = 0,
					.hurt = hurtFactor(was.structure, was.maxStructure),
				}
			);
			const bool out = rules::vehicleInFight(board, VehicleIndex{index}) && !rules::vehicleInFight(after, VehicleIndex{index});
			outcome.vehiclesOut += out ? 1 : 0;
			outcome.wrecks += was.structure > 0 && now.structure == 0 ? 1 : 0;
		}
		for (size_t index = 0; index < board.drivers.size(); ++index) {
			const rules::BattleDriver& was = board.drivers[index];
			const rules::BattleDriver& now = after.drivers[index];
			if (was.side == mine) {
				continue;
			}
			outcome.drivers.push_back(
				Loss{
					.armor = 0,
					.structure = 0,
					.hitpoints = std::max(0, was.hitpoints - now.hitpoints),
					.hurt = hurtFactor(was.hitpoints, was.maxHitpoints),
				}
			);
			outcome.driversDown += was.isAlive() && !now.isAlive() ? 1 : 0;
		}

		const auto ours = [&](VehicleIndex vehicle) {
			return board.vehicle(vehicle).side == mine;
		};
		bool ramming = false;
		for (const rules::Event& happened : outcome.events) {
			if (const auto* check = std::get_if<event::HitChecked>(&happened)) {
				ramming = check->hit && check->attackType == rules::AttackType::Ramming && !ours(check->defender);
			} else if (const auto* hit = std::get_if<event::VehicleDamaged>(&happened)) {
				outcome.rammed += ramming && !ours(hit->vehicle) ? hit->armor + hit->structure : 0;
			} else if (const auto* hurt = std::get_if<event::DriverDamaged>(&happened)) {
				outcome.rammed += ramming && board.driver(hurt->driver).side != mine ? hurt->hitpoints : 0;
			} else if (const auto* shield = std::get_if<event::ShieldGained>(&happened)) {
				outcome.shield += ours(shield->vehicle) ? shield->shield : 0;
			} else if (const auto* armor = std::get_if<event::ArmorGained>(&happened)) {
				outcome.armor += ours(armor->vehicle) ? armor->armor : 0;
			} else if (const auto* repair = std::get_if<event::Repaired>(&happened)) {
				const rules::BattleVehicle& repaired = board.vehicle(repair->vehicle);
				if (ours(repair->vehicle)) {
					outcome.repairs.push_back(
						{.structure = repair->structure,
						 .armor = repair->armor,
						 .critical = repaired.structure * 10 < repaired.maxStructure * 3}
					);
				}
			} else if (const auto* status = std::get_if<event::StatusApplied>(&happened)) {
				outcome.statusesOnThem += ours(status->vehicle) ? 0 : 1;
			} else if (const auto* drawn = std::get_if<event::CardDrawn>(&happened)) {
				outcome.cardsDrawn += board.driver(drawn->driver).side == mine ? 1 : 0;
			} else if (const auto* gained = std::get_if<event::AdrenalineGained>(&happened)) {
				outcome.adrenaline += board.driver(gained->driver).side == mine ? gained->adrenaline : 0;
			}
		}

		if (rules::vehicleInFight(after, actor)) {
			outcome.speedGained = rules::speedOf(after, actor) - rules::speedOf(board, actor);
		}
		const bool wasFlanking = rules::isFlanking(board.vehicle(actor));
		const bool nowFlanking = rules::isFlanking(after.vehicle(actor));
		outcome.gaveUpHeldFlank = wasFlanking && !nowFlanking && holdsFlank(board, actor);
		outcome.tookFlank = !wasFlanking && nowFlanking;
		outcome.opensFlank = !nowFlanking && !canFlankAnyone(board, actor) && canFlankAnyone(after, actor);
		outcome.rangeBefore = nearestDriven(board, actor);
		outcome.rangeAfter = nearestDriven(after, actor);
		outcome.spentAllAdrenaline = after.driver(play.driver).adrenaline == 0;
		return outcome;
	}

} // namespace ai
