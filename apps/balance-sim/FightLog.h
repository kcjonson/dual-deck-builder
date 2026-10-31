#pragma once

#include <rules/battle/BattleEvent.h>
#include <rules/battle/BattleState.h>
#include <rules/packs/Pack.h>

#include <iosfwd>
#include <span>
#include <string>

namespace sim {

	// A fight's events in words, a line each, for `--log` (Balance Simulation, Options). The words are the sim's, for
	// reading a fight back; the battle scene will word its own log.

	// A crew's driver by archetype and seat, `road_warrior (seat 1)`, or a raider by name and place, `Rust Buggy #3`.
	[[nodiscard]] std::string driverName(const rules::BattleState& state, const rules::Content& content, rules::DriverIndex driver);

	// A vehicle by its owner, whoever is at the wheel now, or an escort by its type.
	[[nodiscard]] std::string vehicleName(const rules::BattleState& state, const rules::Content& content, rules::VehicleIndex vehicle);

	// One event, read against the board after it.
	[[nodiscard]] std::string eventText(const rules::Event& event, const rules::BattleState& state, const rules::Content& content);

	// Each event on its own line, indented.
	void
	writeEvents(std::ostream& out, std::span<const rules::Event> events, const rules::BattleState& state, const rules::Content& content);

} // namespace sim
