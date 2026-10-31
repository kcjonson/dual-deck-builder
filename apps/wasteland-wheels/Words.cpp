#include "Words.h"

#include <rules/campaign/Recruits.h>

#include <variant>
#include <vector>

namespace game {

	using rules::campaign::Campaign;
	using rules::campaign::DriverStatus;
	using rules::campaign::Resources;

	namespace {

		std::string capitalised(std::string_view text) {
			std::string out(text);
			if (!out.empty() && out[0] >= 'a' && out[0] <= 'z') {
				out[0] = static_cast<char>(out[0] - 'a' + 'A');
			}
			return out;
		}

		std::string resourceName(rules::map::Resource resource) {
			return std::string(nameOf(rules::map::kResourceNames, resource));
		}

		std::string laneName(rules::RoadLane lane) {
			switch (lane) {
				case rules::RoadLane::PlayerShoulder:
					return "your shoulder";
				case rules::RoadLane::PlayerOutside:
					return "your outside lane";
				case rules::RoadLane::PlayerInside:
					return "your inside lane";
				case rules::RoadLane::RaiderInside:
					return "their inside lane";
				case rules::RoadLane::RaiderOutside:
					return "their outside lane";
				case rules::RoadLane::RaiderShoulder:
					return "their shoulder";
			}
			return "a lane";
		}

	} // namespace

	std::string counted(int count, std::string_view one, std::string_view many) {
		return std::to_string(count) + " " + std::string(count == 1 ? one : many);
	}

	std::string progressText(const MapProgress& progress) {
		return "Making the area map: " + progress.stage + " (" + std::to_string(progress.index + 1) + " of " +
			   std::to_string(progress.count) + ")";
	}

	std::string storesText(const Resources& resources) {
		return "Food " + std::to_string(resources.food) + " - Water " + std::to_string(resources.water) + " - Fuel " +
			   std::to_string(resources.fuel) + " - Meds " + std::to_string(resources.meds) + " - Scrap " +
			   std::to_string(resources.scrap) + " - People " + std::to_string(resources.people);
	}

	std::string amountsText(const Resources& resources) {
		const std::vector<std::string> amounts = rules::campaign::resourceAmounts(resources);
		return amounts.empty() ? "nothing" : rules::campaign::listed(amounts);
	}

	std::string driverStanding(const Campaign& campaign, const rules::Content& content, const rules::campaign::DriverRecord& driver) {
		const std::string name = rules::campaign::driverName(campaign, content, driver.id);
		switch (driver.status) {
			case DriverStatus::Ready:
				return name + ": ready, " + std::to_string(driver.hitpoints) + "/" +
					   std::to_string(content.drivers.at(driver.archetype).maxHitpoints) + " HP";
			case DriverStatus::Injured:
				return name + ": injured, fit in " + counted(driver.injuredDays, "day", "days");
			case DriverStatus::Dead:
				return name + ": dead";
			case DriverStatus::Missing:
				return name + ": missing";
		}
		return name;
	}

	std::string stopText(const rules::map::Stop& stop) {
		using rules::map::StopType;
		switch (stop.type) {
			case StopType::Ambush:
				return "Ambush, " + counted(stop.skulls, "skull", "skulls");
			case StopType::Warband:
				return "Warband, " + counted(stop.skulls, "skull", "skulls");
			case StopType::Checkpoint:
				return "Checkpoint";
			case StopType::Wreck:
				return "Wreck";
			case StopType::Distress:
				return "Distress signal";
			case StopType::Garage:
				return "Roadside garage";
			case StopType::Hazard:
				return "Hazard";
			case StopType::FindDriver:
				return "Find: driver";
			case StopType::FindSettlers:
				return "Find: settlers";
			case StopType::FindVehicle:
				return "Find: vehicle";
			case StopType::FindCards:
				return "Find: cards";
			case StopType::FindSupplies:
				return "Find: supplies";
		}
		return "Stop";
	}

	std::string seatRefusalText(const rules::campaign::SeatBlocker& blocker) {
		using rules::campaign::SeatRefusal;
		switch (blocker.reason) {
			case SeatRefusal::CampaignOver:
				return "The campaign is over";
			case SeatRefusal::Injured:
				return "Injured, fit in " + counted(blocker.injuredDays, "day", "days");
			case SeatRefusal::DriverAway:
				return "Dead or missing";
			case SeatRefusal::AlreadySeated:
				return "Seated";
			case SeatRefusal::SameArchetype:
				return "Same archetype as a seated driver";
		}
		return "Can't be seated";
	}

	std::string departRefusalText(const rules::campaign::DepartBlocker& blocker) {
		using rules::campaign::DepartRefusal;
		switch (blocker.reason) {
			case DepartRefusal::CampaignOver:
				return "The campaign is over";
			case DepartRefusal::NoLoadOut:
				return "Nobody is seated";
			case DepartRefusal::Gone:
				return "The run has left";
			case DepartRefusal::Cleared:
				return "A run has cleared it";
			case DepartRefusal::Stronghold:
				return "No run goes to a stronghold yet";
			case DepartRefusal::Fuel:
				return "Needs " + std::to_string(blocker.fuel) + " fuel";
		}
		return "Can't leave";
	}

	std::string scavengeRefusalText(rules::campaign::ScavengeRefusal refusal) {
		using rules::campaign::ScavengeRefusal;
		switch (refusal) {
			case ScavengeRefusal::CampaignOver:
				return "The campaign is over";
			case ScavengeRefusal::Abandoned:
				return "Nobody is left to send";
			case ScavengeRefusal::RunOut:
				return "A run is out";
		}
		return "Nobody can go";
	}

	std::string choiceRefusalText(
		const rules::campaign::ChoiceBlocker& blocker,
		const rules::campaign::EventNeeds&	  needs,
		const rules::Content&				  content
	) {
		using rules::campaign::ChoiceRefusal;
		switch (blocker.reason) {
			case ChoiceRefusal::Archetype:
				return "Needs " + (needs.archetype ? content.drivers.at(*needs.archetype).name : std::string("a driver"));
			case ChoiceRefusal::Card:
				return "Needs " + (needs.card ? content.cards.at(*needs.card).name : std::string("a card"));
			case ChoiceRefusal::Escort:
				return "Needs " + (needs.escort ? content.escorts.at(*needs.escort).name : std::string("an escort"));
			case ChoiceRefusal::ConvoyFull:
				return "The convoy is full";
			case ChoiceRefusal::Cost:
				return capitalised(resourceName(blocker.resource)) + " (need " + std::to_string(blocker.needed) + ", have " +
					   std::to_string(blocker.held) + ")";
		}
		return "Can't be taken";
	}

	std::string cardText(const rules::Content& content, const rules::CardId& card) {
		const rules::CardDefinition& definition = content.cards.at(card);
		return definition.name + " (" + std::to_string(definition.cost) + ")";
	}

	std::string fighterName(const rules::BattleState& state, const rules::Content& content, rules::DriverIndex driver) {
		const rules::BattleDriver& fighter = state.driver(driver);
		if (const auto* archetype = std::get_if<rules::DriverId>(&fighter.profile)) {
			return content.drivers.at(*archetype).name;
		}
		return content.opponents.at(std::get<rules::OpponentId>(fighter.profile)).name;
	}

	std::string vehicleName(const rules::BattleState& state, const rules::Content& content, rules::VehicleIndex vehicle) {
		const rules::BattleVehicle& on = state.vehicle(vehicle);
		if (on.escort) {
			return content.escorts.at(*on.escort).name;
		}
		if (on.owner) {
			return fighterName(state, content, *on.owner) + "'s vehicle";
		}
		return "a vehicle";
	}

	std::string playText(const rules::BattleState& state, const rules::Content& content, const rules::action::PlayCard& play) {
		std::string text;
		if (play.target) {
			text = "at " + vehicleName(state, content, *play.target);
		}
		if (play.occupant) {
			text += (text.empty() ? "on " : ", on ") + fighterName(state, content, *play.occupant);
		}
		if (play.destination) {
			text += (text.empty() ? "to " : ", to ") + laneName(play.destination->lane) + ", " +
					std::string(nameOf(rules::kRowNames, play.destination->row));
		}
		return text.empty() ? "play it" : text;
	}

	std::string intentText(const rules::BattleState& state, const rules::Content& content, const rules::Intent& intent) {
		if (intent.hidden) {
			return "?";
		}
		std::string text;
		switch (intent.kind) {
			case rules::IntentKind::Attack: {
				int damage = 0;
				for (const int hit : intent.hits) {
					damage += hit;
				}
				text = "attack " + std::to_string(damage);
				if (intent.misses > 0) {
					text += " (" + std::to_string(intent.misses) + " miss)";
				}
				break;
			}
			case rules::IntentKind::Debuff:
				text = "debuff";
				break;
			case rules::IntentKind::Defend:
				text = "defend " + std::to_string(intent.defense);
				break;
			case rules::IntentKind::Move:
				text = "move";
				break;
			case rules::IntentKind::Buff:
				text = "buff";
				break;
		}
		for (const rules::Status status : intent.statuses) {
			text += ", " + std::string(nameOf(rules::kStatusNames, status));
		}
		if (intent.area) {
			text += " on everyone";
		} else if (intent.target) {
			text += " on " + vehicleName(state, content, *intent.target);
		}
		if (intent.card) {
			text += " [" + content.cards.at(*intent.card).name + "]";
		}
		return text;
	}

	std::string outcomeText(rules::Outcome outcome) {
		switch (outcome) {
			case rules::Outcome::Won:
				return "Won";
			case rules::Outcome::Lost:
				return "Lost";
			case rules::Outcome::BrokenOff:
				return "Broken off";
		}
		return "Over";
	}

} // namespace game
