#include <rules/campaign/CampaignTesting.h>

#include <gtest/gtest.h>

#include <set>
#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	TEST(Founding, DealsEachUnlockedArchetypeOnceWithTheirStartingDecksAndTheStartsStores) {
		const Campaign campaign = foundTestCampaign();
		ASSERT_EQ(campaign.drivers.size(), 3U) << "three archetypes start unlocked, fewer than the pool of four";
		EXPECT_EQ(campaign.nextDriverNumber, 4);
		std::set<DriverId> dealt;
		for (size_t index = 0; index < campaign.drivers.size(); ++index) {
			const DriverRecord&		driver = campaign.drivers[index];
			const DriverDefinition& archetype = testContent().drivers.at(driver.archetype);
			EXPECT_EQ(driver.id, CrewId{"driver-" + std::to_string(index + 1)});
			EXPECT_EQ(driver.status, DriverStatus::Ready);
			EXPECT_EQ(driver.hitpoints, archetype.maxHitpoints);
			EXPECT_EQ(driver.vehicle, (VehicleCondition{.structure = archetype.vehicle.maxStructure, .armor = archetype.vehicle.armor}));
			int cards = 0;
			for (const DeckEntry& entry : archetype.startingDeck) {
				EXPECT_EQ(countOf(driver.defaultDeck, entry.card), entry.count) << driver.archetype.value << " " << entry.card.value;
				cards += entry.count;
			}
			EXPECT_EQ(totalCards(driver.defaultDeck), cards);
			dealt.insert(driver.archetype);
		}
		EXPECT_EQ(dealt, (std::set{DriverId{"interceptor"}, DriverId{"mechanic"}, DriverId{"road_warrior"}}));

		EXPECT_EQ(campaign.stores, testRules().start.stores);
		EXPECT_EQ(campaign.buildings, std::vector{Building::Bunkhouse});
		EXPECT_EQ(campaign.day, 1);
		EXPECT_EQ(campaign.unrest, 0);
		EXPECT_TRUE(campaign.locker.empty());
		EXPECT_TRUE(campaign.convoy.empty());
		EXPECT_FALSE(campaign.run.has_value());
		EXPECT_EQ(campaign.log, (std::vector{LogEntry{.day = 1, .text = "Founded the compound."}}));
		EXPECT_EQ(campaign.packs, (std::vector{PackRef{.id = PackId{"base"}, .version = "0.1.0"}}));

		// The deal is the seed's: pinned, so moving its stream, sort, or shuffle shows up here.
		EXPECT_EQ(foundTestCampaign(), campaign);
		std::vector<DriverId> order;
		for (const DriverRecord& driver : campaign.drivers) {
			order.push_back(driver.archetype);
		}
		EXPECT_EQ(order, (std::vector{DriverId{"interceptor"}, DriverId{"road_warrior"}, DriverId{"mechanic"}}));
		std::set<DriverId> firsts;
		for (uint32_t seed = 0; seed < 20; ++seed) {
			firsts.insert(foundTestCampaign({}, seed).drivers.front().archetype);
		}
		EXPECT_EQ(firsts.size(), 3U) << "any of them can be dealt first";
	}

	TEST(Founding, ThePoolSizeCutsTheDealStarterEscortsJoinTheConvoyAndTwoArchetypesAreTheLeast) {
		CampaignRules rules = testRules();
		rules.start.poolSize = 2;
		rules.start.escorts = {EscortId{"fuel_hauler"}, EscortId{"med_truck"}};
		const std::vector<DriverId> unlocked{
			DriverId{"road_warrior"}, DriverId{"mechanic"}, DriverId{"road_warrior"}, DriverId{"interceptor"}
		};
		const Campaign campaign = foundCampaign(testContent(), rules, Founding{.seed = 3, .unlocked = unlocked});
		EXPECT_EQ(campaign.drivers.size(), 2U);
		EXPECT_NE(campaign.drivers[0].archetype, campaign.drivers[1].archetype);
		EXPECT_EQ(
			campaign.convoy,
			(std::vector{
				ConvoyEscort{.id = ConvoyId{"escort-1"}, .type = EscortId{"fuel_hauler"}, .structure = 40},
				ConvoyEscort{.id = ConvoyId{"escort-2"}, .type = EscortId{"med_truck"}, .structure = 35},
			})
		);
		EXPECT_EQ(campaign.nextEscortNumber, 3);

		const auto found = [&](std::vector<DriverId> archetypes) {
			return foundCampaign(testContent(), rules, Founding{.seed = 3, .unlocked = std::move(archetypes)});
		};
		EXPECT_THROW((void)found({DriverId{"mechanic"}, DriverId{"mechanic"}}), std::invalid_argument);
		EXPECT_THROW((void)found({DriverId{"mechanic"}, DriverId{"war_boy"}}), std::invalid_argument);
	}

} // namespace
