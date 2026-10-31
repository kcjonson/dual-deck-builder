#include "Preferences.h"

#include <rules/battle/Battle.h>

#include <algorithm>
#include <utility>

namespace ai {

	namespace {

		using rules::Event;
		using rules::VehicleIndex;

		// Whether any of the play's events lands on the vehicle.
		bool lands(const std::vector<Event>& events, VehicleIndex vehicle) {
			return std::ranges::any_of(events, [&](const Event& happened) {
				return std::visit(
					[&](const auto& kind) {
						if constexpr (requires { kind.defender; }) {
							return kind.defender == vehicle;
						} else if constexpr (requires { kind.vehicle; }) {
							return kind.vehicle == vehicle;
						} else {
							return false;
						}
					},
					happened
				);
			});
		}

		// A killer goes for driven vehicles, a looter for the convoy's haulers.
		bool preferred(const rules::Content& content, const rules::BattleVehicle& vehicle, rules::TargetPreference preference) {
			if (vehicle.side != rules::Side::Player) {
				return false;
			}
			if (preference == rules::TargetPreference::Killer) {
				return !vehicle.isEscort();
			}
			return vehicle.escort && content.escorts.at(*vehicle.escort).role == rules::EscortRole::Hauler;
		}

	} // namespace

	std::vector<rules::Action>
	preferredPlays(const rules::BattleState& board, const rules::Content& content, std::span<const rules::Action> actions) {
		std::vector<rules::Action> kept(actions.begin(), actions.end());
		if (!board.actingRaider) {
			return kept;
		}
		const rules::BattleDriver&	  raider = board.driver(*board.actingRaider);
		const rules::TargetPreference preference = content.opponents.at(std::get<rules::OpponentId>(raider.profile)).targets;
		if (preference == rules::TargetPreference::None) {
			return kept;
		}

		// The cards with a play that lands on a preferred target.
		std::vector<std::pair<rules::DriverIndex, int>> narrowed;
		for (const rules::Action& action : actions) {
			const auto* play = std::get_if<rules::action::PlayCard>(&action);
			if (!play || !play->target || !preferred(content, board.vehicle(*play->target), preference)) {
				continue;
			}
			rules::BattleState after = board;
			if (lands(rules::apply(after, content, action), *play->target)) {
				narrowed.emplace_back(play->driver, play->handIndex);
			}
		}
		std::erase_if(kept, [&](const rules::Action& action) {
			const auto* play = std::get_if<rules::action::PlayCard>(&action);
			return play && std::ranges::find(narrowed, std::pair{play->driver, play->handIndex}) != narrowed.end() &&
				   !(play->target && preferred(content, board.vehicle(*play->target), preference));
		});
		return kept;
	}

} // namespace ai
