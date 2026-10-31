#include "Battle.h"

#include "CardPlay.h"
#include "Hands.h"
#include "Movement.h"
#include "Statuses.h"
#include "Turns.h"

#include <algorithm>
#include <stdexcept>

namespace rules {

	namespace {

		const DriverDefinition& driverDefinition(const Content& content, const DriverId& id) {
			const auto found = content.drivers.find(id);
			if (found == content.drivers.end()) {
				throw std::invalid_argument("startBattle: no loaded pack defines driver " + id.value);
			}
			return found->second;
		}

		const OpponentDefinition& opponentDefinition(const Content& content, const OpponentId& id) {
			const auto found = content.opponents.find(id);
			if (found == content.opponents.end()) {
				throw std::invalid_argument("startBattle: no loaded pack defines opponent " + id.value);
			}
			return found->second;
		}

		void checkDeck(const Content& content, const std::vector<BattleCard>& deck, const std::string& owner) {
			for (const BattleCard& card : deck) {
				const auto found = content.cards.find(card.card);
				if (found == content.cards.end()) {
					throw std::invalid_argument(
						"startBattle: " + owner + "'s deck holds " + card.card.value + ", which no loaded pack defines"
					);
				}
				if (card.upgraded && !found->second.upgrade) {
					throw std::invalid_argument(
						"startBattle: " + owner + "'s deck holds an upgraded " + card.card.value + ", which has no upgrade"
					);
				}
			}
		}

		BattleVehicle vehicleFrom(Side side, DriverIndex owner, const VehicleStats& stats) {
			return BattleVehicle{
				.side = side,
				.owner = owner,
				.maxStructure = stats.maxStructure,
				.structure = stats.maxStructure,
				.baseArmor = stats.armor,
				.armor = stats.armor,
				.shield = 0,
				.baseSpeed = stats.speed,
				.driver = owner,
				.passenger = std::nullopt,
				.crew = std::nullopt,
				.slot = {},
				.onRoad = true,
			};
		}

		// Where a seat's vehicle asks to open: a slot in its formation, an ambush row, or wherever's next.
		struct Opening {
			std::optional<FormationSlot> slot;
			std::optional<Row>			 ambush;
		};

		// Combat Rules, The road: a vehicle the setup places starts there; the rest fill their formation in
		// opening order. An ambusher starts flanking, in a row with one of the player's vehicles.
		void placeVehicles(BattleState& state, const std::vector<Opening>& wanted) {
			std::vector<RoadSlot> taken;
			for (const Side side : {Side::Player, Side::Raiders}) {
				for (size_t index = 0; index < state.vehicles.size(); ++index) {
					if (state.vehicles[index].side != side || !wanted[index].slot) {
						continue;
					}
					const RoadSlot slot = roadSlotOf(side, *wanted[index].slot);
					if (std::ranges::find(taken, slot) != taken.end()) {
						throw std::invalid_argument("startBattle: two vehicles open in the same slot");
					}
					state.vehicles[index].slot = slot;
					taken.push_back(slot);
				}
				for (size_t index = 0; index < state.vehicles.size(); ++index) {
					if (state.vehicles[index].side != side || wanted[index].slot || wanted[index].ambush) {
						continue;
					}
					const std::array<RoadSlot, 6> order = openingOrder(side);
					const auto					  free =
						std::ranges::find_if(order, [&](RoadSlot slot) { return std::ranges::find(taken, slot) == taken.end(); });
					if (free == order.end()) {
						throw std::invalid_argument("startBattle: a formation holds six vehicles");
					}
					state.vehicles[index].slot = *free;
					taken.push_back(*free);
				}
			}
			for (size_t index = 0; index < state.vehicles.size(); ++index) {
				if (!wanted[index].ambush) {
					continue;
				}
				const RoadSlot shoulder{.lane = flankShoulderOf(Side::Raiders), .row = *wanted[index].ambush};
				if (std::ranges::find(taken, shoulder) != taken.end()) {
					throw std::invalid_argument("startBattle: two raiders ambush from the same row");
				}
				const bool opposed = std::ranges::any_of(state.vehicles, [&](const BattleVehicle& vehicle) {
					return vehicle.side == Side::Player && vehicle.slot.row == shoulder.row;
				});
				if (!opposed) {
					throw std::invalid_argument("startBattle: an ambusher starts only in a row with one of the player's vehicles");
				}
				state.vehicles[index].slot = shoulder;
				state.vehicles[index].flank = FlankState{};
				taken.push_back(shoulder);
			}
		}

	} // namespace

	std::vector<BattleCard> cardsOf(std::span<const DeckEntry> deck) {
		std::vector<BattleCard> cards;
		for (const DeckEntry& entry : deck) {
			cards.insert(cards.end(), static_cast<size_t>(entry.count), BattleCard{.card = entry.card, .upgraded = false});
		}
		return cards;
	}

	BattleStart startBattle(const BattleSetup& setup, const Content& content) {
		if (setup.players.empty() || setup.players.size() > 2) {
			throw std::invalid_argument("startBattle: a fight seats one or two of the player's drivers");
		}
		if (setup.players.size() == 2 && setup.players[0].driver == setup.players[1].driver) {
			throw std::invalid_argument("startBattle: one driver can't take both seats");
		}
		if (setup.raiders.empty()) {
			throw std::invalid_argument("startBattle: a fight needs a raider");
		}

		BattleState			 state{.random = RandomStreams(setup.seed)};
		std::vector<Opening> openings;
		for (const PlayerSeat& seat : setup.players) {
			const DriverDefinition& driver = driverDefinition(content, seat.driver);
			checkDeck(content, seat.deck, driver.id.value);
			const DriverIndex index{static_cast<int>(state.drivers.size())};
			state.drivers.push_back(
				BattleDriver{
					.side = Side::Player,
					.profile = driver.id,
					.skills = driver.skills,
					.hitpoints = driver.maxHitpoints,
					.maxHitpoints = driver.maxHitpoints,
					.adrenaline = 0,
					.maxAdrenaline = driver.maxAdrenaline,
					.handLimit = driver.handLimit,
					.deck = seat.deck,
				}
			);
			state.vehicles.push_back(vehicleFrom(Side::Player, index, driver.vehicle));
			openings.push_back({.slot = seat.slot, .ambush = std::nullopt});
		}
		for (const RaiderSeat& seat : setup.raiders) {
			const OpponentDefinition& opponent = opponentDefinition(content, seat.opponent);
			std::vector<BattleCard>	  deck = cardsOf(opponent.deck);
			checkDeck(content, deck, opponent.id.value);
			const DriverIndex index{static_cast<int>(state.drivers.size())};
			state.drivers.push_back(
				BattleDriver{
					.side = Side::Raiders,
					.profile = opponent.id,
					.skills = opponent.skills,
					.hitpoints = opponent.hitpoints,
					.maxHitpoints = opponent.hitpoints,
					.adrenaline = 0,
					.maxAdrenaline = opponent.maxAdrenaline,
					.handLimit = opponent.handLimit,
					.deck = std::move(deck),
				}
			);
			state.vehicles.push_back(vehicleFrom(Side::Raiders, index, opponent.vehicle));
			if (seat.slot && seat.ambush) {
				throw std::invalid_argument("startBattle: a raider opens in its formation or ambushing, not both");
			}
			openings.push_back({.slot = seat.slot, .ambush = seat.ambush});
		}
		placeVehicles(state, openings);

		std::vector<Event> events;
		for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
			shuffleDeck(state, DriverIndex{index}, false, events);
		}
		openPlayerTurn(state, events);
		return BattleStart{.state = std::move(state), .events = std::move(events)};
	}

	std::optional<std::string> cardBlocker(const BattleState& state, const Content& content, DriverIndex driver, int handIndex) {
		if (state.phase == Phase::Over) {
			return "the fight is over";
		}
		if (state.phase == Phase::Planning) {
			return "the raiders are still planning";
		}
		if (driver.value < 0 || driver.value >= static_cast<int>(state.drivers.size())) {
			return "there's no driver " + std::to_string(driver.value);
		}
		const BattleDriver& player = state.driver(driver);
		if (state.phase == Phase::PlayerTurn && player.side != Side::Player) {
			return "it's the player's turn";
		}
		if (state.phase == Phase::EnemyTurn && state.actingRaider != driver) {
			return "it's another raider's move";
		}
		if (!player.isAlive()) {
			return "they're down";
		}
		if (player.crashedOut) {
			return "they crashed out of the fight";
		}
		const std::optional<VehicleIndex> vehicle = vehicleCarrying(state, driver);
		if (!vehicle || !vehicleInFight(state, *vehicle)) {
			return "they aren't aboard a vehicle in the fight";
		}
		if (handIndex < 0 || handIndex >= static_cast<int>(player.hand.size())) {
			return "there's no card " + std::to_string(handIndex) + " in their hand";
		}
		const BattleCard&	  card = player.hand[static_cast<size_t>(handIndex)];
		const CardDefinition& definition = definitionOf(content, card.card);
		if (const std::optional<std::string> gap = unimplementedPart(definition, card.upgraded)) {
			return definition.name + " can't be played yet: " + *gap;
		}
		if (player.adrenaline < cardCost(definition, card.upgraded)) {
			return "not enough adrenaline for " + definition.name;
		}
		if (state.vehicle(*vehicle).driver != driver && cardHasTag(definition, card.upgraded, "attack")) {
			return "a passenger can't play attack cards";
		}
		if (const std::optional<std::string> blocker = moveBlocker(state, definition, card.upgraded, driver)) {
			return definition.name + ": " + *blocker;
		}
		return std::nullopt;
	}

	std::optional<std::string> actionBlocker(const BattleState& state, const Content& content, const Action& action) {
		if (const auto* play = std::get_if<action::PlayCard>(&action)) {
			if (std::optional<std::string> blocker = cardBlocker(state, content, play->driver, play->handIndex)) {
				return blocker;
			}
			const BattleCard& card = state.driver(play->driver).hand[static_cast<size_t>(play->handIndex)];
			return targetBlocker(
				state,
				definitionOf(content, card.card),
				card.upgraded,
				CardPlay{
					.caster = play->driver,
					.actor = *vehicleCarrying(state, play->driver),
					.target = play->target,
					.occupant = play->occupant,
					.destination = play->destination,
				}
			);
		}
		if (state.phase == Phase::Over) {
			return "the fight is over";
		}
		if (state.phase == Phase::Planning) {
			return "the raiders are still planning";
		}
		return std::nullopt;
	}

	std::vector<Action> legalActions(const BattleState& state, const Content& content) {
		std::vector<Action> actions;
		if (state.phase == Phase::Over || state.phase == Phase::Planning) {
			return actions;
		}
		std::vector<DriverIndex> actors;
		if (state.phase == Phase::EnemyTurn) {
			actors.push_back(*state.actingRaider);
		} else {
			for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
				if (state.drivers[static_cast<size_t>(index)].side == Side::Player) {
					actors.push_back(DriverIndex{index});
				}
			}
		}

		const auto offer = [&](action::PlayCard play) {
			if (!actionBlocker(state, content, play)) {
				actions.emplace_back(play);
			}
		};
		for (const DriverIndex actor : actors) {
			const BattleDriver& driver = state.driver(actor);
			for (int handIndex = 0; handIndex < static_cast<int>(driver.hand.size()); ++handIndex) {
				if (cardBlocker(state, content, actor, handIndex)) {
					continue;
				}
				const BattleCard&		  card = driver.hand[static_cast<size_t>(handIndex)];
				const CardDefinition&	  definition = definitionOf(content, card.card);
				std::vector<VehicleIndex> targets;
				if (takesTarget(definition.target)) {
					for (int vehicle = 0; vehicle < static_cast<int>(state.vehicles.size()); ++vehicle) {
						targets.push_back(VehicleIndex{vehicle});
					}
				}
				std::vector<std::optional<DriverIndex>> occupants{std::nullopt};
				if (picksOccupant(cardEffects(definition, card.upgraded))) {
					occupants.clear();
					for (int person = 0; person < static_cast<int>(state.drivers.size()); ++person) {
						occupants.emplace_back(DriverIndex{person});
					}
				}
				// Every formation slot for a card that picks one; targetBlocker keeps the ones its move can take.
				std::vector<std::optional<RoadSlot>> destinations{std::nullopt};
				if (picksSlot(cardEffects(definition, card.upgraded))) {
					for (const Side side : {Side::Player, Side::Raiders}) {
						for (const RoadSlot slot : openingOrder(side)) {
							destinations.emplace_back(slot);
						}
					}
				}
				const auto offerAt = [&](std::optional<VehicleIndex> target) {
					for (const std::optional<DriverIndex>& occupant : occupants) {
						for (const std::optional<RoadSlot>& destination : destinations) {
							offer(
								{.driver = actor,
								 .handIndex = handIndex,
								 .target = target,
								 .occupant = occupant,
								 .destination = destination}
							);
						}
					}
				};
				if (targets.empty()) {
					offerAt(std::nullopt);
				}
				for (const VehicleIndex target : targets) {
					offerAt(target);
				}
			}
		}
		actions.emplace_back(action::EndTurn{});
		return actions;
	}

	std::vector<Event> apply(BattleState& state, const Content& content, const Action& action) {
		if (const std::optional<std::string> blocker = actionBlocker(state, content, action)) {
			throw std::invalid_argument("apply: " + *blocker);
		}
		std::vector<Event> events;
		if (const auto* play = std::get_if<action::PlayCard>(&action)) {
			playCard(state, content, *play, events);
			if (!endIfOver(state, events) && state.phase == Phase::EnemyTurn && !canAct(state, *state.actingRaider)) {
				passToNextRaider(state, events);
			}
		} else if (state.phase == Phase::PlayerTurn) {
			playEnemyTurn(state, content, events);
		} else {
			passToNextRaider(state, events);
		}
		return events;
	}

} // namespace rules
