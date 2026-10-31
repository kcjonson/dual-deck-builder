#include "Movement.h"

#include <algorithm>
#include <cassert>
#include <tuple>

namespace rules {

	namespace {

		RoadLane insideLaneOf(Side side) {
			return roadSlotOf(side, {.lane = Lane::Inside, .row = Row::Center}).lane;
		}

	} // namespace

	std::optional<VehicleIndex> partnerVehicleOf(const BattleState& state, DriverIndex caster) {
		const std::optional<DriverIndex> partner = partnerOf(state, caster);
		if (!partner || !driverInFight(state, *partner)) {
			return std::nullopt;
		}
		const std::optional<VehicleIndex> theirs = vehicleCarrying(state, *partner);
		return theirs == vehicleCarrying(state, caster) ? std::nullopt : theirs;
	}

	std::optional<std::string> flankBlocker(const BattleState& state, VehicleIndex flanker, VehicleIndex target, int speedBonus) {
		const BattleVehicle& runner = state.vehicle(flanker);
		const BattleVehicle& outrun = state.vehicle(target);
		if (runner.side == outrun.side) {
			return "a flank outruns a vehicle on the other side";
		}
		if (isFlanking(runner)) {
			return "it's already flanking";
		}
		if (hasStatus(runner, Status::BoxedIn)) {
			return "it's boxed in and can't flank";
		}
		if (!vehicleInFight(state, target) || isFlanking(outrun)) {
			return "the vehicle to outrun has to be in its formation";
		}
		if (std::max(0, speedOf(state, flanker) + speedBonus) <= speedOf(state, target)) {
			return "it isn't faster than the vehicle it would outrun";
		}
		if (slotTaken(state, {.lane = flankShoulderOf(runner.side), .row = outrun.slot.row})) {
			return "the shoulder in that row is taken";
		}
		return std::nullopt;
	}

	std::vector<RoadSlot> moveDestinations(
		const BattleState&			  state,
		const effect::ChangePosition& move,
		VehicleIndex				  mover,
		RoadSlot					  from,
		std::optional<VehicleIndex>	  partner
	) {
		const BattleVehicle& vehicle = state.vehicle(mover);
		if (move.move == Move::DropBack) {
			if (vehicle.flank && vehicle.flank->reservedSlot) {
				return {*vehicle.flank->reservedSlot};
			}
			return {};
		}
		assert(
			(move.move == Move::Swerve || move.move == Move::Relocate) && move.to && "moveDestinations: a swerve, a move, or a drop-back"
		);
		if (isFlanking(vehicle)) {
			return {};
		}

		std::vector<RoadSlot> candidates;
		const auto			  add = [&](RoadLane lane, std::optional<Row> row) {
			   if (row) {
				   candidates.push_back({.lane = lane, .row = *row});
			   }
		};
		const auto otherLane = [&] {
			add(otherLaneOf(from.lane), from.row);
		};
		const auto ahead = [&] {
			add(from.lane, rowAhead(from.row));
		};
		const auto behind = [&] {
			add(from.lane, rowBehind(from.row));
		};
		switch (*move.to) {
			case Destination::OtherLane:
				otherLane();
				break;
			case Destination::Outside:
				if (from.lane == insideLaneOf(vehicle.side)) {
					otherLane();
				}
				break;
			case Destination::Ahead:
				ahead();
				break;
			case Destination::Behind:
				behind();
				break;
			case Destination::Pick:
				if (move.move == Move::Relocate) {
					for (const RoadSlot slot : openingOrder(vehicle.side)) {
						candidates.push_back(slot);
					}
				} else {
					otherLane();
					ahead();
					behind();
				}
				break;
			case Destination::PickRow:
				ahead();
				behind();
				break;
			case Destination::BehindPartner:
				if (partner && !isFlanking(state.vehicle(*partner))) {
					const RoadSlot theirs = state.vehicle(*partner).slot;
					add(theirs.lane, rowBehind(theirs.row));
				}
				break;
		}
		std::erase_if(candidates, [&](RoadSlot slot) { return !inFormationOf(vehicle.side, slot.lane) || slotTaken(state, slot); });
		return candidates;
	}

	std::optional<std::string> swapBlocker(const BattleState& state, DriverIndex caster, VehicleIndex other) {
		const std::optional<VehicleIndex> mine = vehicleCarrying(state, caster);
		assert(mine && "swapBlocker: the caster rides in a vehicle");
		const BattleVehicle& from = state.vehicle(*mine);
		const BattleVehicle& with = state.vehicle(other);
		if (other == *mine || with.side != from.side || !vehicleInFight(state, other)) {
			return "it swaps with another vehicle on your side";
		}
		if (isFlanking(from) || isFlanking(with)) {
			return "neither vehicle in a swap can be flanking";
		}
		if (other != partnerVehicleOf(state, caster) && !(with.isEscort() && slotRange(from.slot, with.slot) == 1)) {
			return "it swaps with your partner's vehicle or an escort next to you";
		}
		return std::nullopt;
	}

	void moveVehicle(
		BattleState&			  state,
		VehicleIndex			  index,
		RoadSlot				  to,
		std::optional<FlankState> flank,
		MoveCause				  cause,
		std::vector<Event>&		  events
	) {
		BattleVehicle& vehicle = state.vehicle(index);
		const RoadSlot from = vehicle.slot;
		vehicle.slot = to;
		vehicle.flank = flank;
		vehicle.swervedThisTurn = vehicle.swervedThisTurn || (cause != MoveCause::LostTheFlank && cause != MoveCause::CloseUp);
		events.emplace_back(event::VehicleMoved{.vehicle = index, .from = from, .to = to, .cause = cause});
	}

	void shiftFormation(BattleState& state, Side side, std::vector<Event>& events) {
		for (int number = 0; number < static_cast<int>(state.vehicles.size()); ++number) {
			BattleVehicle& vehicle = state.vehicles[static_cast<size_t>(number)];
			if (vehicle.side != side || !vehicle.onRoad) {
				continue;
			}
			if (vehicle.flank) {
				if (vehicle.flank->reservedSlot) {
					vehicle.flank->reservedSlot->lane = otherLaneOf(vehicle.flank->reservedSlot->lane);
				}
				continue;
			}
			moveVehicle(
				state,
				VehicleIndex{number},
				{.lane = otherLaneOf(vehicle.slot.lane), .row = vehicle.slot.row},
				std::nullopt,
				MoveCause::FormationShift,
				events
			);
		}
	}

	void dropBackFlankers(BattleState& state, std::vector<Event>& events) {
		for (int number = 0; number < static_cast<int>(state.vehicles.size()); ++number) {
			const VehicleIndex	 index{number};
			const BattleVehicle& vehicle = state.vehicle(index);
			if (!vehicle.flank || !vehicle.flank->reservedSlot || !vehicle.flank->outran || !vehicleInFight(state, index)) {
				continue;
			}
			const VehicleIndex outran = *vehicle.flank->outran;
			if (vehicleInFight(state, outran) && speedOf(state, index) <= speedOf(state, outran)) {
				moveVehicle(state, index, *vehicle.flank->reservedSlot, std::nullopt, MoveCause::LostTheFlank, events);
			}
		}
	}

	void closeUpRaiders(BattleState& state, std::vector<Event>& events) {
		// Across from each driven vehicle in the player's formation, Driver 1's row first (calls 190 and 192).
		std::vector<RoadSlot> across;
		for (int number = 0; number < static_cast<int>(state.vehicles.size()); ++number) {
			const BattleVehicle& vehicle = state.vehicles[static_cast<size_t>(number)];
			if (vehicle.side != Side::Player || vehicle.isEscort() || isFlanking(vehicle) || !vehicleInFight(state, VehicleIndex{number})) {
				continue;
			}
			const RoadSlot slot{.lane = insideLaneOf(Side::Raiders), .row = vehicle.slot.row};
			if (std::ranges::find(across, slot) == across.end()) {
				across.push_back(slot);
			}
		}
		for (const RoadSlot slot : across) {
			if (slotTaken(state, slot)) {
				continue;
			}
			std::optional<VehicleIndex> nearest;
			std::tuple<int, int>		nearestDistance{};
			for (int number = 0; number < static_cast<int>(state.vehicles.size()); ++number) {
				const BattleVehicle& raider = state.vehicles[static_cast<size_t>(number)];
				if (raider.side != Side::Raiders || isFlanking(raider) || !vehicleInFight(state, VehicleIndex{number}) ||
					std::ranges::find(across, raider.slot) != across.end()) {
					continue;
				}
				const std::tuple<int, int> distance{slotRange(raider.slot, slot), tieRank(Side::Raiders, raider.slot)};
				if (!nearest || distance < nearestDistance) {
					nearest = VehicleIndex{number};
					nearestDistance = distance;
				}
			}
			if (nearest) {
				moveVehicle(state, *nearest, slot, std::nullopt, MoveCause::CloseUp, events);
			}
		}
	}

} // namespace rules
