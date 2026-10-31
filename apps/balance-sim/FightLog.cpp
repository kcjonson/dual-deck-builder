#include "FightLog.h"

#include <rules/core/Condition.h>
#include <rules/core/Road.h>

#include <algorithm>
#include <array>
#include <format>
#include <ostream>
#include <string_view>
#include <variant>

namespace sim {

	using namespace rules;

	namespace {

		template <typename... Ways>
		struct Worded : Ways... {
			using Ways::operator()...;
		};

		template <typename Enum, size_t Count>
		std::string_view nameIn(const EnumNames<Enum, Count>& names, Enum value) {
			const auto found = std::ranges::find(names, value, &std::pair<std::string_view, Enum>::second);
			return found == names.end() ? std::string_view("?") : found->first;
		}

		std::string_view laneName(RoadLane lane) {
			constexpr std::array<std::string_view, 6> kLanes{
				"the crew's shoulder",
				"the crew's outside lane",
				"the crew's inside lane",
				"the raiders' inside lane",
				"the raiders' outside lane",
				"the raiders' shoulder",
			};
			return kLanes[static_cast<size_t>(lane)];
		}

		std::string slotName(const RoadSlot& slot) {
			return std::format("{}, {}", laneName(slot.lane), nameIn(kRowNames, slot.row));
		}

		std::string_view moveCause(MoveCause cause) {
			constexpr std::array<std::string_view, 8> kCauses{
				"flanks",
				"swerves",
				"relocates",
				"swaps",
				"drops back",
				"shifts with the formation",
				"loses the flank",
				"closes up",
			};
			return kCauses[static_cast<size_t>(cause)];
		}

		std::string_view outcomeName(Outcome outcome) {
			switch (outcome) {
				case Outcome::Won:
					return "won";
				case Outcome::Lost:
					return "lost";
				case Outcome::BrokenOff:
					return "broken off";
			}
			return "?";
		}

		std::string counted(int count, std::string_view one) {
			return std::format("{} {}{}", count, one, count == 1 ? "" : "s");
		}

		std::string cardName(const Content& content, const BattleCard& card) {
			const auto		  found = content.cards.find(card.card);
			const std::string name = found == content.cards.end() ? card.card.value : found->second.name;
			return card.upgraded ? name + "+" : name;
		}

	} // namespace

	std::string driverName(const BattleState& state, const Content& content, DriverIndex driver) {
		const BattleDriver& seated = state.driver(driver);
		if (const auto* archetype = std::get_if<DriverId>(&seated.profile)) {
			return std::format("{} (seat {})", archetype->value, driver.value + 1);
		}
		const OpponentId& raider = std::get<OpponentId>(seated.profile);
		const auto		  found = content.opponents.find(raider);
		return std::format("{} #{}", found == content.opponents.end() ? raider.value : found->second.name, driver.value + 1);
	}

	std::string vehicleName(const BattleState& state, const Content& content, VehicleIndex vehicle) {
		const BattleVehicle& riding = state.vehicle(vehicle);
		if (riding.escort) {
			const auto found = content.escorts.find(*riding.escort);
			return std::format("the {} escort", found == content.escorts.end() ? riding.escort->value : found->second.name);
		}
		if (riding.owner) {
			return driverName(state, content, *riding.owner);
		}
		return std::format("vehicle #{}", vehicle.value + 1);
	}

	std::string eventText(const Event& event, const BattleState& state, const Content& content) {
		const auto who = [&](DriverIndex driver) {
			return driverName(state, content, driver);
		};
		const auto what = [&](VehicleIndex vehicle) {
			return vehicleName(state, content, vehicle);
		};
		return std::visit(
			Worded{
				[&](const event::TurnStarted& at) {
					return std::format("turn {}, {}", at.turn, at.side == Side::Player ? "the crew's" : "the raiders'");
				},
				[&](const event::RaiderActing& at) { return who(at.raider) + " acts"; },
				[&](const event::DeckShuffled& at) {
					return who(at.driver) + (at.fromDiscard ? " shuffles the discard into the deck" : " shuffles the deck");
				},
				[&](const event::CardDrawn& at) { return who(at.driver) + " draws " + cardName(content, at.card); },
				[&](const event::CardBurned& at) { return who(at.driver) + " draws " + cardName(content, at.card) + " past a full hand"; },
				[&](const event::HandDiscarded& at) { return who(at.driver) + " discards " + counted(at.cards, "card"); },
				[&](const event::AdrenalineRefilled& at) {
					return std::format("{} is back to {} adrenaline", who(at.driver), at.adrenaline);
				},
				[&](const event::ShieldCleared& at) { return std::format("{} loses {} shield", what(at.vehicle), at.shield); },
				[&](const event::CardPlayed& at) {
					return std::format(
						"{} plays {} for {}{}{}",
						who(at.driver),
						cardName(content, at.card),
						at.cost,
						at.target ? " at " + what(*at.target) : "",
						at.exhausted ? ", exhausting it" : ""
					);
				},
				[&](const event::HitChecked& at) {
					return std::format(
						"{} {} {}, {} against {}", what(at.attacker), at.hit ? "hits" : "misses", what(at.defender), at.skill, at.evade
					);
				},
				[&](const event::OutOfRange& at) {
					return std::format("{} is out of {}'s reach, {} against {}", what(at.defender), what(at.attacker), at.range, at.reach);
				},
				[&](const event::VehicleDamaged& at) {
					return std::format(
						"{}'s vehicle takes {}: {} off shield, {} off armor, {} off structure",
						what(at.vehicle),
						at.damage,
						at.shield,
						at.armor,
						at.structure
					);
				},
				[&](const event::DriverDamaged& at) { return std::format("{} takes {} HP", who(at.driver), at.hitpoints); },
				[&](const event::DriverDown& at) { return who(at.driver) + " goes down"; },
				[&](const event::TookTheWheel& at) { return who(at.driver) + " takes the wheel of " + what(at.vehicle); },
				[&](const event::CarriesOnAsEscort& at) { return what(at.vehicle) + " carries on as an escort"; },
				[&](const event::Unmanned& at) { return what(at.vehicle) + " has nobody at the wheel"; },
				[&](const event::VehicleWrecked& at) { return what(at.vehicle) + " is wrecked"; },
				[&](const event::JumpedAboard& at) { return who(at.driver) + " jumps aboard " + what(at.vehicle); },
				[&](const event::CrashedOut& at) { return who(at.driver) + " crashes out"; },
				[&](const event::LeftRoad& at) { return what(at.vehicle) + " leaves the road"; },
				[&](const event::ShieldGained& at) { return std::format("{} gains {} shield", what(at.vehicle), at.shield); },
				[&](const event::ArmorGained& at) { return std::format("{} gains {} armor", what(at.vehicle), at.armor); },
				[&](const event::Repaired& at) {
					return std::format("{} is repaired {} structure and {} armor", what(at.vehicle), at.structure, at.armor);
				},
				[&](const event::DriverHealed& at) { return std::format("{} heals {} HP", who(at.driver), at.hitpoints); },
				[&](const event::AdrenalineGained& at) { return std::format("{} gains {} adrenaline", who(at.driver), at.adrenaline); },
				[&](const event::VehicleMoved& at) {
					return std::format("{} {} from {} to {}", what(at.vehicle), moveCause(at.cause), slotName(at.from), slotName(at.to));
				},
				[&](const event::MoveBlocked& at) {
					return what(at.vehicle) + " can't move" + (at.cancelsCard ? ", and the card stops there" : "");
				},
				[&](const event::StatusApplied& at) {
					return std::format(
						"{} is {} {}{}",
						what(at.vehicle),
						nameIn(kStatusNames, at.status),
						at.value,
						at.turns ? std::format(" for {} turns", *at.turns) : ""
					);
				},
				[&](const event::StatusEnded& at) {
					return std::format("{}'s {} wears off", what(at.vehicle), nameIn(kStatusNames, at.status));
				},
				[&](const event::BecameSteady& at) { return what(at.vehicle) + " is steady"; },
				[&](const event::ShookOffStun& at) { return what(at.vehicle) + " shakes off the stun"; },
				[&](const event::RaiderStunned& at) { return who(at.raider) + " can't be stunned again this turn"; },
				[&](const event::OrderCarried& at) {
					return what(at.escort) + " carries out its order" + (at.target ? " at " + what(*at.target) : "");
				},
				[&](const event::EscortSpent& at) { return what(at.escort) + " is spent"; },
				[&](const event::DrawingFire& at) { return what(at.escort) + " draws fire"; },
				[&](const event::FireDrawn& at) {
					return std::format("{}'s step {} turns from {} to {}", who(at.raider), at.step + 1, what(at.from), what(at.to));
				},
				[&](const event::PlanCommitted& at) { return who(at.raider) + " plans " + counted(at.steps, "step"); },
				[&](const event::PlannedStepPlayed& at) { return std::format("{} plays step {}", who(at.raider), at.step + 1); },
				[&](const event::PlannedStepFizzled& at) {
					return std::format("{}'s step {}, {}, fizzles: {}", who(at.raider), at.step + 1, cardName(content, at.card), at.reason);
				},
				[&](const event::PlanRedirected& at) {
					return std::format("{}'s step {} turns from {} to {}", who(at.raider), at.step + 1, what(at.from), what(at.to));
				},
				[&](const event::PlanDropped& at) { return who(at.raider) + " drops its plan"; },
				[&](const event::DeathMarkTaken& at) { return who(at.driver) + " takes the death mark on " + what(at.vehicle); },
				[&](const event::WaveDue& at) { return std::format("wave {} is coming", at.wave); },
				[&](const event::RaiderArrived& at) { return std::format("{} pulls in at {}", who(at.raider), slotName(at.slot)); },
				[&](const event::FightEnded& at) {
					std::string ended = std::format("the fight is {}", outcomeName(at.outcome));
					if (at.rout) {
						ended +=
							*at.rout == RoutCause::LeaderOut ? ", the rest routed with their leader out" : ", the rest routed, thinned out";
					}
					return ended;
				},
			},
			event
		);
	}

	void writeEvents(std::ostream& out, std::span<const Event> events, const BattleState& state, const Content& content) {
		for (const Event& event : events) {
			out << "    " << eventText(event, state, content) << "\n";
		}
	}

} // namespace sim
