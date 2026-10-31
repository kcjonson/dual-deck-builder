#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/CardOffers.h>
#include <rules/campaign/Convoy.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/Garage.h>
#include <rules/campaign/RunDecks.h>

#include <gtest/gtest.h>

#include <set>
#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	const GarageRules& garageRules() {
		return testRules().garage;
	}

	bool holdsAnOrder(const std::vector<GarageOffer>& stock) {
		return std::ranges::any_of(stock, [](const GarageOffer& offer) { return testContent().cards.at(offer.card).hasTag("order"); });
	}

	TEST(Garage, TheDaysStockIsFourDifferentCardsOnSaleThatTurnsOverAtDawn) {
		Campaign campaign = foundTestCampaign();
		ASSERT_EQ(campaign.garage.size(), 4U);
		std::set<CardId> cards;
		for (const GarageOffer& offer : campaign.garage) {
			EXPECT_TRUE(isOffered(testContent().cards.at(offer.card))) << offer.card.value;
			EXPECT_FALSE(offer.sold);
			cards.insert(offer.card);
		}
		EXPECT_EQ(cards.size(), 4U);
		EXPECT_EQ(rollGarageStock(campaign, testContent(), garageRules()), campaign.garage) << "the day's, however often it's rolled";

		campaign.garage[0].sold = true;
		(void)endDay(campaign, testContent(), testRules());
		EXPECT_EQ(campaign.garage, rollGarageStock(campaign, testContent(), garageRules())) << "restocked at dawn, nothing sold";

		// Order cards are on sale only while the convoy has an escort (Card System Design 1.3).
		Campaign withEscort = foundTestCampaign({"outrider"});
		bool	 ordersWithout = false;
		bool	 ordersWith = false;
		for (int day = 1; day <= 10; ++day) {
			campaign.day = day;
			withEscort.day = day;
			ordersWithout = ordersWithout || holdsAnOrder(rollGarageStock(campaign, testContent(), garageRules()));
			ordersWith = ordersWith || holdsAnOrder(rollGarageStock(withEscort, testContent(), garageRules()));
		}
		EXPECT_FALSE(ordersWithout);
		EXPECT_TRUE(ordersWith);
	}

	TEST(Garage, ACardBoughtCostsItsRarityAndGoesToTheLockerOnceADay) {
		Campaign	 campaign = foundTestCampaign();
		const CardId bought = campaign.garage[1].card;
		const int	 price = cardPrice(testContent(), garageRules(), bought);
		EXPECT_EQ(price, garageRules().cardPrices.at(testContent().cards.at(bought).rarity));
		buyCard(campaign, testContent(), garageRules(), bought);
		EXPECT_EQ(campaign.locker, (CardCounts{{bought, 1}}));
		EXPECT_EQ(campaign.stores.scrap, 150 - price);
		EXPECT_TRUE(campaign.garage[1].sold);
		EXPECT_EQ(buyBlocker(campaign, testContent(), garageRules(), bought), (GarageBlocker{.reason = GarageRefusal::SoldOut}));
		EXPECT_THROW(buyCard(campaign, testContent(), garageRules(), bought), std::invalid_argument);

		const CardId next = campaign.garage[0].card;
		campaign.stores.scrap = 0;
		EXPECT_EQ(
			buyBlocker(campaign, testContent(), garageRules(), next),
			(GarageBlocker{.reason = GarageRefusal::TooLittleScrap, .count = cardPrice(testContent(), garageRules(), next)})
		);
		const auto elsewhere = std::ranges::find_if(testContent().cards, [&](const auto& entry) {
			return isOffered(entry.second) && std::ranges::find(campaign.garage, entry.first, &GarageOffer::card) == campaign.garage.end();
		});
		EXPECT_THROW((void)buyBlocker(campaign, testContent(), garageRules(), elsewhere->first), std::invalid_argument)
			<< "not on sale today";
		EXPECT_THROW((void)cardPrice(testContent(), garageRules(), card("top_off")), std::invalid_argument) << "a signature card";

		campaign.stores.scrap = 150;
		startRun(campaign, testContent(), RunStart{.seats = {crewOf(campaign, "road_warrior")}});
		EXPECT_EQ(buyBlocker(campaign, testContent(), garageRules(), next), (GarageBlocker{.reason = GarageRefusal::RunOut})) << "call 397";
		giveUpLoadOut(campaign);
		campaign.end = CampaignEnd{};
		EXPECT_EQ(buyBlocker(campaign, testContent(), garageRules(), next), (GarageBlocker{.reason = GarageRefusal::CampaignOver}));
	}

	TEST(Garage, AnEscortHiredIsPaidForAndJoinsTheConvoyUpToFour) {
		Campaign campaign = foundTestCampaign({"outrider", "pilot_car", "fuel_hauler"});
		EXPECT_EQ(hireEscort(campaign, testContent(), garageRules(), EscortId{"med_truck"}), ConvoyId{"escort-4"});
		EXPECT_EQ(campaign.convoy.back(), (ConvoyEscort{.id = ConvoyId{"escort-4"}, .type = EscortId{"med_truck"}, .structure = 35}));
		EXPECT_EQ(campaign.stores.scrap, 60);
		EXPECT_EQ(
			hireBlocker(campaign, garageRules(), EscortId{"outrider"}), (GarageBlocker{.reason = GarageRefusal::ConvoyFull, .count = 4})
		);
		dismissEscort(campaign, ConvoyId{"escort-1"});
		campaign.stores.scrap = 59;
		EXPECT_EQ(
			hireBlocker(campaign, garageRules(), EscortId{"outrider"}),
			(GarageBlocker{.reason = GarageRefusal::TooLittleScrap, .count = 60})
		);
		EXPECT_THROW((void)hireBlocker(campaign, garageRules(), EscortId{"war_rig"}), std::invalid_argument) << "not for hire";
	}

	TEST(Garage, RepairsBuyStructureBackAPointAtATimeAndADriversArmorAfterIt) {
		Campaign	   campaign = foundTestCampaign({"outrider"});
		const ConvoyId outrider{"escort-1"};
		campaign.convoy[0].structure = 10;
		EXPECT_EQ(pointsToRepair(campaign, testContent(), outrider), 15);
		repairVehicle(campaign, testContent(), garageRules(), outrider, 10);
		EXPECT_EQ(campaign.convoy[0].structure, 20);
		EXPECT_EQ(campaign.stores.scrap, 140);
		EXPECT_EQ(
			repairBlocker(campaign, testContent(), garageRules(), outrider, 6),
			(GarageBlocker{.reason = GarageRefusal::TooManyPoints, .count = 5})
		);
		repairVehicle(campaign, testContent(), garageRules(), outrider, 5);
		EXPECT_EQ(repairBlocker(campaign, testContent(), garageRules(), outrider, 1), (GarageBlocker{.reason = GarageRefusal::Undamaged}));

		// The Road Warrior's Rig limped home a wreck (call 393): 79 structure and 10 armor short of its 80 and 10.
		const CrewId warrior = crewOf(campaign, "road_warrior");
		campaign.driver(warrior).vehicle = VehicleCondition{.structure = 1, .armor = 0};
		EXPECT_EQ(pointsToRepair(campaign, testContent(), warrior), 89);
		repairVehicle(campaign, testContent(), garageRules(), warrior, 85);
		EXPECT_EQ(campaign.driver(warrior).vehicle, (VehicleCondition{.structure = 80, .armor = 6})) << "structure first (call 400)";
		EXPECT_EQ(campaign.stores.scrap, 50);
		campaign.stores.scrap = 3;
		EXPECT_EQ(
			repairBlocker(campaign, testContent(), garageRules(), warrior, 4),
			(GarageBlocker{.reason = GarageRefusal::TooLittleScrap, .count = 4})
		);
		campaign.driver(warrior).status = DriverStatus::Missing;
		EXPECT_EQ(repairBlocker(campaign, testContent(), garageRules(), warrior, 1), (GarageBlocker{.reason = GarageRefusal::DriverAway}));
		EXPECT_THROW((void)repairBlocker(campaign, testContent(), garageRules(), outrider, 0), std::invalid_argument);
		EXPECT_THROW((void)pointsToRepair(campaign, testContent(), ConvoyId{"escort-9"}), std::invalid_argument);
	}

} // namespace
