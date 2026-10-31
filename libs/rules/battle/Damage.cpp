#include "Damage.h"

#include <algorithm>
#include <cassert>
#include <tuple>

namespace rules {

	namespace {

		std::vector<DriverIndex> livingAboard(const BattleState& state, const BattleVehicle& vehicle) {
			std::vector<DriverIndex> aboard;
			for (const std::optional<DriverIndex>& seat : {vehicle.driver, vehicle.passenger}) {
				if (seat && state.driver(*seat).isAlive()) {
					aboard.push_back(*seat);
				}
			}
			return aboard;
		}

		// A player's survivor takes the partner's driven vehicle first, then the escort nearest the wreck; a
		// raider takes the first free seat on its side (Combat Rules, Losing vehicles and drivers).
		std::optional<VehicleIndex> freeSeatFor(const BattleState& state, Side side, VehicleIndex wreck) {
			std::optional<VehicleIndex> nearestEscort;
			std::tuple<int, int>		nearestDistance{};
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				const VehicleIndex	 candidate{index};
				const BattleVehicle& vehicle = state.vehicle(candidate);
				if (candidate == wreck || vehicle.side != side || vehicle.passenger || !vehicleInFight(state, candidate)) {
					continue;
				}
				if (side == Side::Raiders || !vehicle.isEscort()) {
					return candidate;
				}
				const std::tuple<int, int> distance{slotRange(state.vehicle(wreck).slot, vehicle.slot), tieRank(side, vehicle.slot)};
				if (!nearestEscort || distance < nearestDistance) {
					nearestEscort = candidate;
					nearestDistance = distance;
				}
			}
			return nearestEscort;
		}

		void wreck(BattleState& state, VehicleIndex index, std::vector<Event>& events) {
			BattleVehicle& vehicle = state.vehicle(index);
			events.emplace_back(event::VehicleWrecked{.vehicle = index});
			const std::vector<DriverIndex> survivors = livingAboard(state, vehicle);
			vehicle.escaped = survivors;
			vehicle.driver.reset();
			vehicle.passenger.reset();
			for (const DriverIndex survivor : survivors) {
				const std::optional<VehicleIndex> seat = freeSeatFor(state, state.driver(survivor).side, index);
				if (seat) {
					state.vehicle(*seat).passenger = survivor;
					events.emplace_back(event::JumpedAboard{.driver = survivor, .vehicle = *seat});
				} else {
					state.driver(survivor).crashedOut = true;
					events.emplace_back(event::CrashedOut{.driver = survivor});
				}
			}
		}

		void settleCasualties(BattleState& state, VehicleIndex index, std::vector<Event>& events) {
			BattleVehicle& vehicle = state.vehicle(index);
			for (std::optional<DriverIndex>* seat : {&vehicle.driver, &vehicle.passenger}) {
				if (*seat && !state.driver(**seat).isAlive()) {
					events.emplace_back(event::DriverDown{.driver = **seat});
					seat->reset();
				}
			}
			if (vehicle.structure == 0) {
				wreck(state, index, events);
				return;
			}
			if (vehicle.driver || vehicle.isEscort()) {
				return;
			}
			if (vehicle.passenger) {
				vehicle.driver = vehicle.passenger;
				vehicle.passenger.reset();
				events.emplace_back(event::TookTheWheel{.driver = *vehicle.driver, .vehicle = index});
			} else if (vehicle.side == Side::Player) {
				// It only ever converts mid-turn, so it starts spent (escorts.md, decision 43).
				vehicle.crew = kUnmannedCrew;
				vehicle.spent = true;
				events.emplace_back(event::CarriesOnAsEscort{.vehicle = index});
			} else {
				events.emplace_back(event::Unmanned{.vehicle = index});
			}
		}

	} // namespace

	void damageVehicle(BattleState& state, VehicleIndex index, int damage, bool structureOnly, std::vector<Event>& events) {
		assert(damage >= 0 && vehicleInFight(state, index) && "damageVehicle: a hit lands on a vehicle in the fight");
		BattleVehicle&				   vehicle = state.vehicle(index);
		const std::vector<DriverIndex> aboard = livingAboard(state, vehicle);

		const int shield = structureOnly ? 0 : std::min(damage, vehicle.shield);
		const int armor = structureOnly ? 0 : std::min(damage - shield, vehicle.armor);
		const int remaining = damage - shield - armor;
		const int occupantShare = structureOnly || aboard.empty() ? 0 : (remaining + 1) / 2;
		const int structureShare = occupantShare > 0 ? occupantShare : remaining;
		const int structure = std::min(structureShare, vehicle.structure);

		vehicle.shield -= shield;
		vehicle.armor -= armor;
		vehicle.structure -= structure;
		events.emplace_back(
			event::VehicleDamaged{.vehicle = index, .damage = damage, .shield = shield, .armor = armor, .structure = structure}
		);
		if (occupantShare > 0) {
			for (const DriverIndex occupant : aboard) {
				BattleDriver& hurt = state.driver(occupant);
				const int	  hitpoints = std::min(occupantShare, hurt.hitpoints);
				hurt.hitpoints -= hitpoints;
				events.emplace_back(event::DriverDamaged{.driver = occupant, .hitpoints = hitpoints});
			}
		}
		settleCasualties(state, index, events);
	}

	void damageDriver(BattleState& state, DriverIndex index, int damage, std::vector<Event>& events) {
		const std::optional<VehicleIndex> vehicle = vehicleCarrying(state, index);
		assert(
			damage >= 0 && vehicle && driverInFight(state, index) && "damageDriver: the hit lands on someone aboard a vehicle in the fight"
		);
		BattleDriver& hurt = state.driver(index);
		const int	  hitpoints = std::min(damage, hurt.hitpoints);
		hurt.hitpoints -= hitpoints;
		events.emplace_back(event::DriverDamaged{.driver = index, .hitpoints = hitpoints});
		settleCasualties(state, *vehicle, events);
	}

} // namespace rules
