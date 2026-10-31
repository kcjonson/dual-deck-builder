#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/CombatBridge.h>
#include <rules/campaign/Convoy.h>
#include <rules/campaign/RunDecks.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	const ConvoyId kFirst{"escort-1"};
	const ConvoyId kSecond{"escort-2"};

	TEST(Convoy, AnEscortJoiningMidRunComesAlongWithItsOwnCardAndLeavingTakesOnlyThatCopy) {
		Campaign	 campaign = foundTestCampaign({"med_truck"});
		const CrewId warrior = crewOf(campaign, "road_warrior");
		const CrewId interceptor = crewOf(campaign, "interceptor");
		startRun(campaign, testContent(), RunStart{.seats = {warrior, interceptor}, .escorts = {kFirst}});

		EXPECT_EQ(joinConvoy(campaign, testContent(), EscortId{"med_truck"}), kSecond);
		EXPECT_EQ(campaign.convoy.back(), (ConvoyEscort{.id = kSecond, .type = EscortId{"med_truck"}, .structure = 35}));
		EXPECT_EQ(campaign.run->escorts, (std::vector{kFirst, kSecond}));
		EXPECT_EQ(
			campaign.runDeckOf(warrior)->escortCards,
			(std::vector{EscortCard{.card = card("triage"), .broughtBy = kFirst}, EscortCard{.card = card("triage"), .broughtBy = kSecond}})
		) << "each Med Truck brings its own Triage into Driver 1's (call 402)";
		moveEscortCard(campaign, kSecond, interceptor);
		const BattleState state = startCampaignFight(campaign, testContent(), EncounterId{"scav_tail"}).fight.state;
		EXPECT_EQ(
			std::ranges::count_if(
				state.vehicles, [](const BattleVehicle& vehicle) { return vehicle.side == Side::Player && vehicle.escort; }
			),
			2
		) << "the next fight fields it";
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);

		dismissEscort(campaign, kFirst);
		EXPECT_EQ(campaign.convoy.size(), 1U);
		EXPECT_EQ(campaign.run->escorts, std::vector{kSecond});
		EXPECT_TRUE(campaign.runDeckOf(warrior)->escortCards.empty()) << "the first Med Truck's Triage leaves with it";
		EXPECT_EQ(campaign.runDeckOf(interceptor)->escortCards, (std::vector{EscortCard{.card = card("triage"), .broughtBy = kSecond}}));
		EXPECT_THROW((void)dismissBlocker(campaign, kFirst), std::invalid_argument) << "dismissed already";

		// Four in the convoy, and one has to go before another joins; on the road only one along can.
		for (const std::string_view type : {"outrider", "pilot_car", "fuel_hauler"}) {
			(void)joinConvoy(campaign, testContent(), EscortId{std::string(type)});
		}
		EXPECT_EQ(joinBlocker(campaign), ConvoyRefusal::ConvoyFull);
		EXPECT_THROW((void)joinConvoy(campaign, testContent(), EscortId{"outrider"}), std::invalid_argument);
		(void)unloadRun(campaign, testContent(), testRules());
		startRun(campaign, testContent(), RunStart{.seats = {warrior, interceptor}, .escorts = {kSecond}});
		EXPECT_EQ(dismissBlocker(campaign, ConvoyId{"escort-3"}), ConvoyRefusal::NotAlong) << "call 403";
		EXPECT_FALSE(dismissBlocker(campaign, kSecond).has_value());
	}

} // namespace
