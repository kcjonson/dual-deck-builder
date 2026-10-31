#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/Locker.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	std::optional<CardBlocker> blocker(const Campaign& campaign, std::string_view moved, int count, CardPlace from, CardPlace to) {
		return cardMoveBlocker(
			campaign, testContent(), testRules().deck, CardMove{.card = card(moved), .count = count, .from = from, .to = to}
		);
	}

	void move(Campaign& campaign, std::string_view moved, int count, CardPlace from, CardPlace to) {
		moveCards(campaign, testContent(), testRules().deck, CardMove{.card = card(moved), .count = count, .from = from, .to = to});
	}

	TEST(Locker, CopiesMoveBetweenTheLockerAndTheDefaultDecksInsideTheDeckRules) {
		Campaign		  campaign = foundTestCampaign();
		const DefaultDeck warrior{crewOf(campaign, "road_warrior")};
		const DefaultDeck mechanic{crewOf(campaign, "mechanic")};
		const DefaultDeck interceptor{crewOf(campaign, "interceptor")};
		const CardCounts  owned = cardsOwned(campaign);

		// The Road Warrior's 12 down to the fewest, 8, and the Mechanic's 8 up to 12.
		move(campaign, "ramming_speed", 4, warrior, Locker{});
		EXPECT_EQ(countOf(campaign.locker, card("ramming_speed")), 4);
		EXPECT_EQ(
			blocker(campaign, "ramming_speed", 1, warrior, Locker{}), (CardBlocker{.reason = CardRefusal::DeckAtMinimum, .count = 8})
		);
		move(campaign, "ramming_speed", 4, Locker{}, mechanic);
		EXPECT_EQ(totalCards(campaign.driver(mechanic.driver).defaultDeck), 12);
		EXPECT_EQ(cardsOwned(campaign), owned) << "no move makes or loses a copy";

		EXPECT_EQ(blocker(campaign, "ramming_speed", 1, Locker{}, mechanic), (CardBlocker{.reason = CardRefusal::TooFew, .count = 0}));
		EXPECT_EQ(
			blocker(campaign, "precision_shot", 1, interceptor, mechanic),
			(CardBlocker{.reason = CardRefusal::OtherArchetype, .archetype = DriverId{"interceptor"}})
		) << "straight between two default decks, under the rules at both ends (call 118)";
		campaign.locker = {{card("repair_kit"), 9}};
		EXPECT_EQ(blocker(campaign, "repair_kit", 9, Locker{}, mechanic), (CardBlocker{.reason = CardRefusal::DeckFull, .count = 20}));
		EXPECT_FALSE(blocker(campaign, "repair_kit", 8, Locker{}, mechanic).has_value());

		DriverRecord& lost = campaign.driver(interceptor.driver);
		lost.status = DriverStatus::Missing;
		EXPECT_EQ(
			blocker(campaign, "repair_kit", 1, Locker{}, interceptor),
			(CardBlocker{.reason = CardRefusal::DriverAway, .driver = interceptor.driver})
		);
		EXPECT_THROW(move(campaign, "repair_kit", 1, Locker{}, interceptor), std::invalid_argument);
		EXPECT_THROW((void)blocker(campaign, "repair_kit", 0, Locker{}, mechanic), std::invalid_argument);
		EXPECT_THROW((void)blocker(campaign, "repair_kit", 1, mechanic, mechanic), std::invalid_argument);
		EXPECT_THROW((void)blocker(campaign, "repair_kit", 1, Locker{}, DefaultDeck{CrewId{"driver-9"}}), std::invalid_argument);
	}

	TEST(Locker, ScrappingPaysForEachCopyAndRefusesWhatTheLockerLacks) {
		Campaign campaign = foundTestCampaign();
		campaign.locker = {{card("ram"), 2}};
		const int scrap = campaign.stores.scrap;
		scrapCards(campaign, testRules().deck, card("ram"), 2);
		EXPECT_TRUE(campaign.locker.empty());
		EXPECT_EQ(campaign.stores.scrap, scrap + 10);
		EXPECT_EQ(scrapBlocker(campaign, card("ram"), 1), (CardBlocker{.reason = CardRefusal::TooFew, .count = 0}));
		EXPECT_THROW(scrapCards(campaign, testRules().deck, card("ram"), 1), std::invalid_argument);
	}

} // namespace
