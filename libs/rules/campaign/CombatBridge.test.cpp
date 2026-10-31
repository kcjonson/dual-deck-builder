#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/Locker.h>
#include <rules/campaign/RunDecks.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	const ConvoyId	  kHauler{"escort-1"};
	const ConvoyId	  kMedTruck{"escort-2"};
	const ConvoyId	  kOutrider{"escort-3"};
	const EncounterId kTail{"scav_tail"};

	// The Road Warrior and the Interceptor out hurt, with the Fuel Hauler, the Med Truck, and a battered Outrider.
	Campaign onARun() {
		Campaign	  campaign = foundTestCampaign({"fuel_hauler", "med_truck", "outrider"});
		DriverRecord& warrior = campaign.driver(crewOf(campaign, "road_warrior"));
		warrior.hitpoints = 30;
		warrior.vehicle = {.structure = 50, .armor = 4};
		campaign.driver(crewOf(campaign, "interceptor")).hitpoints = 20;
		campaign.convoy[2].structure = 10;
		startRun(
			campaign,
			testContent(),
			RunStart{
				.seats = {warrior.id, crewOf(campaign, "interceptor")},
				.escorts = {kHauler, kMedTruck, kOutrider},
			}
		);
		return campaign;
	}

	// The fight as it might end: the Road Warrior down, their Rig carrying on unmanned and plated past its base, the
	// Interceptor crashed out of their wreck, the Fuel Hauler hit, and the Outrider wrecked.
	CampaignFight ended(CampaignFight fight, Outcome outcome) {
		BattleState& state = fight.state;
		state.driver(DriverIndex{0}).hitpoints = 0;
		state.vehicle(VehicleIndex{0}).structure = 44;
		state.vehicle(VehicleIndex{0}).armor = 13;
		state.driver(DriverIndex{1}).hitpoints = 18;
		state.driver(DriverIndex{1}).crashedOut = true;
		state.vehicle(VehicleIndex{1}).structure = 0;
		state.vehicle(VehicleIndex{2}).structure = 22;
		state.vehicle(VehicleIndex{4}).structure = 0;
		state.phase = Phase::Over;
		state.outcome = outcome;
		return fight;
	}

	int copiesIn(const BattleDriver& driver, std::string_view id) {
		int copies = 0;
		for (const std::vector<BattleCard>* pile : {&driver.deck, &driver.hand}) {
			copies += static_cast<int>(std::ranges::count(*pile, BattleCard{.card = card(id), .upgraded = false}));
		}
		return copies;
	}

	TEST(CombatBridge, TheFightSeatsTheRecordsHurtWithTheirRunDecksAndTheEscortsThatCame) {
		Campaign				 campaign = onARun();
		const CampaignFightStart start = startCampaignFight(campaign, testContent(), kTail);
		const BattleState&		 state = start.fight.state;
		EXPECT_EQ(start.fight.run, RunId{"run-1"});
		EXPECT_EQ(start.fight.number, 0);
		EXPECT_EQ(state.random.seed(), nextFightSeed(campaign));
		EXPECT_FALSE(start.events.empty());

		const BattleDriver& warrior = state.driver(DriverIndex{0});
		EXPECT_EQ(warrior.profile, (std::variant<DriverId, OpponentId>{DriverId{"road_warrior"}}));
		EXPECT_EQ(warrior.hitpoints, 30);
		EXPECT_EQ(warrior.maxHitpoints, 40);
		EXPECT_EQ(state.vehicle(VehicleIndex{0}).structure, 50);
		EXPECT_EQ(state.vehicle(VehicleIndex{0}).armor, 4);
		EXPECT_EQ(state.driver(DriverIndex{1}).hitpoints, 20);
		EXPECT_EQ(warrior.deck.size() + warrior.hand.size(), 15U) << "the 12 of the default deck and the three escort cards";
		EXPECT_EQ(copiesIn(warrior, "ramming_speed"), 5);
		EXPECT_EQ(copiesIn(warrior, "triage"), 1);

		EXPECT_EQ(state.vehicle(VehicleIndex{2}).escort, EscortId{"fuel_hauler"});
		EXPECT_EQ(state.vehicle(VehicleIndex{3}).escort, EscortId{"med_truck"});
		EXPECT_EQ(state.vehicle(VehicleIndex{4}).escort, EscortId{"outrider"});
		EXPECT_EQ(state.vehicle(VehicleIndex{4}).structure, 10);

		// A record past its archetype's maximums, after a retune lowered one, seats at them.
		campaign.driver(crewOf(campaign, "road_warrior")).vehicle.armor = 15;
		EXPECT_EQ(startCampaignFight(campaign, testContent(), kTail).fight.state.vehicle(VehicleIndex{0}).armor, 10);
	}

	TEST(CombatBridge, AWonFightCarriesItsDamageRevivesTheDownPicksUpTheCrashedOutAndPaysTheHaulers) {
		Campaign			campaign = onARun();
		const CrewId		warrior = crewOf(campaign, "road_warrior");
		const CrewId		interceptor = crewOf(campaign, "interceptor");
		const uint32_t		seed = nextFightSeed(campaign);
		const CampaignFight fight = ended(startCampaignFight(campaign, testContent(), kTail).fight, Outcome::Won);

		const FightWriteBack written = writeBackFight(campaign, testContent(), fight);
		EXPECT_EQ(written.outcome, Outcome::Won);
		EXPECT_EQ(
			written.seats,
			(std::vector{
				SeatWriteBack{.driver = warrior, .fate = SeatFate::Revived, .healed = 0},
				SeatWriteBack{.driver = interceptor, .fate = SeatFate::PickedUp, .healed = 3},
			})
		) << "the Med Truck heals before the revival, so not the revived (call 15)";
		EXPECT_EQ(campaign.driver(warrior).hitpoints, kReviveHitpoints);
		EXPECT_EQ(campaign.driver(warrior).vehicle, (VehicleCondition{.structure = 44, .armor = 10}))
			<< "plating past base was the fight's";
		EXPECT_EQ(campaign.driver(interceptor).hitpoints, 21);
		EXPECT_EQ(campaign.driver(interceptor).vehicle, (VehicleCondition{.structure = kLimpStructure, .armor = 0})) << "a wreck limps on";

		EXPECT_EQ(written.escortsLost, std::vector{kOutrider});
		EXPECT_EQ(campaign.findEscort(kOutrider), nullptr);
		EXPECT_EQ(campaign.findEscort(kHauler)->structure, 22);
		EXPECT_EQ(campaign.findEscort(kMedTruck)->structure, 35);
		const auto& run = *campaign.run;
		EXPECT_EQ(run.escorts, (std::vector{kHauler, kMedTruck}));
		EXPECT_EQ(
			run.seats[0].escortCards,
			(std::vector{
				EscortCard{.card = card("top_off"), .broughtBy = kHauler}, EscortCard{.card = card("triage"), .broughtBy = kMedTruck}
			})
		) << "the lost Outrider's Run Ahead goes with it";
		EXPECT_EQ(written.dividends, (Resources{.fuel = 1}));
		EXPECT_EQ(run.cargo, (Resources{.fuel = 1}));

		EXPECT_EQ(run.fights, 1);
		EXPECT_NE(nextFightSeed(campaign), seed);
		EXPECT_THROW((void)writeBackFight(campaign, testContent(), fight), std::invalid_argument) << "it's written back already";
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);
	}

	TEST(CombatBridge, ABrokenOffFightRevivesAndPicksUpAsAWinDoesAndPaysNothing) {
		Campaign	   campaign = onARun();
		const CrewId   warrior = crewOf(campaign, "road_warrior");
		FightWriteBack written =
			writeBackFight(campaign, testContent(), ended(startCampaignFight(campaign, testContent(), kTail).fight, Outcome::BrokenOff));
		EXPECT_EQ(written.seats[0].fate, SeatFate::Revived) << "call 198";
		EXPECT_EQ(written.seats[1].fate, SeatFate::PickedUp);
		EXPECT_EQ(campaign.driver(warrior).hitpoints, kReviveHitpoints);
		EXPECT_EQ(campaign.driver(crewOf(campaign, "interceptor")).hitpoints, 18);
		EXPECT_EQ(written.dividends, Resources{});
		EXPECT_EQ(campaign.run->cargo, Resources{});
		EXPECT_EQ(written.escortsLost, std::vector{kOutrider});
		EXPECT_EQ(campaign.run->fights, 1);
	}

	TEST(CombatBridge, ALostFightEndsTheRunTheDeadTakingTheirRunDeckAndTheMissingGettingTheirsBack) {
		Campaign		 campaign = onARun();
		const CrewId	 warrior = crewOf(campaign, "road_warrior");
		const CrewId	 interceptor = crewOf(campaign, "interceptor");
		const CardCounts interceptorDeck = campaign.runDeckOf(interceptor)->own;
		campaign.locker = {{card("ram"), 1}};
		const DeckRules& rules = testRules().deck;
		moveCards(campaign, testContent(), rules, {.card = card("ram"), .count = 1, .from = Locker{}, .to = RunDeckOf{warrior}});
		moveCards(campaign, testContent(), rules, {.card = card("ramming_speed"), .count = 2, .from = RunDeckOf{warrior}, .to = Locker{}});
		addCardsWon(campaign, testContent(), {{card("headshot"), 1}});
		campaign.run->cargo.scrap = 30;
		const CardCounts owned = cardsOwned(campaign);

		CampaignFight fight = startCampaignFight(campaign, testContent(), kTail).fight;
		fight.state.driver(DriverIndex{0}).hitpoints = 0;
		fight.state.driver(DriverIndex{1}).hitpoints = 18;
		fight.state.driver(DriverIndex{1}).crashedOut = true;
		fight.state.phase = Phase::Over;
		fight.state.outcome = Outcome::Lost;
		const FightWriteBack written = writeBackFight(campaign, testContent(), fight);

		EXPECT_EQ(written.seats[0].fate, SeatFate::Dead);
		EXPECT_EQ(written.seats[1].fate, SeatFate::Missing);
		EXPECT_FALSE(campaign.run.has_value());
		EXPECT_EQ(written.escortsLost, (std::vector{kHauler, kMedTruck, kOutrider}));
		EXPECT_TRUE(campaign.convoy.empty());
		ASSERT_TRUE(written.lost.has_value());
		EXPECT_EQ(written.lost->cargo, (Resources{.scrap = 30}));
		EXPECT_EQ(written.lost->cargoCards, (CardCounts{{card("headshot"), 1}}));
		EXPECT_EQ(
			written.lost->cardsLost,
			(CardCounts{
				{card("armor_plating"), 3}, {card("nitro_boost"), 2}, {card("ram"), 1}, {card("ramming_speed"), 3}, {card("repair_kit"), 2}
			})
		) << "their own going and the Ram they borrowed";

		const DriverRecord& dead = campaign.driver(warrior);
		EXPECT_EQ(dead.status, DriverStatus::Dead);
		EXPECT_EQ(dead.hitpoints, 0);
		EXPECT_TRUE(dead.defaultDeck.empty());
		EXPECT_EQ(campaign.locker, (CardCounts{{card("ramming_speed"), 2}})) << "what they left at home stays";
		const DriverRecord& missing = campaign.driver(interceptor);
		EXPECT_EQ(missing.status, DriverStatus::Missing);
		EXPECT_EQ(missing.hitpoints, 18);
		EXPECT_EQ(missing.defaultDeck, interceptorDeck) << "call 138";

		CardCounts left = owned;
		for (const auto& [lostCard, count] : written.lost->cardsLost) {
			takeCards(left, lostCard, count);
		}
		EXPECT_EQ(cardsOwned(campaign), left);
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);
	}

	TEST(CombatBridge, OnlyTheRunsNextFightWhenItsOverIsWrittenBack) {
		Campaign	  campaign = onARun();
		CampaignFight fight = startCampaignFight(campaign, testContent(), kTail).fight;
		EXPECT_THROW((void)writeBackFight(campaign, testContent(), fight), std::invalid_argument) << "it's still on";
		fight = ended(std::move(fight), Outcome::Won);
		CampaignFight elsewhere = fight;
		elsewhere.run = RunId{"run-7"};
		EXPECT_THROW((void)writeBackFight(campaign, testContent(), elsewhere), std::invalid_argument);
		giveUpLoadOut(campaign);
		EXPECT_THROW((void)writeBackFight(campaign, testContent(), fight), std::invalid_argument) << "no run is out";
		EXPECT_THROW((void)startCampaignFight(campaign, testContent(), kTail), std::invalid_argument);
	}

} // namespace
