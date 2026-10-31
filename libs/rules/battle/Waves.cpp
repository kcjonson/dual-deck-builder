#include "Waves.h"

#include "Battle.h"
#include "Hands.h"

#include <algorithm>
#include <cassert>
#include <utility>

namespace rules {

	namespace {

		// The free formation slots the next wave's raiders would take now, as many as the road cap leaves room for.
		std::vector<RoadSlot> arrivalSlots(const BattleState& state) {
			const Reinforcements& reinforcements = state.reinforcements;
			if (reinforcements.queue.empty()) {
				return {};
			}
			int room = static_cast<int>(reinforcements.queue.front().raiders.size());
			if (reinforcements.roadCap) {
				room = std::min(room, std::max(0, *reinforcements.roadCap - raidersInFight(state)));
			}
			std::vector<RoadSlot> slots;
			for (const RoadSlot slot : openingOrder(Side::Raiders, reinforcements.lastOutRow)) {
				if (static_cast<int>(slots.size()) < room && !slotTaken(state, slot)) {
					slots.push_back(slot);
				}
			}
			return slots;
		}

	} // namespace

	int waveOnRoad(const BattleState& state) {
		const Reinforcements& reinforcements = state.reinforcements;
		const bool			  started = !reinforcements.queue.empty() && reinforcements.queue.front().started;
		return reinforcements.total - static_cast<int>(reinforcements.queue.size()) + (started ? 1 : 0);
	}

	std::vector<RoadSlot> arrivalsOf(const BattleState& state, const Content& content) {
		if (state.phase != Phase::PlayerTurn || state.reinforcements.queue.empty()) {
			return {};
		}
		BattleState			  future = state;
		std::vector<RoadSlot> slots;
		for (const Event& event : apply(future, content, action::EndTurn{})) {
			if (const auto* arrived = std::get_if<event::RaiderArrived>(&event)) {
				slots.push_back(arrived->slot);
			}
		}
		return slots;
	}

	int raidersInFight(const BattleState& state) {
		int raiders = 0;
		for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
			const bool raider = state.vehicles[static_cast<size_t>(index)].side == Side::Raiders;
			raiders += raider && vehicleInFight(state, VehicleIndex{index}) ? 1 : 0;
		}
		return raiders;
	}

	VehicleIndex seatRaider(BattleState& state, QueuedRaider raider) {
		const DriverIndex  driver{static_cast<int>(state.drivers.size())};
		const VehicleIndex vehicle{static_cast<int>(state.vehicles.size())};
		assert(raider.driver.side == Side::Raiders && raider.vehicle.side == Side::Raiders && "seatRaider: a raider's seat");
		raider.vehicle.owner = driver;
		raider.vehicle.driver = driver;
		state.drivers.push_back(std::move(raider.driver));
		state.vehicles.push_back(std::move(raider.vehicle));
		return vehicle;
	}

	void noteRaiderOut(BattleState& state, VehicleIndex index) {
		const BattleVehicle& vehicle = state.vehicle(index);
		assert(vehicle.side == Side::Raiders && !vehicleInFight(state, index) && "noteRaiderOut: a raider just out of the fight");
		const bool reserved = vehicle.flank && vehicle.flank->reservedSlot;
		state.reinforcements.lastOutRow = reserved ? vehicle.flank->reservedSlot->row : vehicle.slot.row;
	}

	void announceWave(BattleState& state, std::vector<Event>& events) {
		Reinforcements& reinforcements = state.reinforcements;
		if (reinforcements.queue.empty() || reinforcements.due) {
			return;
		}
		reinforcements.due = true;
		events.emplace_back(event::WaveDue{.wave = reinforcements.total - static_cast<int>(reinforcements.queue.size()) + 1});
	}

	void checkWaveDue(BattleState& state, std::vector<Event>& events) {
		const Reinforcements& reinforcements = state.reinforcements;
		if (reinforcements.queue.empty() || reinforcements.due) {
			return;
		}
		const QueuedWave& next = reinforcements.queue.front();
		const int		  onRoad = raidersInFight(state);
		const bool		  thinned = next.arriveAt && onRoad <= *next.arriveAt;
		const bool		  waited = next.afterTurns && state.turn - reinforcements.sinceTurn >= *next.afterTurns;
		if (thinned || waited || onRoad == 0) {
			announceWave(state, events);
		}
	}

	void landWave(BattleState& state, std::vector<Event>& events) {
		if (state.reinforcements.queue.empty() || (!state.reinforcements.due && raidersInFight(state) > 0)) {
			return;
		}
		for (const RoadSlot slot : arrivalSlots(state)) {
			QueuedWave&	 next = state.reinforcements.queue.front();
			QueuedRaider raider = std::move(next.raiders.front());
			next.raiders.erase(next.raiders.begin());
			next.started = true;
			const VehicleIndex vehicle = seatRaider(state, std::move(raider));
			state.vehicle(vehicle).slot = slot;
			const DriverIndex driver = *state.vehicle(vehicle).driver;
			events.emplace_back(event::RaiderArrived{.raider = driver, .vehicle = vehicle, .slot = slot});
			shuffleDeck(state, driver, false, events);
		}
		Reinforcements& reinforcements = state.reinforcements;
		if (reinforcements.queue.front().raiders.empty()) {
			reinforcements.queue.erase(reinforcements.queue.begin());
			reinforcements.due = false;
			// The enemy turn shares the player turn's number, so the wave first plays in the next.
			reinforcements.sinceTurn = state.turn + 1;
		}
	}

} // namespace rules
