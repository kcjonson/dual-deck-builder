#include "CombatBridge.h"

#include "CampaignEnd.h"
#include "RunDecks.h"

#include <rules/battle/Battle.h>
#include <rules/battle/Encounters.h>

#include <random/Rng.h>

#include <algorithm>
#include <stdexcept>
#include <string>

namespace rules::campaign {

	namespace {

		const DriverDefinition& archetypeOf(const Content& content, const DriverRecord& record) {
			const auto found = content.drivers.find(record.archetype);
			if (found == content.drivers.end()) {
				throw std::invalid_argument(record.id.value + " is a " + record.archetype.value + ", which no loaded pack defines");
			}
			return found->second;
		}

		const EscortDefinition& typeOf(const Content& content, const ConvoyEscort& escort) {
			const auto found = content.escorts.find(escort.type);
			if (found == content.escorts.end()) {
				throw std::invalid_argument(escort.id.value + " is a " + escort.type.value + ", which no loaded pack defines");
			}
			return found->second;
		}

		// The run's convoy escorts in the fight, in the order the setup seated them, which is the run's.
		std::vector<const BattleVehicle*> escortsIn(const BattleState& state) {
			std::vector<const BattleVehicle*> escorts;
			for (const BattleVehicle& vehicle : state.vehicles) {
				if (vehicle.side == Side::Player && vehicle.escort) {
					escorts.push_back(&vehicle);
				}
			}
			return escorts;
		}

		const BattleVehicle& vehicleOwnedBy(const BattleState& state, DriverIndex driver) {
			const auto found = std::ranges::find(state.vehicles, std::optional(driver), &BattleVehicle::owner);
			if (found == state.vehicles.end()) {
				throw std::invalid_argument("writeBackFight: the fight has no vehicle of the run's seat " + std::to_string(driver.value));
			}
			return *found;
		}

		// The player's seats come first in a fight, in seat order, and its convoy escorts after them in the run's order.
		void checkFightOf(const Campaign& campaign, const BattleState& state) {
			const Run& run = *campaign.run;
			bool	   matches = true;
			size_t	   players = 0;
			for (const BattleDriver& driver : state.drivers) {
				if (driver.side != Side::Player) {
					continue;
				}
				const auto* archetype = std::get_if<DriverId>(&driver.profile);
				matches = matches && players < run.seats.size() && archetype != nullptr &&
						  *archetype == campaign.driver(run.seats[players].driver).archetype;
				++players;
			}
			const std::vector<const BattleVehicle*> escorts = escortsIn(state);
			matches = matches && players == run.seats.size() && escorts.size() == run.escorts.size();
			for (size_t index = 0; matches && index < escorts.size(); ++index) {
				matches = escorts[index]->escort == campaign.findEscort(run.escorts[index])->type;
			}
			if (!matches) {
				throw std::invalid_argument("writeBackFight: the fight doesn't field the run's drivers and escorts");
			}
		}

		// What a driver's own vehicle carries out of a fight, whoever ended it at the wheel: a wreck limps on with no
		// armor, and what plating welded on past the base was for the fight only (call 393).
		VehicleCondition conditionOf(const BattleVehicle& vehicle) {
			if (vehicle.structure == 0) {
				return VehicleCondition{.structure = kLimpStructure, .armor = 0};
			}
			return VehicleCondition{.structure = vehicle.structure, .armor = std::min(vehicle.armor, vehicle.baseArmor)};
		}

		// "Cargo lost with the run: 2 fuel, 30 scrap, and Repair Kit x2." (call 23), or nothing for a run that carried nothing.
		void logCargoLost(Campaign& campaign, const Content& content, const RunLost& lost) {
			std::vector<std::string> items = resourceAmounts(lost.cargo);
			for (const auto& [card, count] : lost.cargoCards) {
				const std::string& name = content.cards.at(card).name;
				items.push_back(count == 1 ? name : name + " x" + std::to_string(count));
			}
			if (!items.empty()) {
				addLog(campaign, "Cargo lost with the run: " + listed(items) + ".");
			}
		}

		FightWriteBack loseRun(Campaign& campaign, const Content& content, const CompoundRules& rules, const BattleState& state) {
			Run			   run = std::move(*campaign.run);
			FightWriteBack result{
				.outcome = Outcome::Lost,
				.seats = {},
				.escortsLost = run.escorts,
				.dividends = {},
				.lost = RunLost{.run = run.id, .cardsLost = {}, .cargo = run.cargo, .cargoCards = run.cargoCards},
			};
			for (size_t seat = 0; seat < run.seats.size(); ++seat) {
				const DriverIndex	driver{static_cast<int>(seat)};
				const BattleDriver& fought = state.driver(driver);
				DriverRecord&		record = campaign.driver(run.seats[seat].driver);
				if (fought.isAlive()) {
					record.status = DriverStatus::Missing;
					record.hitpoints = fought.hitpoints;
					record.vehicle = conditionOf(vehicleOwnedBy(state, driver));
				} else {
					record.status = DriverStatus::Dead;
					record.hitpoints = 0;
				}
				result.seats.push_back(
					SeatWriteBack{.driver = record.id, .fate = fought.isAlive() ? SeatFate::Missing : SeatFate::Dead, .healed = 0}
				);
			}
			campaign.run.reset();
			for (const RunDeck& deck : run.seats) {
				addCards(result.lost->cardsLost, unwindRunDeck(campaign, deck));
			}
			std::erase_if(campaign.convoy, [&](const ConvoyEscort& escort) {
				return std::ranges::find(run.escorts, escort.id) != run.escorts.end();
			});
			++campaign.tally.runsFailed;
			logCargoLost(campaign, content, *result.lost);
			if (nobodyAtCompound(campaign)) {
				endCampaign(campaign, rules, EndCause::LastDriver);
			}
			return result;
		}

	} // namespace

	uint32_t nextFightSeed(const Campaign& campaign) {
		if (!campaign.run) {
			throw std::invalid_argument("nextFightSeed: no run is out");
		}
		const int run = *idNumber(campaign.run->id.value, kRunPrefix);
		return foundation::Rng(campaign.seed).fork("run", run).fork("fight", campaign.run->fights).nextUInt32();
	}

	CampaignFightStart startCampaignFight(const Campaign& campaign, const Content& content, const EncounterId& encounter) {
		if (!campaign.run) {
			throw std::invalid_argument("startCampaignFight: no run is out");
		}
		const Run&	run = *campaign.run;
		BattleSetup setup{.stage = run.stage, .seed = nextFightSeed(campaign)};
		for (const RunDeck& deck : run.seats) {
			const DriverRecord&		record = campaign.driver(deck.driver);
			const DriverDefinition& archetype = archetypeOf(content, record);
			std::vector<BattleCard> cards;
			for (const auto& [card, count] : runDeckCards(deck)) {
				cards.insert(cards.end(), static_cast<size_t>(count), BattleCard{.card = card, .upgraded = false});
			}
			for (const EscortCard& card : deck.escortCards) {
				cards.push_back(BattleCard{.card = card.card, .upgraded = false});
			}
			setup.players.push_back(
				PlayerSeat{
					.driver = record.archetype,
					.deck = std::move(cards),
					.slot = std::nullopt,
					.hitpoints = std::min(record.hitpoints, archetype.maxHitpoints),
					.structure = std::min(record.vehicle.structure, archetype.vehicle.maxStructure),
					.armor = std::min(record.vehicle.armor, archetype.vehicle.armor),
				}
			);
		}
		for (const ConvoyId& id : run.escorts) {
			const ConvoyEscort& escort = *campaign.findEscort(id);
			setup.escorts.push_back(
				EscortSeat{
					.escort = escort.type,
					.structure = std::min(escort.structure, typeOf(content, escort).structure),
					.slot = std::nullopt,
				}
			);
		}
		fieldEncounter(setup, content, encounter, run.stage);
		BattleStart start = startBattle(setup, content);
		return CampaignFightStart{
			.fight = CampaignFight{.run = run.id, .number = run.fights, .state = std::move(start.state)},
			.events = std::move(start.events),
		};
	}

	FightWriteBack writeBackFight(Campaign& campaign, const Content& content, const CampaignRules& rules, const CampaignFight& fight) {
		const BattleState& state = fight.state;
		if (state.phase != Phase::Over || !state.outcome) {
			throw std::invalid_argument("writeBackFight: the fight is still on");
		}
		if (!campaign.run || campaign.run->id != fight.run || campaign.run->fights != fight.number) {
			throw std::invalid_argument(
				"writeBackFight: the fight isn't the run out's next, so it's from another run or written back already"
			);
		}
		checkFightOf(campaign, state);
		if (*state.outcome == Outcome::Lost) {
			return loseRun(campaign, content, rules.compound, state);
		}

		Run&									run = *campaign.run;
		const bool								won = *state.outcome == Outcome::Won;
		FightWriteBack							result{.outcome = *state.outcome};
		int										heal = 0;
		const std::vector<const BattleVehicle*> escorts = escortsIn(state);
		for (size_t index = 0; index < escorts.size(); ++index) {
			const BattleVehicle& vehicle = *escorts[index];
			ConvoyEscort&		 escort = *campaign.findEscort(run.escorts[index]);
			if (vehicle.structure == 0) {
				result.escortsLost.push_back(escort.id);
				continue;
			}
			escort.structure = vehicle.structure;
			const std::optional<Dividend>& dividend = typeOf(content, escort).dividend;
			if (!won || !dividend) {
				continue;
			}
			switch (dividend->kind) {
				case DividendKind::Fuel:
					result.dividends.fuel += dividend->amount;
					break;
				case DividendKind::Scrap:
					result.dividends.scrap += dividend->amount;
					break;
				case DividendKind::Heal:
					heal += dividend->amount;
					break;
			}
		}
		run.cargo = run.cargo + result.dividends;

		for (size_t seat = 0; seat < run.seats.size(); ++seat) {
			const DriverIndex	driver{static_cast<int>(seat)};
			const BattleDriver& fought = state.driver(driver);
			DriverRecord&		record = campaign.driver(run.seats[seat].driver);
			SeatWriteBack		written{.driver = record.id};
			if (fought.isAlive()) {
				// The heal lands before anyone is revived, so it doesn't reach the revived (call 15).
				record.hitpoints = std::min(fought.hitpoints + heal, fought.maxHitpoints);
				written.fate = fought.crashedOut ? SeatFate::PickedUp : SeatFate::Fought;
				written.healed = record.hitpoints - fought.hitpoints;
			} else {
				record.hitpoints = kReviveHitpoints;
				written.fate = SeatFate::Revived;
			}
			record.vehicle = conditionOf(vehicleOwnedBy(state, driver));
			result.seats.push_back(written);
		}

		for (const ConvoyId& lost : result.escortsLost) {
			std::erase(run.escorts, lost);
			std::erase_if(campaign.convoy, [&](const ConvoyEscort& escort) { return escort.id == lost; });
			for (RunDeck& deck : run.seats) {
				std::erase_if(deck.escortCards, [&](const EscortCard& card) { return card.broughtBy == lost; });
			}
		}
		++run.fights;
		if (won) {
			++campaign.tally.fightsWon;
		}
		return result;
	}

} // namespace rules::campaign
