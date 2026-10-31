#include <rules/battle/Encounters.h>
#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/DayClock.h>
#include <rules/campaign/RunProgress.h>
#include <rules/campaign/RunTesting.h>
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

	// The base pack's rules with the return ambush coming at every stage.
	CampaignRules alwaysAmbushed() {
		CampaignRules rules = testRules();
		rules.compound.returnAmbush.fill(100);
		return rules;
	}

	// The route to a POI that isn't a stronghold meeting the fewest stops, the first of those.
	const map::RouteOffer& shortest() {
		static const std::vector<map::RouteOffer> offers = offersToday(foundOnTestMap(), layers());
		const map::RouteOffer*					  fewest = nullptr;
		const auto								  stopsOn = [](const map::RouteOffer& offer) {
			   size_t stops = 0;
			   for (const map::OfferedLeg& leg : offer.legs) {
				   stops += leg.stops.size();
			   }
			   return stops;
		};
		for (const map::RouteOffer& offer : offers) {
			if (!offer.destination.stronghold && (fewest == nullptr || stopsOn(offer) < stopsOn(*fewest))) {
				fewest = &offer;
			}
		}
		return *fewest;
	}

	RouteChoice routeChoice(const map::RouteOffer& offer) {
		return RouteChoice{.poi = offer.destination.poi, .route = offer.route.route};
	}

	// At the POI, every stop behind the run.
	Campaign atPoi(const RouteChoice& choice) {
		Campaign leaving = loadedOut();
		depart(leaving, layers(), choice);
		return at(choice, leaving.run->route->stops.size());
	}

	Resources yieldsOf(const map::OfferedDestination& destination) {
		const auto yield = [&](map::Resource resource) {
			return destination.yields[static_cast<size_t>(resource)];
		};
		return Resources{
			.food = yield(map::Resource::Food),
			.water = yield(map::Resource::Water),
			.fuel = yield(map::Resource::Fuel),
			.meds = yield(map::Resource::Meds),
			.scrap = yield(map::Resource::Scrap),
			.people = 0,
		};
	}

	// The most skulls among the fights the run meets, at least 1.
	int riskOf(const Campaign& campaign) {
		int risk = 1;
		for (const int stop : campaign.run->route->stops) {
			const map::Stop& met = layers().stops.stops[static_cast<size_t>(stop)];
			risk = map::isFight(met.type) ? std::max(risk, met.skulls) : risk;
		}
		return risk;
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
		const int stronghold = layers().pois.strongholds.front().poi;
		EXPECT_EQ(departBlocker(campaign, layers(), {.poi = stronghold, .route = 0}), (DepartBlocker{.reason = DepartRefusal::Stronghold}))
			<< "its objective is a boss fight, which isn't built";
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
		elsewhere = campaign;
		elsewhere.run->route->poi = stronghold;
		elsewhere.run->route->tier = layers().pois.pois[static_cast<size_t>(stronghold)].tier;
		elsewhere.run->route->legs = map::routesTo(layers().pois.legs, stronghold).front().legs;
		elsewhere.run->route->route = 0;
		EXPECT_THROW(checkCampaignMap(elsewhere, testMap().map), ContentError) << "no run is out on a stronghold's road";
	}

	TEST(SupplyRun, AFightWonOpensItsRewardAndTheRunComesHomeOnlyPastItsObjective) {
		const auto [choice, place] = routeWith(map::StopType::Ambush);
		Campaign campaign = at(choice, place);
		EXPECT_EQ(ahead(campaign, layers()), Ahead::Fight);
		EXPECT_THROW(driveOn(campaign, layers()), std::invalid_argument) << "only fighting gets past a fight";
		const CampaignFightStart first = startRunFight(campaign, testContent(), layers());
		EXPECT_EQ(startRunFight(campaign, testContent(), layers()).fight.state.drivers, first.fight.state.drivers)
			<< "the raiders picked on the run's stream for the stop";
		(void)endRunFight(campaign, testContent(), testRules(), layers(), ended(first.fight, Outcome::Won));
		const std::vector<CardId> reward = campaign.run->route->reward;
		EXPECT_EQ(reward.size(), 3U);
		EXPECT_EQ(ahead(campaign, layers()), Ahead::Reward);
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign) << "a save holds the reward on offer";
		EXPECT_NO_THROW(checkCampaignMap(campaign, testMap().map));
		EXPECT_THROW((void)startRunFight(campaign, testContent(), layers()), std::invalid_argument) << "the reward's open";
		EXPECT_THROW(takeReward(campaign, testContent(), layers(), card("top_off")), std::invalid_argument);
		takeReward(campaign, testContent(), layers(), reward.front());
		EXPECT_EQ(countOf(campaign.run->cargoCards, reward.front()), 1);
		EXPECT_EQ(campaign.run->route->next, static_cast<int>(place) + 1);
		EXPECT_THROW((void)unloadRun(campaign, testContent(), testRules()), std::invalid_argument) << "runs are one way";
	}

	TEST(SupplyRun, ALostFightFailsTheRunAndClearsNothing) {
		const auto [choice, place] = routeWith(map::StopType::Ambush);
		Campaign				 campaign = at(choice, place);
		const CampaignFightStart fight = startRunFight(campaign, testContent(), layers());
		CampaignFight			 lost = ended(fight.fight, Outcome::Lost);
		for (BattleDriver& driver : lost.state.drivers) {
			driver.hitpoints = 0;
		}
		(void)endRunFight(campaign, testContent(), testRules(), layers(), lost);
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

	TEST(SupplyRun, TheObjectiveTakesThePoisWholeYieldAndNoAmbushComesBeforeGameStage2) {
		const map::RouteOffer& offer = shortest();
		Campaign			   campaign = atPoi(routeChoice(offer));
		EXPECT_EQ(ahead(campaign, layers()), Ahead::Objective);
		EXPECT_EQ(stopAhead(campaign), std::nullopt);
		EXPECT_THROW((void)unloadRun(campaign, testContent(), testRules()), std::invalid_argument) << "the objective's still ahead";
		EXPECT_THROW((void)startRunFight(campaign, testContent(), layers()), std::invalid_argument);
		EXPECT_THROW(driveOn(campaign, layers()), std::invalid_argument);

		const Resources		 before = campaign.run->cargo;
		const ObjectiveTaken taken = takeObjective(campaign, testRules(), layers());
		EXPECT_EQ(taken.yields, yieldsOf(offer.destination));
		EXPECT_NE(taken.yields, Resources{});
		EXPECT_EQ(campaign.run->cargo, before + taken.yields);
		EXPECT_FALSE(taken.ambush) << "game stage " << campaign.run->stage;
		EXPECT_EQ(ahead(campaign, layers()), Ahead::Home);
		EXPECT_THROW((void)takeObjective(campaign, testRules(), layers()), std::invalid_argument) << "it's taken";
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);

		nlohmann::json save = writeCampaign(campaign, testContent());
		save["run"]["route"]["ambush"] = true;
		save["run"]["route"]["objective"] = false;
		EXPECT_THROW((void)readCampaign(save, testContent()), ContentError) << "no ambush waits before the objective";
		save["run"]["route"]["ambush"] = false;
		save["run"]["route"]["objective"] = true;
		save["run"]["route"]["next"] = 0;
		save["run"]["route"]["leg"] = 0;
		EXPECT_THROW((void)readCampaign(save, testContent()), ContentError) << "nor is the objective taken with stops ahead";
	}

	TEST(SupplyRun, TheReturnAmbushIsAFightOfTheRoutesRiskWithTheCargoAtStake) {
		const CampaignRules	   rules = alwaysAmbushed();
		const map::RouteOffer& offer = shortest();
		Campaign			   ambushed = atPoi(routeChoice(offer));
		EXPECT_TRUE(takeObjective(ambushed, rules, layers()).ambush);
		EXPECT_EQ(ahead(ambushed, layers()), Ahead::Fight);
		EXPECT_THROW((void)unloadRun(ambushed, testContent(), rules), std::invalid_argument) << "the ambush waits on the road";
		EXPECT_EQ(readCampaign(writeCampaign(ambushed, testContent()), testContent()), ambushed);

		const CampaignFightStart fight = startRunFight(ambushed, testContent(), layers());
		const EncounterId encounter = pickEncounter(testContent(), riskOf(ambushed), offer.destination.tier, returnStream(ambushed).seed());
		EXPECT_EQ(fight.fight.state.drivers, startCampaignFight(ambushed, testContent(), encounter).fight.state.drivers)
			<< "at the route's risk and the POI's tier, on the run's stream for the road home";

		Campaign brokeOff = ambushed;
		(void)endRunFight(brokeOff, testContent(), rules, layers(), ended(fight.fight, Outcome::BrokenOff));
		EXPECT_EQ(ahead(brokeOff, layers()), Ahead::Home) << "home with no reward";

		Campaign	  failed = ambushed;
		CampaignFight lost = ended(fight.fight, Outcome::Lost);
		for (BattleDriver& driver : lost.state.drivers) {
			driver.hitpoints = 0;
		}
		const Resources		 cargo = failed.run->cargo;
		const FightWriteBack written = endRunFight(failed, testContent(), rules, layers(), lost);
		ASSERT_TRUE(written.lost.has_value());
		EXPECT_EQ(written.lost->cargo, cargo) << "the POI's yield with the rest";
		EXPECT_EQ(failed.mapState, MapState{}) << "a failed run clears nothing";

		(void)endRunFight(ambushed, testContent(), rules, layers(), ended(fight.fight, Outcome::Won));
		const std::vector<CardId> reward = ambushed.run->route->reward;
		EXPECT_EQ(reward.size(), 3U);
		EXPECT_EQ(ahead(ambushed, layers()), Ahead::Reward);
		EXPECT_EQ(readCampaign(writeCampaign(ambushed, testContent()), testContent()), ambushed);
		takeReward(ambushed, testContent(), layers(), reward.back());
		EXPECT_EQ(ahead(ambushed, layers()), Ahead::Home);
		EXPECT_EQ(countOf(ambushed.run->cargoCards, reward.back()), 1);
	}

	// A whole run: every stop played as it comes, the objective, the return ambush, and home at the day's end.
	TEST(SupplyRun, ARunPlaysEveryStopTakesItsObjectiveFightsTheAmbushAndComesHomeAtTheDayEnd) {
		const CampaignRules				   rules = alwaysAmbushed();
		const map::RouteOffer*			   chosen = nullptr;
		const std::vector<map::RouteOffer> offers = offersToday(foundOnTestMap(), layers());
		for (const map::RouteOffer& offer : offers) {
			bool fight = false;
			bool event = false;
			bool find = false;
			for (const map::OfferedLeg& leg : offer.legs) {
				for (const map::OfferedStop& stop : leg.stops) {
					fight = fight || map::isFight(stop.type);
					event = event || resolvesAsEvent(stop.type);
					find = find || stop.type == map::StopType::FindCards || stop.type == map::StopType::FindSupplies ||
						   stop.type == map::StopType::FindDriver;
				}
			}
			if (!offer.destination.stronghold && fight && event && find) {
				chosen = &offer;
				break;
			}
		}
		ASSERT_NE(chosen, nullptr) << "a route meets a fight, an event, and a find";
		const map::RouteOffer& offer = *chosen;

		Campaign campaign = loadedOut();
		depart(campaign, layers(), routeChoice(offer));
		const RunRoute left = *campaign.run->route;
		int			   fights = 0;
		int			   events = 0;
		for (int step = 0; ahead(campaign, layers()) != Ahead::Home; ++step) {
			ASSERT_LT(step, 30) << "the run gets home";
			switch (ahead(campaign, layers())) {
				case Ahead::Fight: {
					const CampaignFight fight = startRunFight(campaign, testContent(), layers()).fight;
					(void)endRunFight(campaign, testContent(), rules, layers(), ended(fight, Outcome::Won));
					++fights;
					break;
				}
				case Ahead::Event: {
					const EventDefinition& event = stopEvent(campaign, testEvents(), layers());
					const auto			   open = std::ranges::find_if(event.choices, [&](const EventChoice& choice) {
						return !choiceBlocker(campaign, testEvents(), layers(), choice.id);
					});
					(void)takeEventChoice(campaign, testContent(), rules, testEvents(), layers(), unlockedAtStart(testContent()), open->id);
					++events;
					break;
				}
				case Ahead::Find:
					(void)takeFind(campaign, testContent(), rules, layers(), unlockedAtStart(testContent()));
					break;
				case Ahead::Reward:
					takeReward(campaign, testContent(), layers(), campaign.run->route->reward.front());
					break;
				case Ahead::Objective:
					EXPECT_EQ(takeObjective(campaign, rules, layers()).yields, yieldsOf(offer.destination));
					break;
				case Ahead::Home:
					break;
			}
		}
		EXPECT_GE(fights, 2) << "a fight stop and the return ambush";
		EXPECT_GE(events, 1);
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);

		// Spelled out, since a test's own Run() hides the type.
		const campaign::Run run = *campaign.run;
		const Resources		stores = campaign.stores;
		const CardCounts	locker = campaign.locker;
		const Unloaded		home = unloadRun(campaign, testContent(), rules);
		EXPECT_FALSE(campaign.run.has_value());
		EXPECT_EQ(home.resources, run.cargo);
		EXPECT_EQ(campaign.stores, stores + run.cargo);
		CardCounts won = locker;
		addCards(won, run.cargoCards);
		EXPECT_EQ(campaign.locker, won);
		EXPECT_EQ(campaign.tally.runsHome, 1);
		EXPECT_EQ(campaign.tally.fightsWon, fights);
		EXPECT_EQ(campaign.mapState.clearedPois, std::vector{offer.destination.poi});
		ASSERT_EQ(campaign.mapState.stops.size(), left.stops.size());
		for (const StopState& stop : campaign.mapState.stops) {
			EXPECT_NE(std::ranges::find(left.stops, stop.stop), left.stops.end());
			EXPECT_EQ(stop.cleared, 1);
		}
		std::vector<int> charted = left.legs;
		std::ranges::sort(charted);
		EXPECT_EQ(campaign.mapState.chartedLegs, charted);

		const DayEnd night = endDay(campaign, testContent(), rules);
		EXPECT_EQ(night.day, 1);
		EXPECT_EQ(campaign.day, 2);
		EXPECT_FALSE(campaign.end.has_value());
		EXPECT_EQ(readCampaign(writeCampaign(campaign, testContent()), testContent()), campaign);
		EXPECT_NO_THROW(checkCampaignMap(campaign, testMap().map));
		EXPECT_TRUE(std::ranges::none_of(offersToday(campaign, layers()), [&](const map::RouteOffer& today) {
			return today.destination.poi == offer.destination.poi;
		})) << "a cleared POI is off the offers for good";
	}

} // namespace
