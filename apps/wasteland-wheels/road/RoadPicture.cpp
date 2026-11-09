#include "road/RoadPicture.h"

#include "Words.h"

#include <algorithm>
#include <stdexcept>
#include <string>
#include <variant>

namespace game::road {

	using rules::BattleState;
	using rules::BattleVehicle;
	using rules::IntentKind;
	using rules::Side;
	using rules::Status;
	using rules::VehicleIndex;

	namespace {

		std::string statusLabel(Status status) {
			switch (status) {
				case Status::SpeedReduction:
					return "SLW";
				case Status::Vulnerable:
					return "VUL";
				case Status::SpeedBoost:
					return "SPD";
				case Status::EvadeBoost:
					return "EVA";
				case Status::Stunned:
					return "STN";
				case Status::TripleDamage:
					return "TRI";
				case Status::DeathMark:
					return "MRK";
				case Status::DamageBonus:
					return "DMG";
				case Status::BoxedIn:
					return "BOX";
			}
			throw std::logic_error("statusLabel: a status with no label");
		}

		// The chip carries what the status adds where it adds something (speed, evade, a damage bonus), else its turns left.
		std::string chipLabel(const rules::VehicleStatus& status) {
			std::string label = statusLabel(status.status);
			if (status.value > 0) {
				label += std::to_string(status.value);
			} else if (status.turns) {
				label += std::to_string(*status.turns);
			}
			return label;
		}

		// The vehicle a raider drives, which carries its intents.
		VehicleIndex raiderVehicle(const BattleState& state, rules::DriverIndex raider) {
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				const BattleVehicle& vehicle = state.vehicles[static_cast<size_t>(index)];
				if (vehicle.side == Side::Raiders && vehicle.owner == raider) {
					return VehicleIndex{index};
				}
			}
			throw std::logic_error("roadPicture: an intent from a raider with no vehicle");
		}

		std::optional<TargetMark> markFor(const BattleState& state, const rules::Intent& intent) {
			if (intent.area) {
				return TargetMark::Both;
			}
			if (!intent.target) {
				return std::nullopt;
			}
			const BattleVehicle& target = state.vehicle(*intent.target);
			if (target.side != Side::Player) {
				return std::nullopt;
			}
			if (target.isEscort() || !target.owner) {
				return TargetMark::Square;
			}
			// The player's seats come first in a fight, so an owner's index is its seat.
			return target.owner->value == 0 ? TargetMark::Triangle : TargetMark::Diamond;
		}

		// "6", or "6x3" for three hits of 6; hits that differ show their sum, and an area hit what each vehicle takes, the
		// most of them where a Vulnerable sets one apart.
		std::string attackValue(const rules::Intent& intent) {
			if (intent.hits.empty()) {
				return "MISS";
			}
			const auto [least, most] = std::ranges::minmax(intent.hits);
			if (intent.area) {
				return std::to_string(most);
			}
			if (intent.hits.size() == 1) {
				return std::to_string(intent.hits.front());
			}
			if (least == most) {
				return std::to_string(most) + "x" + std::to_string(intent.hits.size());
			}
			int total = 0;
			for (const int hit : intent.hits) {
				total += hit;
			}
			return std::to_string(total);
		}

		std::string intentValue(const rules::Intent& intent) {
			if (intent.hidden) {
				return "?";
			}
			switch (intent.kind) {
				case IntentKind::Attack:
					return attackValue(intent);
				case IntentKind::Debuff:
					return intent.statuses.empty() ? "DEBUFF" : statusLabel(intent.statuses.front());
				case IntentKind::Defend:
					return "+" + std::to_string(intent.defense);
				case IntentKind::Move:
					return "MOVE";
				case IntentKind::Buff:
					return "BUFF";
			}
			throw std::logic_error("intentValue: an intent of no kind");
		}

		Meter meterOf(const BattleState& state, rules::DriverIndex driver) {
			const rules::BattleDriver& fighter = state.driver(driver);
			return {.value = fighter.hitpoints, .max = fighter.maxHitpoints};
		}

		// An escort's type's class, else its owner's vehicle's as the pack has it.
		std::string vehicleClassOf(const BattleState& state, const rules::Content& content, const BattleVehicle& vehicle) {
			if (vehicle.escort) {
				return content.escorts.at(*vehicle.escort).vehicleClass;
			}
			if (!vehicle.owner) {
				return {};
			}
			const rules::BattleDriver& owner = state.driver(*vehicle.owner);
			if (const auto* archetype = std::get_if<rules::DriverId>(&owner.profile)) {
				return content.drivers.at(*archetype).vehicle.vehicleClass;
			}
			return content.opponents.at(std::get<rules::OpponentId>(owner.profile)).vehicle.vehicleClass;
		}

	} // namespace

	TokenData tokenData(
		const BattleState&			   state,
		const rules::Content&		   content,
		VehicleIndex				   index,
		std::span<const rules::Intent> intents,
		std::span<const std::string>   seats
	) {
		const BattleVehicle& vehicle = state.vehicle(index);
		TokenData			 data;
		data.name = vehicle.owner && !vehicle.escort ? fighterName(state, content, *vehicle.owner, seats)
													 : vehicleName(state, content, index, seats);
		data.vehicleClass = vehicleClassOf(state, content, vehicle);
		if (vehicle.side == Side::Raiders) {
			data.side = TokenSide::Raider;
		} else {
			data.side = vehicle.isEscort() ? TokenSide::Escort : TokenSide::Player;
			if (!vehicle.isEscort() && vehicle.owner) {
				data.seat = vehicle.owner->value;
			}
		}
		data.structure = {.value = vehicle.structure, .max = vehicle.maxStructure};
		data.armor = vehicle.armor;
		data.heavy = rules::isHeavy(vehicle);
		if (vehicle.driver && !vehicle.isEscort()) {
			data.driver = meterOf(state, *vehicle.driver);
		}
		if (vehicle.passenger) {
			data.passenger = meterOf(state, *vehicle.passenger);
		}
		data.speed = rules::speedOf(state, index);
		if (vehicle.shield > 0) {
			data.statuses.push_back("SH" + std::to_string(vehicle.shield));
		}
		for (const rules::VehicleStatus& status : vehicle.statuses) {
			data.statuses.push_back(chipLabel(status));
		}
		data.spent = vehicle.spent;
		if (vehicle.structure <= 0) {
			data.wreck = Wreck::Wrecked;
		} else if (vehicle.side == Side::Raiders && !rules::vehicleInFight(state, index)) {
			data.wreck = Wreck::NoDriver;
		}
		if (vehicle.side == Side::Raiders && vehicle.owner) {
			for (const rules::Intent& intent : intents) {
				if (intent.raider == *vehicle.owner) {
					data.intents.push_back({.value = intentValue(intent), .mark = markFor(state, intent), .kind = intent.kind});
				}
			}
		}
		return data;
	}

	RoadPicture roadPicture(
		const BattleState&				 shown,
		const rules::Content&			 content,
		std::span<const rules::Intent>	 intents,
		std::span<const rules::RoadSlot> arrivals,
		std::span<const std::string>	 seats
	) {
		RoadPicture picture;
		for (const Side side : {Side::Raiders, Side::Player}) {
			for (int index = 0; index < static_cast<int>(shown.vehicles.size()); ++index) {
				const BattleVehicle& vehicle = shown.vehicles[static_cast<size_t>(index)];
				if (vehicle.side != side || !vehicle.onRoad) {
					continue;
				}
				std::vector<rules::DriverIndex> aboard;
				for (const std::optional<rules::DriverIndex>& rider : {vehicle.driver, vehicle.passenger}) {
					if (rider) {
						aboard.push_back(*rider);
					}
				}
				picture.vehicles.push_back({
					.index = VehicleIndex{index},
					.token = tokenData(shown, content, VehicleIndex{index}, intents, seats),
					.slot = vehicle.slot,
					.reserved = vehicle.flank ? vehicle.flank->reservedSlot : std::nullopt,
					.aboard = std::move(aboard),
				});
			}
		}
		for (const rules::Row row : {rules::Row::Ahead, rules::Row::Center, rules::Row::Behind}) {
			if (std::ranges::any_of(arrivals, [row](const rules::RoadSlot& slot) { return slot.row == row; })) {
				picture.arrivals.push_back(row);
			}
		}
		for (const rules::Intent& intent : intents) {
			const VehicleIndex from = raiderVehicle(shown, intent.raider);
			if (intent.movesTo) {
				const PlannedMove move{.raider = from, .to = *intent.movesTo};
				if (std::ranges::find(picture.planned, move) == picture.planned.end()) {
					picture.planned.push_back(move);
				}
			}
			if (intent.area || (intent.target && *intent.target != from)) {
				picture.intents.push_back({
					.from = from,
					.to = intent.area ? std::nullopt : intent.target,
					.attack = intent.kind == IntentKind::Attack,
				});
			}
		}
		return picture;
	}

} // namespace game::road
