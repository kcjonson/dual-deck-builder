#include <rules/battle/BattleState.h>
#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/RunDecks.h>
#include <rules/campaign/SupplyRun.h>
#include <rules/core/ContentError.h>
#include <rules/map/StopContents.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <optional>
#include <stdexcept>
#include <vector>

// Runs on the fast lane's map, testMap(), through its layers.
namespace {

	using namespace rules;
	using namespace rules::campaigns;

	const MapLayers& layers() {
		return testLayers();
	}

	// Founded on the test map with both of the first two drivers seated, at the game stage.
	Campaign loadedOut() {
		Campaign campaign = foundOnTestMap();
		startRun(
			campaign,
			testContent(),
			RunStart{
				.seats = {crewOf(campaign, "road_warrior"), crewOf(campaign, "interceptor")}, .escorts = {}, .stage = gameStage(campaign)
			}
		);
		campaign.stores.fuel = 100;
		return campaign;
	}

	// The first offer with a stop of the type, and that stop's place among the stops a run on it meets.
	std::pair<RouteChoice, size_t> routeWith(map::StopType type) {
		for (const map::RouteOffer& offer : offersToday(foundOnTestMap(), layers())) {
			size_t place = 0;
			for (const map::OfferedLeg& leg : offer.legs) {
				for (const map::OfferedStop& stop : leg.stops) {
					if (stop.type == type) {
						return {RouteChoice{.poi = offer.destination.poi, .route = offer.route.route}, place};
					}
					place += 1;
				}
			}
		}
		ADD_FAILURE() << "no route on the test map has the stop";
		return {};
	}

	// On the road at the stop at `place`, the stops before it behind the run.
	Campaign at(const RouteChoice& choice, size_t place) {
		Campaign campaign = loadedOut();
		depart(campaign, layers(), choice);
		while (campaign.run->route->next < static_cast<int>(place)) {
			const map::Stop& stop = layers().stops.stops[static_cast<size_t>(*stopAhead(campaign))];
			if (map::isFight(stop.type)) {
				CampaignFight fight = startStopFight(campaign, testContent(), layers()).fight;
				fight.state.phase = Phase::Over;
				fight.state.outcome = Outcome::BrokenOff;
				(void)endStopFight(campaign, testContent(), testRules(), layers(), fight);
			} else {
				driveOn(campaign, layers());
			}
		}
		return campaign;
	}

	CampaignFight ended(CampaignFight fight, Outcome outcome) {
		fight.state.phase = Phase::Over;
		fight.state.outcome = outcome;
		return fight;
	}

	TEST(SupplyRun, TheRoutesOnOfferLeaveClearedPoisOutAndRollEachStopAtItsRoll) {
		Campaign campaign = foundOnTestMap();
		const auto [supplies, place] = routeWith(map::StopType::FindSupplies);
		const std::vector<map::RouteOffer> every = offersToday(campaign, layers());
		const auto						   offered = [&](const std::vector<map::RouteOffer>& offers, int poi) {
			return std::ranges::any_of(offers, [&](const map::RouteOffer& offer) { return offer.destination.poi == poi; });
		};
		ASSERT_TRUE(offered(every, supplies.poi));

		const int other = supplies.poi == 0 ? 1 : 0;
		campaign.mapState.clearedPois = {other};
		int stop = -1;
		for (const map::RouteOffer& offer : every) {
			for (const map::OfferedLeg& leg : offer.legs) {
				for (const map::OfferedStop& on : leg.stops) {
					stop = on.type == map::StopType::FindSupplies && offer.destination.poi == supplies.poi ? on.stop : stop;
				}
			}
		}
		campaign.mapState.stops = {StopState{.stop = stop, .roll = 2, .cleared = {}}};
		const std::vector<map::RouteOffer> today = offersToday(campaign, layers());
		EXPECT_FALSE(offered(today, other));
		EXPECT_TRUE(offered(today, supplies.poi));
		for (const map::RouteOffer& offer : today) {
			for (const map::OfferedLeg& leg : offer.legs) {
				for (const map::OfferedStop& on : leg.stops) {
					if (on.stop == stop) {
						EXPECT_EQ(on.roll, 2);
						EXPECT_EQ(on.haul, map::rollStop(layers().stops, stop, 2, layers().content.stops).supplies);
					}
				}
			}
		}
	}

	TEST(SupplyRun, ALoadOutLeavesOnARoutePayingItsFuelAndPassingWhatsCleared) {
		Campaign campaign = loadedOut();
		const auto [choice, place] = routeWith(map::StopType::FindSupplies);
		const int cost = map::describeRoutes(
							 {.network = layers().network,
							  .routeLegs = layers().pois.legs,
							  .destination = choice.poi,
							  .biomeAt = layers().biomeAt,
							  .tuning = layers().routes}
		)[static_cast<size_t>(choice.route)]
							 .fuel;
		const map::Route route = map::routesTo(layers().pois.legs, choice.poi)[static_cast<size_t>(choice.route)];
		std::vector<int> every;
		for (const int leg : route.legs) {
			const std::vector<int> stops =
				map::stopsAtStage(layers().stops.legs[static_cast<size_t>(leg)], layers().stops, campaign.run->stage);
			every.insert(every.end(), stops.begin(), stops.end());
		}
		ASSERT_GT(every.size(), 1U);

		campaign.stores.fuel = cost - 1;
		EXPECT_EQ(departBlocker(campaign, layers(), choice), (DepartBlocker{.reason = DepartRefusal::Fuel, .fuel = cost}));
		campaign.stores.fuel = cost;
		campaign.mapState.stops = {StopState{.stop = every[1], .roll = 0, .cleared = 1}};
		campaign.mapState.clearedPois = {choice.poi};
		EXPECT_EQ(departBlocker(campaign, layers(), choice), (DepartBlocker{.reason = DepartRefusal::Cleared}));
		campaign.mapState.clearedPois.clear();
		depart(campaign, layers(), choice);

		EXPECT_EQ(campaign.stores.fuel, 0);
		const RunRoute& on = *campaign.run->route;
		EXPECT_EQ(on.poi, choice.poi);
		EXPECT_EQ(on.tier, layers().pois.pois[static_cast<size_t>(choice.poi)].tier);
		EXPECT_EQ(on.legs, route.legs);
		std::vector<int> met = every;
		met.erase(met.begin() + 1);
		EXPECT_EQ(on.stops, met) << "the cleared stop is driven past";
		EXPECT_EQ(stopAhead(campaign), every[0]);
		EXPECT_EQ(departBlocker(campaign, layers(), choice), (DepartBlocker{.reason = DepartRefusal::Gone}));
		EXPECT_THROW(giveUpLoadOut(campaign), std::invalid_argument) << "it has left";
		EXPECT_THROW((void)departBlocker(campaign, layers(), RouteChoice{.poi = choice.poi, .route = 3}), std::invalid_argument);

		const nlohmann::json save = writeCampaign(campaign, testContent());
		EXPECT_EQ(readCampaign(save, testContent()), campaign);
		EXPECT_NO_THROW(checkCampaignMap(campaign, testMap().map));
		Campaign elsewhere = campaign;
		elsewhere.run->route->route += 1;
		EXPECT_THROW(checkCampaignMap(elsewhere, testMap().map), ContentError);
		elsewhere = campaign;
		elsewhere.run->route->leg += 1;
		EXPECT_THROW(checkCampaignMap(elsewhere, testMap().map), ContentError);
	}

	TEST(SupplyRun, AFightWonOpensItsRewardAndHomeClearsWhatTheRunGotPastAndChartsWhatItDrove) {
		const auto [choice, place] = routeWith(map::StopType::Ambush);
		Campaign campaign = at(choice, place);
		EXPECT_THROW(driveOn(campaign, layers()), std::invalid_argument) << "only fighting gets past a fight";
		const CampaignFightStart first = startStopFight(campaign, testContent(), layers());
		EXPECT_EQ(startStopFight(campaign, testContent(), layers()).fight.state.drivers, first.fight.state.drivers)
			<< "the raiders picked on the run's stream for the stop";
		(void)endStopFight(campaign, testContent(), testRules(), layers(), ended(first.fight, Outcome::Won));
		const std::vector<CardId> reward = campaign.run->route->reward;
		EXPECT_EQ(reward.size(), 3U);
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign) << "a save holds the reward on offer";
		EXPECT_THROW((void)startStopFight(campaign, testContent(), layers()), std::invalid_argument) << "the reward's open";
		EXPECT_THROW(takeReward(campaign, testContent(), layers(), card("top_off")), std::invalid_argument);
		takeReward(campaign, testContent(), layers(), reward.front());
		EXPECT_EQ(countOf(campaign.run->cargoCards, reward.front()), 1);
		EXPECT_EQ(campaign.run->route->next, static_cast<int>(place) + 1);

		const RunRoute driven = *campaign.run->route;
		campaign.day = 2;
		(void)unloadRun(campaign, testContent(), testRules());
		for (int passed = 0; passed < driven.next; ++passed) {
			EXPECT_TRUE(std::ranges::any_of(campaign.mapState.stops, [&](const StopState& stop) {
				return stop.stop == driven.stops[static_cast<size_t>(passed)] && stop.cleared == 2;
			}));
		}
		EXPECT_EQ(campaign.mapState.stops.size(), static_cast<size_t>(driven.next));
		EXPECT_TRUE(std::ranges::is_sorted(campaign.mapState.stops, {}, &StopState::stop));
		std::vector<int> charted(driven.legs.begin(), driven.legs.begin() + driven.leg);
		std::ranges::sort(charted);
		EXPECT_EQ(campaign.mapState.chartedLegs, charted);
	}

	TEST(SupplyRun, ALostFightFailsTheRunAndClearsNothing) {
		const auto [choice, place] = routeWith(map::StopType::Ambush);
		Campaign				 campaign = at(choice, place);
		const CampaignFightStart fight = startStopFight(campaign, testContent(), layers());
		CampaignFight			 lost = ended(fight.fight, Outcome::Lost);
		for (BattleDriver& driver : lost.state.drivers) {
			driver.hitpoints = 0;
		}
		(void)endStopFight(campaign, testContent(), testRules(), layers(), lost);
		EXPECT_FALSE(campaign.run.has_value());
		EXPECT_EQ(campaign.mapState, MapState{});
	}

	TEST(SupplyRun, AFindIsTakenOrLeftAndEachKindBringsItsOwn) {
		const auto [supplied, suppliesAt] = routeWith(map::StopType::FindSupplies);
		Campaign		campaign = at(supplied, suppliesAt);
		const int		stop = *stopAhead(campaign);
		const TakenFind haul = takeFind(campaign, testContent(), testRules(), layers(), unlockedAtStart(testContent()));
		ASSERT_TRUE(haul.haul.has_value());
		EXPECT_EQ(haul.haul, map::rollStop(layers().stops, stop, 0, layers().content.stops).supplies);
		const Resources cargo = campaign.run->cargo;
		EXPECT_EQ(cargo.food + cargo.water + cargo.fuel + cargo.meds + cargo.scrap, haul.haul->amount);
		EXPECT_EQ(campaign.run->route->next, static_cast<int>(suppliesAt) + 1);

		const auto [crewed, driverAt] = routeWith(map::StopType::FindDriver);
		campaign = at(crewed, driverAt);
		const TakenFind someone = takeFind(campaign, testContent(), testRules(), layers(), unlockedAtStart(testContent()));
		ASSERT_TRUE(someone.driver.has_value());
		EXPECT_EQ(campaign.run->recruits, std::vector{std::get<DriverId>(*someone.driver)}) << "nobody's missing, so someone new";

		const auto [carded, cardsAt] = routeWith(map::StopType::FindCards);
		campaign = at(carded, cardsAt);
		const TakenFind cards = takeFind(campaign, testContent(), testRules(), layers(), unlockedAtStart(testContent()));
		EXPECT_EQ(cards.reward.size(), 3U);
		EXPECT_THROW(driveOn(campaign, layers()), std::invalid_argument) << "the cards wait to be picked or passed up";
		takeReward(campaign, testContent(), layers(), std::nullopt);
		EXPECT_TRUE(campaign.run->cargoCards.empty());

		campaign = at(supplied, suppliesAt);
		driveOn(campaign, layers());
		EXPECT_EQ(campaign.run->cargo, Resources{}) << "left by the road";
	}

} // namespace
