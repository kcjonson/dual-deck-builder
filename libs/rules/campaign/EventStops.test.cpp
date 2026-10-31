#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/Convoy.h>
#include <rules/campaign/RunTesting.h>
#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <stdexcept>
#include <string_view>
#include <vector>

// Runs on the fast lane's map, testMap(), through its layers, with events of the base pack's set apart so a stop can
// only open the one under test.
namespace {

	using namespace rules;
	using namespace rules::campaigns;

	const MapLayers& layers() {
		return testLayers();
	}

	// The base pack's events but the one named, which a stop of its type has to open.
	Events only(std::string_view id) {
		Events events;
		events.emplace(EventId{std::string(id)}, testEvents().at(EventId{std::string(id)}));
		return events;
	}

	EventChoice& choiceIn(Events& events, std::string_view id) {
		std::vector<EventChoice>& choices = events.begin()->second.choices;
		return *std::ranges::find(choices, id, &EventChoice::id);
	}

	EventTaken take(Campaign& campaign, const Events& events, std::string_view choice) {
		return takeEventChoice(campaign, testContent(), testRules(), events, layers(), unlockedAtStart(testContent()), choice);
	}

	CampaignFight runFight(const Campaign& campaign) {
		return startRunFight(campaign, testContent(), layers()).fight;
	}

	int mostHitpoints(const Campaign& campaign, size_t seat) {
		return testContent().drivers.at(campaign.driver(campaign.run->seats[seat].driver).archetype).maxHitpoints;
	}

	TEST(EventStops, AWreckOpensOneOfItsEventsTheSameEachTimeAndOnlyAChoiceGetsPastIt) {
		const auto [wreck, place] = routeWith(map::StopType::Wreck);
		Campaign campaign = at(wreck, place);
		EXPECT_EQ(ahead(campaign, layers()), Ahead::Event);
		const EventDefinition& event = stopEvent(campaign, testEvents(), layers());
		EXPECT_EQ(event.stopType, map::StopType::Wreck);
		EXPECT_EQ(&stopEvent(campaign, testEvents(), layers()), &event) << "picked on the run's stream for the stop";
		EXPECT_THROW(driveOn(campaign, layers()), std::invalid_argument) << "no quiet stretch any more";
		EXPECT_THROW((void)startRunFight(campaign, testContent(), layers()), std::invalid_argument);
		EXPECT_THROW((void)takeFind(campaign, testContent(), testRules(), layers(), unlockedAtStart(testContent())), std::invalid_argument);
		EXPECT_THROW((void)choiceBlocker(campaign, testEvents(), layers(), "siphon_harder"), std::invalid_argument);

		const Campaign	 before = campaign;
		const EventTaken taken = take(campaign, testEvents(), passingChoice(campaign));
		EXPECT_EQ(taken.event, event.id);
		EXPECT_FALSE(taken.fight);
		EXPECT_EQ(campaign.run->route->next, static_cast<int>(place) + 1);
		EXPECT_EQ(campaign.run->cargo, before.run->cargo) << "driving on takes nothing and gives nothing";
		EXPECT_EQ(campaign.stores, before.stores);
	}

	TEST(EventStops, AChoiceIsLockedByWhatThePartyLacksInOrderAndAFullConvoyDismissesFirst) {
		const auto [distress, distressAt] = routeWith(map::StopType::Distress);
		Campaign	 campaign = at(distress, distressAt);
		const Events family = only("family_under_fire");
		EXPECT_EQ(choiceBlocker(campaign, family, layers(), "kill_engines"), ChoiceBlocker{.reason = ChoiceRefusal::Card})
			<< "nobody seated brought EMP Blast";
		EXPECT_EQ(choiceBlocker(campaign, family, layers(), "charge"), std::nullopt);
		campaign.stores.fuel = 1;
		campaign.run->cargo.fuel = 1;
		EXPECT_EQ(
			choiceBlocker(campaign, family, layers(), "pay_them_off"),
			(ChoiceBlocker{.reason = ChoiceRefusal::Cost, .resource = map::Resource::Fuel, .needed = 3, .held = 2})
		) << "the cargo and the stores together";
		EXPECT_THROW((void)take(campaign, family, "pay_them_off"), std::invalid_argument);
		EXPECT_EQ(
			choiceBlocker(campaign, only("mayday_channel_nine"), layers(), "treat_on_the_spot"),
			ChoiceBlocker{.reason = ChoiceRefusal::Escort}
		);

		const auto [wreck, wreckAt] = routeWith(map::StopType::Wreck);
		const Events armored = only("armored_car");
		Campaign	 crewed = at(wreck, wreckAt);
		EXPECT_EQ(choiceBlocker(crewed, armored, layers(), "get_it_running"), ChoiceBlocker{.reason = ChoiceRefusal::Archetype});

		Campaign full = loadedOut("mechanic", "road_warrior");
		for (int escort = 0; escort < kMostEscorts; ++escort) {
			(void)joinConvoy(full, testContent(), EscortId{"pilot_car"});
		}
		full = at(wreck, wreckAt, full);
		EXPECT_EQ(choiceBlocker(full, armored, layers(), "get_it_running"), ChoiceBlocker{.reason = ChoiceRefusal::ConvoyFull})
			<< "the outrider it gives needs room";
		dismissEscort(full, full.run->escorts.front());
		EXPECT_EQ(choiceBlocker(full, armored, layers(), "get_it_running"), std::nullopt);
	}

	TEST(EventStops, TakingAChoicePaysItsCostFromTheCargoThenTheStoresAndGivesItsOutcome) {
		const auto [wreck, place] = routeWith(map::StopType::Wreck);
		const Events armored = only("armored_car");
		Campaign	 campaign = at(wreck, place, loadedOut("mechanic", "road_warrior"));
		campaign.run->cargo.scrap = 5;
		const int		 stores = campaign.stores.scrap;
		const EventTaken joined = take(campaign, armored, "get_it_running");
		EXPECT_EQ(campaign.run->cargo.scrap, 0);
		EXPECT_EQ(campaign.stores.scrap, stores - 3);
		ASSERT_TRUE(joined.escort.has_value());
		EXPECT_EQ(campaign.run->escorts, std::vector{*joined.escort}) << "it joins the run at once (call 402)";
		EXPECT_EQ(campaign.findEscort(*joined.escort)->type, EscortId{"outrider"});
		const EscortCard brought{.card = testContent().escorts.at(EscortId{"outrider"}).signatureCard, .broughtBy = *joined.escort};
		EXPECT_EQ(campaign.run->seats.front().escortCards, std::vector{brought});
		EXPECT_EQ(campaign.run->route->next, static_cast<int>(place) + 1);
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);

		campaign = at(wreck, place);
		(void)take(campaign, armored, "pry_doors");
		EXPECT_EQ(campaign.run->cargo, Resources{.scrap = 4});
		EXPECT_EQ(campaign.run->cargoCards, (CardCounts{{card("armor_plating"), 1}})) << "cards ride home as cards won";

		Events bus = only("burned_bus");
		campaign = at(wreck, place);
		const EventTaken tracked = take(campaign, bus, "follow_tracks");
		EXPECT_EQ(campaign.run->cargo, (Resources{.food = 3, .water = 2, .meds = 1}));
		EXPECT_EQ(tracked.reward.size(), 3U) << "the card pick opens the reward";
		EXPECT_EQ(campaign.run->route->reward, tracked.reward);
		EXPECT_EQ(ahead(campaign, layers()), Ahead::Reward);
		EXPECT_NO_THROW(checkCampaignMap(campaign, testMap().map)) << "a reward on offer at an event";
		takeReward(campaign, testContent(), layers(), std::nullopt);
		EXPECT_EQ(campaign.run->route->next, static_cast<int>(place) + 1);
	}

	TEST(EventStops, AnOutcomeHurtsEverySeatNoLowerThanOneAndMendsThemNoHigherThanTheirMost) {
		const auto [wreck, place] = routeWith(map::StopType::Wreck);
		Events		 tanker = only("jackknifed_tanker");
		EventChoice& strip = choiceIn(tanker, "strip_cab");
		strip.outcomes.erase(strip.outcomes.begin());
		strip.outcomes.front().gains.lost = Resources{.food = 5, .water = 100};
		Campaign	  campaign = at(wreck, place);
		DriverRecord& first = campaign.driver(campaign.run->seats[0].driver);
		first.hitpoints = 1;
		first.vehicle.structure = 2;
		const DriverRecord second = campaign.driver(campaign.run->seats[1].driver);
		campaign.run->cargo.food = 2;
		const Resources stores = campaign.stores;
		(void)take(campaign, tanker, "strip_cab");
		EXPECT_EQ(campaign.driver(campaign.run->seats[0].driver).hitpoints, 1);
		EXPECT_EQ(campaign.driver(campaign.run->seats[0].driver).vehicle.structure, 1);
		EXPECT_EQ(campaign.driver(second.id).hitpoints, second.hitpoints - 2);
		EXPECT_EQ(campaign.driver(second.id).vehicle.structure, second.vehicle.structure - 3);
		EXPECT_EQ(campaign.run->cargo, Resources{.scrap = 4}) << "the cargo's food went first";
		EXPECT_EQ(campaign.stores.food, stores.food - 3);
		EXPECT_EQ(campaign.stores.water, 0) << "never below 0";

		const auto [distress, distressAt] = routeWith(map::StopType::Distress);
		Campaign mended = loadedOut();
		(void)joinConvoy(mended, testContent(), EscortId{"med_truck"});
		mended = at(distress, distressAt, mended);
		mended.driver(mended.run->seats[0].driver).hitpoints = mostHitpoints(mended, 0) - 2;
		mended.driver(mended.run->seats[1].driver).hitpoints = mostHitpoints(mended, 1) - 10;
		const EventTaken treated = take(mended, only("mayday_channel_nine"), "treat_on_the_spot");
		EXPECT_EQ(mended.driver(mended.run->seats[0].driver).hitpoints, mostHitpoints(mended, 0));
		EXPECT_EQ(mended.driver(mended.run->seats[1].driver).hitpoints, mostHitpoints(mended, 1) - 6);
		EXPECT_EQ(treated.recruits.size(), 1U);
		EXPECT_EQ(mended.run->recruits, treated.recruits) << "someone new rides home";
	}

	TEST(EventStops, AnOutcomeThatTurnsIntoAFightWaitsAtTheStopAndOnlyAWinGivesWhatItsFightDoes) {
		const auto [wreck, place] = routeWith(map::StopType::Wreck);
		Events		 bait = only("burned_bus");
		EventChoice& search = choiceIn(bait, "search_bus");
		search.outcomes.erase(search.outcomes.begin());
		Campaign		 campaign = at(wreck, place);
		const EventTaken taken = take(campaign, bait, "search_bus");
		EXPECT_TRUE(taken.fight);
		ASSERT_TRUE(campaign.run->route->handOff.has_value());
		EXPECT_EQ(campaign.run->route->handOff->skulls, 1);
		EXPECT_EQ(campaign.run->route->handOff->resources, Resources{.scrap = 6});
		EXPECT_EQ(campaign.run->cargo, Resources{}) << "the fight's yet to be won";
		EXPECT_EQ(ahead(campaign, layers()), Ahead::Fight);
		EXPECT_THROW(driveOn(campaign, layers()), std::invalid_argument);
		EXPECT_THROW((void)choiceBlocker(campaign, bait, layers(), "search_bus"), std::invalid_argument) << "its choice is taken";
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign) << "the save keeps the fight";
		EXPECT_NO_THROW(checkCampaignMap(campaign, testMap().map));
		nlohmann::json past = writeCampaign(campaign, testContent());
		past["run"]["route"]["next"] = campaign.run->route->stops.size();
		EXPECT_THROW((void)readCampaign(past, testContent()), ContentError) << "no event's fight waits past the stops";

		const CampaignFight fight = runFight(campaign);
		Campaign			brokeOff = campaign;
		(void)endRunFight(brokeOff, testContent(), testRules(), layers(), ended(fight, Outcome::BrokenOff));
		EXPECT_EQ(brokeOff.run->route->next, static_cast<int>(place) + 1);
		EXPECT_FALSE(brokeOff.run->route->handOff.has_value());
		EXPECT_EQ(brokeOff.run->cargo, Resources{}) << "a break-off gives nothing more";

		(void)endRunFight(campaign, testContent(), testRules(), layers(), ended(fight, Outcome::Won));
		EXPECT_FALSE(campaign.run->route->handOff.has_value());
		EXPECT_EQ(campaign.run->cargo, Resources{.scrap = 6});
		EXPECT_EQ(campaign.run->route->reward.size(), 3U) << "then the reward, as every won fight";
		takeReward(campaign, testContent(), layers(), std::nullopt);
		EXPECT_EQ(campaign.run->route->next, static_cast<int>(place) + 1);

		const auto [distress, distressAt] = routeWith(map::StopType::Distress);
		Events		 gang = only("mayday_channel_nine");
		EventChoice& pull = choiceIn(gang, "pull_her_out");
		pull.outcomes.erase(pull.outcomes.begin());
		Campaign rescue = at(distress, distressAt);
		(void)take(rescue, gang, "pull_her_out");
		ASSERT_TRUE(rescue.run->route->handOff.has_value());
		const std::vector<DriverId> recruits = rescue.run->route->handOff->recruits;
		EXPECT_EQ(recruits.size(), 1U) << "drawn when the choice is taken";
		EXPECT_TRUE(rescue.run->recruits.empty()) << "and riding home only on a win";
		(void)endRunFight(rescue, testContent(), testRules(), layers(), ended(runFight(rescue), Outcome::Won));
		EXPECT_EQ(rescue.run->recruits, recruits);
	}

} // namespace
