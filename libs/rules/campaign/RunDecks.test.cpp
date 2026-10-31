#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/Locker.h>
#include <rules/campaign/RunDecks.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	const ConvoyId kHauler{"escort-1"};
	const ConvoyId kOutrider{"escort-2"};

	std::optional<CardBlocker> blocker(const Campaign& campaign, std::string_view moved, int count, CardPlace from, CardPlace to) {
		return cardMoveBlocker(
			campaign, testContent(), testRules().deck, CardMove{.card = card(moved), .count = count, .from = from, .to = to}
		);
	}

	void move(Campaign& campaign, std::string_view moved, int count, CardPlace from, CardPlace to) {
		moveCards(campaign, testContent(), testRules().deck, CardMove{.card = card(moved), .count = count, .from = from, .to = to});
	}

	// The Road Warrior and the Interceptor out with both escorts, named out of roster order.
	Campaign onARun() {
		Campaign campaign = foundTestCampaign({"fuel_hauler", "outrider"});
		startRun(
			campaign,
			testContent(),
			RunStart{
				.seats = {crewOf(campaign, "road_warrior"), crewOf(campaign, "interceptor")},
				.escorts = {kOutrider, kHauler},
				.stage = 2,
			}
		);
		return campaign;
	}

	TEST(RunDecks, ARunTakesEachDefaultDeckWholeAndTheEscortCardsGoToDriver1) {
		const Campaign before = foundTestCampaign({"fuel_hauler", "outrider"});
		Campaign	   campaign = onARun();
		const CrewId   warrior = crewOf(campaign, "road_warrior");
		const CrewId   interceptor = crewOf(campaign, "interceptor");
		ASSERT_TRUE(campaign.run.has_value());
		const auto& run = *campaign.run;
		EXPECT_EQ(run.id, RunId{"run-1"});
		EXPECT_EQ(campaign.nextRunNumber, 2);
		EXPECT_EQ(run.stage, 2);
		EXPECT_EQ(run.escorts, (std::vector{kHauler, kOutrider})) << "in roster order";
		EXPECT_EQ(run.seats[0].own, before.driver(warrior).defaultDeck);
		EXPECT_TRUE(campaign.driver(warrior).defaultDeck.empty());
		EXPECT_EQ(
			run.seats[0].escortCards,
			(std::vector{
				EscortCard{.card = card("top_off"), .broughtBy = kHauler}, EscortCard{.card = card("run_ahead"), .broughtBy = kOutrider}
			})
		);
		EXPECT_TRUE(run.seats[1].escortCards.empty());
		EXPECT_EQ(cardsOwned(campaign), cardsOwned(before)) << "escort cards aren't the compound's";
		EXPECT_EQ(
			blocker(campaign, "repair_kit", 1, DefaultDeck{warrior}, Locker{}),
			(CardBlocker{.reason = CardRefusal::OnRun, .driver = warrior})
		);

		moveEscortCard(campaign, kOutrider, interceptor);
		EXPECT_EQ(campaign.run->seats[1].escortCards, (std::vector{EscortCard{.card = card("run_ahead"), .broughtBy = kOutrider}}));
		EXPECT_EQ(campaign.run->seats[0].escortCards.size(), 1U);
		EXPECT_THROW(startRun(campaign, testContent(), RunStart{.seats = {crewOf(campaign, "mechanic")}}), std::invalid_argument);
	}

	TEST(RunDecks, LoadOutRefusesTheInjuredTheAwayAndASameArchetypePairWhileAMixedOneIsReady) {
		Campaign	 campaign = foundTestCampaign();
		const CrewId warrior = crewOf(campaign, "road_warrior");
		DriverRecord second = campaign.driver(warrior);
		second.id = CrewId{"driver-4"};
		campaign.drivers.push_back(second);
		++campaign.nextDriverNumber;
		DriverRecord& mechanic = campaign.driver(crewOf(campaign, "mechanic"));
		mechanic.status = DriverStatus::Injured;
		mechanic.injuredDays = 2;

		EXPECT_EQ(seatBlocker(campaign, mechanic.id, std::nullopt), (SeatBlocker{.reason = SeatRefusal::Injured, .injuredDays = 2}));
		EXPECT_EQ(seatBlocker(campaign, warrior, warrior), (SeatBlocker{.reason = SeatRefusal::AlreadySeated}));
		EXPECT_EQ(seatBlocker(campaign, second.id, warrior), (SeatBlocker{.reason = SeatRefusal::SameArchetype}))
			<< "the Interceptor is ready";
		EXPECT_THROW(startRun(campaign, testContent(), RunStart{.seats = {warrior, mechanic.id}}), std::invalid_argument);

		// Call 35: with nobody else ready, two of one archetype go together.
		campaign.driver(crewOf(campaign, "interceptor")).status = DriverStatus::Missing;
		EXPECT_EQ(seatBlocker(campaign, crewOf(campaign, "interceptor"), std::nullopt), (SeatBlocker{.reason = SeatRefusal::DriverAway}));
		EXPECT_FALSE(seatBlocker(campaign, second.id, warrior).has_value());
		startRun(campaign, testContent(), RunStart{.seats = {warrior, second.id}});
		EXPECT_EQ(campaign.run->seats.size(), 2U);
	}

	TEST(RunDecks, BorrowedCopiesGoBackFirstAndTheDriversOwnComeBackFirst) {
		Campaign		campaign = onARun();
		const RunDeckOf warrior{crewOf(campaign, "road_warrior")};
		const RunDeckOf interceptor{crewOf(campaign, "interceptor")};
		campaign.locker = {{card("ram"), 1}, {card("repair_kit"), 2}};
		const CardCounts owned = cardsOwned(campaign);
		const RunDeck&	 deck = *campaign.runDeckOf(warrior.driver);

		move(campaign, "repair_kit", 1, warrior, Locker{});
		EXPECT_EQ(countOf(deck.leftHome, card("repair_kit")), 1) << "left at home, held for the driver";
		EXPECT_EQ(countOf(campaign.locker, card("repair_kit")), 2) << "not put in the locker for the other seat";
		move(campaign, "repair_kit", 2, Locker{}, warrior);
		EXPECT_EQ(countOf(deck.own, card("repair_kit")), 2) << "their own back first";
		EXPECT_EQ(countOf(deck.borrowed, card("repair_kit")), 1);
		EXPECT_TRUE(deck.leftHome.empty());
		move(campaign, "repair_kit", 1, warrior, Locker{});
		EXPECT_TRUE(deck.borrowed.empty()) << "borrowed copies go back first";
		EXPECT_EQ(cardsOwned(campaign), owned);

		move(campaign, "repair_kit", 2, Locker{}, interceptor);
		EXPECT_EQ(
			blocker(campaign, "repair_kit", 2, Locker{}, warrior),
			(CardBlocker{.reason = CardRefusal::AlreadyBorrowed, .count = 0, .driver = interceptor.driver})
		);
		EXPECT_EQ(
			blocker(campaign, "top_off", 1, warrior, Locker{}),
			(CardBlocker{.reason = CardRefusal::CardLocked, .count = 0, .escort = kHauler})
		);
		EXPECT_THROW((void)blocker(campaign, "repair_kit", 1, warrior, DefaultDeck{interceptor.driver}), std::invalid_argument);

		move(campaign, "nitro_boost", 2, warrior, Locker{});
		move(campaign, "ram", 1, Locker{}, warrior);
		resetRunDeck(campaign, interceptor.driver);
		resetRunDeck(campaign, warrior.driver);
		EXPECT_EQ(countOf(deck.own, card("nitro_boost")), 2);
		EXPECT_TRUE(deck.borrowed.empty());
		EXPECT_EQ(deck.escortCards.size(), 2U) << "reset leaves escort cards (call 139)";
		EXPECT_EQ(cardsOwned(campaign), owned);
	}

	TEST(RunDecks, AGivenUpLoadOutPutsEveryDeckBackAndARunHomeUnloadsItsCargo) {
		Campaign campaign = foundTestCampaign({"fuel_hauler"});
		campaign.locker = {{card("ram"), 1}};
		Campaign	   home = campaign;
		const RunStart start{.seats = {crewOf(campaign, "road_warrior"), crewOf(campaign, "mechanic")}, .escorts = {kHauler}};
		startRun(campaign, testContent(), start);
		move(campaign, "ram", 1, Locker{}, RunDeckOf{start.seats[0]});
		move(campaign, "ramming_speed", 2, RunDeckOf{start.seats[0]}, Locker{});
		giveUpLoadOut(campaign);
		home.nextRunNumber = 2;
		EXPECT_EQ(campaign, home);

		startRun(campaign, testContent(), start);
		move(campaign, "ram", 1, Locker{}, RunDeckOf{start.seats[1]});
		addCardsWon(campaign, testContent(), {{card("headshot"), 2}});
		campaign.run->cargo.fuel = 3;
		EXPECT_THROW(giveUpLoadOut(campaign), std::invalid_argument) << "it picked something up, so it left";
		EXPECT_THROW(addCardsWon(campaign, testContent(), {{card("top_off"), 1}}), std::invalid_argument);
		EXPECT_THROW(addCardsWon(campaign, testContent(), {{card("chainsaw"), 1}}), std::invalid_argument);

		const Unloaded unloaded = unloadRun(campaign, testContent(), testRules());
		EXPECT_EQ(unloaded.resources.fuel, 3);
		EXPECT_EQ(unloaded.cards, (CardCounts{{card("headshot"), 2}}));
		EXPECT_FALSE(campaign.run.has_value());
		EXPECT_EQ(campaign.stores.fuel, home.stores.fuel + 3);
		EXPECT_EQ(campaign.locker, (CardCounts{{card("headshot"), 2}, {card("ram"), 1}})) << "the borrowed Ram back, the cards won in";
		EXPECT_EQ(campaign.driver(start.seats[1]).defaultDeck, home.driver(start.seats[1]).defaultDeck);
		EXPECT_THROW((void)unloadRun(campaign, testContent(), testRules()), std::invalid_argument);
	}

} // namespace
