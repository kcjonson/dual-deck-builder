#include "Battle.h"

#include "CardPlay.h"
#include "Hands.h"

#include <algorithm>
#include <stdexcept>

namespace rules {

	namespace {

		// Each driver's draw at the start of every player turn (Combat Rules, Combat sequence).
		constexpr int kTurnDraw = 5;

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

		// Combat Rules, The road: a vehicle the setup places starts there; the rest fill their formation in
		// opening order.
		void placeVehicles(BattleState& state, const std::vector<std::optional<FormationSlot>>& wanted) {
			for (const Side side : {Side::Player, Side::Raiders}) {
				std::vector<RoadSlot> taken;
				for (size_t index = 0; index < state.vehicles.size(); ++index) {
					if (state.vehicles[index].side != side || !wanted[index]) {
						continue;
					}
					const RoadSlot slot = roadSlotOf(side, *wanted[index]);
					if (std::ranges::find(taken, slot) != taken.end()) {
						throw std::invalid_argument("startBattle: two vehicles open in the same slot");
					}
					state.vehicles[index].slot = slot;
					taken.push_back(slot);
				}
				for (size_t index = 0; index < state.vehicles.size(); ++index) {
					if (state.vehicles[index].side != side || wanted[index]) {
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
		}

		// A player's driver plays from wherever they ride; a raider acts only from the wheel.
		bool canAct(const BattleState& state, DriverIndex driver) {
			if (!driverInFight(state, driver)) {
				return false;
			}
			if (state.driver(driver).side == Side::Player) {
				return true;
			}
			const std::optional<VehicleIndex> vehicle = vehicleCarrying(state, driver);
			return vehicle && state.vehicle(*vehicle).driver == driver;
		}

		std::vector<DriverIndex> driversInFight(const BattleState& state) {
			std::vector<DriverIndex> drivers;
			for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
				if (driverInFight(state, DriverIndex{index})) {
					drivers.push_back(DriverIndex{index});
				}
			}
			return drivers;
		}

		void clearWrecks(BattleState& state, std::vector<Event>& events) {
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				const VehicleIndex vehicle{index};
				if (state.vehicle(vehicle).onRoad && !vehicleInFight(state, vehicle)) {
					state.vehicle(vehicle).onRoad = false;
					events.emplace_back(event::LeftRoad{.vehicle = vehicle});
				}
			}
		}

		// Lost once no player's driver is still in the fight, won once no raider is (Combat Rules, How a fight
		// ends). A last hit that takes out both sides loses.
		bool endIfOver(BattleState& state, std::vector<Event>& events) {
			bool playerLeft = false;
			bool raiderLeft = false;
			for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
				if (state.drivers[static_cast<size_t>(index)].side == Side::Player) {
					playerLeft = playerLeft || driverInFight(state, DriverIndex{index});
				}
			}
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				if (state.vehicles[static_cast<size_t>(index)].side == Side::Raiders) {
					raiderLeft = raiderLeft || vehicleInFight(state, VehicleIndex{index});
				}
			}
			if (playerLeft && raiderLeft) {
				return false;
			}
			state.phase = Phase::Over;
			state.actingRaider.reset();
			state.outcome = playerLeft ? Outcome::Won : Outcome::Lost;
			events.emplace_back(event::FightEnded{.outcome = *state.outcome});
			return true;
		}

		// The raiders' hands from the enemy turn are discarded here rather than at its end, since each held the
		// cards it was choosing from; Shield clears so a Shield given on the player's turn covers exactly the enemy
		// turn after it.
		void openPlayerTurn(BattleState& state, std::vector<Event>& events) {
			state.phase = Phase::PlayerTurn;
			events.emplace_back(event::TurnStarted{.turn = state.turn, .side = Side::Player});
			for (BattleDriver& driver : state.drivers) {
				driver.attackedThisTurn = false;
			}
			const std::vector<DriverIndex> inFight = driversInFight(state);
			for (const DriverIndex driver : inFight) {
				discardHand(state, driver, events);
			}
			for (const DriverIndex driver : inFight) {
				BattleDriver& refilled = state.driver(driver);
				refilled.adrenaline = refilled.maxAdrenaline;
				events.emplace_back(event::AdrenalineRefilled{.driver = driver, .adrenaline = refilled.adrenaline});
			}
			for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
				BattleVehicle& vehicle = state.vehicles[static_cast<size_t>(index)];
				if (vehicle.shield > 0) {
					events.emplace_back(event::ShieldCleared{.vehicle = VehicleIndex{index}, .shield = vehicle.shield});
					vehicle.shield = 0;
				}
			}
			for (const DriverIndex driver : inFight) {
				drawCards(state, driver, kTurnDraw, events);
			}
		}

		void finishEnemyTurn(BattleState& state, std::vector<Event>& events) {
			state.actingRaider.reset();
			clearWrecks(state, events);
			++state.turn;
			openPlayerTurn(state, events);
		}

		// The next raider in seat order that can act, or the end of the enemy turn.
		void passToNextRaider(BattleState& state, std::vector<Event>& events) {
			const int first = state.actingRaider ? state.actingRaider->value + 1 : 0;
			for (int index = first; index < static_cast<int>(state.drivers.size()); ++index) {
				const DriverIndex raider{index};
				if (state.driver(raider).side == Side::Raiders && canAct(state, raider)) {
					state.actingRaider = raider;
					events.emplace_back(event::RaiderActing{.raider = raider});
					return;
				}
			}
			finishEnemyTurn(state, events);
		}

		void startEnemyTurn(BattleState& state, std::vector<Event>& events) {
			for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
				if (state.drivers[static_cast<size_t>(index)].side == Side::Player) {
					discardHand(state, DriverIndex{index}, events);
				}
			}
			clearWrecks(state, events);
			for (BattleDriver& driver : state.drivers) {
				driver.attackedThisTurn = false;
			}
			state.phase = Phase::EnemyTurn;
			state.actingRaider.reset();
			events.emplace_back(event::TurnStarted{.turn = state.turn, .side = Side::Raiders});
			passToNextRaider(state, events);
		}

		void playCard(BattleState& state, const Content& content, const action::PlayCard& play, std::vector<Event>& events) {
			BattleDriver&		  caster = state.driver(play.driver);
			const BattleCard	  card = caster.hand[static_cast<size_t>(play.handIndex)];
			const CardDefinition& definition = definitionOf(content, card.card);
			const int			  cost = cardCost(definition, card.upgraded);
			const bool			  exhausts = cardHasTag(definition, card.upgraded, "exhaust");

			caster.hand.erase(caster.hand.begin() + play.handIndex);
			caster.adrenaline -= cost;
			(exhausts ? caster.exhausted : caster.discard).push_back(card);
			caster.attackedThisTurn = caster.attackedThisTurn || cardHasTag(definition, card.upgraded, "attack");
			events.emplace_back(
				event::CardPlayed{.driver = play.driver, .card = card, .target = play.target, .cost = cost, .exhausted = exhausts}
			);

			const std::optional<VehicleIndex> actor = vehicleCarrying(state, play.driver);
			resolveCard(
				state,
				cardEffects(definition, card.upgraded),
				CardPlay{.caster = play.driver, .actor = *actor, .target = play.target, .occupant = play.occupant},
				events
			);
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

		BattleState								  state{.random = RandomStreams(setup.seed)};
		std::vector<std::optional<FormationSlot>> slots;
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
			slots.push_back(seat.slot);
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
			slots.push_back(seat.slot);
		}
		placeVehicles(state, slots);

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
				}
			);
		}
		if (state.phase == Phase::Over) {
			return "the fight is over";
		}
		return std::nullopt;
	}

	std::vector<Action> legalActions(const BattleState& state, const Content& content) {
		std::vector<Action> actions;
		if (state.phase == Phase::Over) {
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
				const bool occupant = picksOccupant(cardEffects(definition, card.upgraded));
				const auto offerAt = [&](std::optional<VehicleIndex> target) {
					if (!occupant) {
						offer({.driver = actor, .handIndex = handIndex, .target = target, .occupant = std::nullopt});
						return;
					}
					for (int person = 0; person < static_cast<int>(state.drivers.size()); ++person) {
						offer({.driver = actor, .handIndex = handIndex, .target = target, .occupant = DriverIndex{person}});
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
			startEnemyTurn(state, events);
		} else {
			passToNextRaider(state, events);
		}
		return events;
	}

} // namespace rules
