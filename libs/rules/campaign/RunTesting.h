#pragma once

// Shared by the tests of a run on the road, on the fast lane's map, testMap(), through its layers.

#include <rules/battle/BattleState.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/EventStops.h>
#include <rules/campaign/RunDecks.h>
#include <rules/campaign/SupplyRun.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

namespace rules::campaigns {

	// Founded on the test map with drivers of the two archetypes seated at the game stage, and fuel to go anywhere.
	inline Campaign loadedOut(std::string_view first = "road_warrior", std::string_view second = "interceptor") {
		Campaign campaign = foundOnTestMap();
		startRun(
			campaign,
			testContent(),
			RunStart{.seats = {crewOf(campaign, first), crewOf(campaign, second)}, .escorts = {}, .stage = gameStage(campaign)}
		);
		campaign.stores.fuel = 100;
		return campaign;
	}

	// The route to a POI that isn't a stronghold where a stop of the type comes soonest, and its place among the stops a
	// run on it meets.
	inline std::pair<RouteChoice, size_t> routeWith(map::StopType type) {
		std::optional<std::pair<RouteChoice, size_t>> soonest;
		for (const map::RouteOffer& offer : offersToday(foundOnTestMap(), testLayers())) {
			size_t place = 0;
			for (const map::OfferedLeg& leg : offer.legs) {
				for (const map::OfferedStop& stop : leg.stops) {
					if (stop.type == type && !offer.destination.stronghold && (!soonest || place < soonest->second)) {
						soonest = {RouteChoice{.poi = offer.destination.poi, .route = offer.route.route}, place};
					}
					place += 1;
				}
			}
		}
		if (!soonest) {
			ADD_FAILURE() << "no route on the test map has the stop";
			return {};
		}
		return *soonest;
	}

	inline CampaignFight ended(CampaignFight fight, Outcome outcome) {
		fight.state.phase = Phase::Over;
		fight.state.outcome = outcome;
		return fight;
	}

	// The choice at the stop's event that needs and costs nothing, never turns into a fight, and gives and takes nothing:
	// its Drive on. A free choice can still give, as the tanker's siphon does, so freeness alone doesn't find it.
	inline std::string passingChoice(const Campaign& campaign, const Events& events = testEvents()) {
		const EventDefinition& event = stopEvent(campaign, events, testLayers());
		const auto			   passing = std::ranges::find_if(event.choices, [](const EventChoice& choice) {
			return isFree(choice) && std::ranges::all_of(choice.outcomes, [](const EventOutcome& outcome) {
					   return !outcome.fight.has_value() && outcome.gains == EventGains{};
				   });
		});
		EXPECT_NE(passing, event.choices.end()) << event.id.value << " has a way past that gives and takes nothing";
		return passing->id;
	}

	// On the road at the stop at `place`, the stops before it behind the run: fights broken off, finds left by the road,
	// and events passed by.
	inline Campaign at(const RouteChoice& choice, size_t place, Campaign campaign = loadedOut()) {
		depart(campaign, testLayers(), choice);
		while (campaign.run->route->next < static_cast<int>(place)) {
			switch (ahead(campaign, testLayers())) {
				case Ahead::Fight: {
					const CampaignFight fight = startRunFight(campaign, testContent(), testLayers()).fight;
					(void)endRunFight(campaign, testContent(), testRules(), testLayers(), ended(fight, Outcome::BrokenOff));
					break;
				}
				case Ahead::Event:
					(void)takeEventChoice(
						campaign,
						testContent(),
						testRules(),
						testEvents(),
						testLayers(),
						unlockedAtStart(testContent()),
						passingChoice(campaign)
					);
					break;
				case Ahead::Find:
					driveOn(campaign, testLayers());
					break;
				default:
					ADD_FAILURE() << "a run on its stops meets a fight, an event, or a find";
					return campaign;
			}
		}
		return campaign;
	}

} // namespace rules::campaigns
