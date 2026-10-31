#include "SupplyRun.h"

#include "CardOffers.h"
#include "RunDecks.h"

#include <rules/battle/Encounters.h>
#include <rules/map/StopContents.h>

#include <random/Rng.h>

#include <algorithm>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace rules::campaign {

	namespace {

		std::vector<map::RouteOffer> offersAt(const Campaign& campaign, const MapLayers& map, const map::MapToday& today) {
			std::vector<map::RouteOffer> offers = map::routeOffers({
				.network = map.network,
				.places = map.places,
				.pois = map.pois,
				.stops = map.stops,
				.biomeAt = map.biomeAt,
				.params = map.params,
				.content = map.content,
				.routes = map.routes,
				.today = today,
			});
			const std::vector<int>&		 cleared = campaign.mapState.clearedPois;
			std::erase_if(offers, [&](const map::RouteOffer& offer) { return std::ranges::binary_search(cleared, offer.destination.poi); });
			return offers;
		}

		map::RouteDescriptor routeOf(const MapLayers& map, const RouteChoice& choice) {
			if (choice.poi < 0 || static_cast<size_t>(choice.poi) >= map.pois.pois.size()) {
				throw std::invalid_argument("departBlocker: the map has no POI " + std::to_string(choice.poi));
			}
			std::vector<map::RouteDescriptor> routes = map::describeRoutes({
				.network = map.network,
				.routeLegs = map.pois.legs,
				.destination = choice.poi,
				.biomeAt = map.biomeAt,
				.tuning = map.routes,
			});
			if (choice.route < 0 || static_cast<size_t>(choice.route) >= routes.size()) {
				throw std::invalid_argument(
					"departBlocker: POI " + std::to_string(choice.poi) + " has no route " + std::to_string(choice.route)
				);
			}
			return std::move(routes[static_cast<size_t>(choice.route)]);
		}

		bool clearedNow(const MapState& state, int stop) {
			const auto found = std::ranges::find(state.stops, stop, &StopState::stop);
			return found != state.stops.end() && found->cleared.has_value();
		}

		int rollOf(const MapState& state, int stop) {
			const auto found = std::ranges::find(state.stops, stop, &StopState::stop);
			return found == state.stops.end() ? 0 : found->roll;
		}

		// The leg the run is on, by its place among the route's: the next stop's, or past the last, once at the POI.
		int legOn(const RunRoute& route, const MapLayers& map) {
			if (static_cast<size_t>(route.next) >= route.stops.size()) {
				return static_cast<int>(route.legs.size());
			}
			const int leg = map.stops.stops[static_cast<size_t>(route.stops[static_cast<size_t>(route.next)])].leg;
			return static_cast<int>(std::ranges::find(route.legs, leg) - route.legs.begin());
		}

		void passStop(RunRoute& route, const MapLayers& map) {
			++route.next;
			route.reward.clear();
			route.leg = legOn(route, map);
		}

		// The run's own stream for a stop, which everything drawn there forks from (call 406).
		foundation::Rng stopStream(const Campaign& campaign, int stop) {
			return foundation::Rng(campaign.seed).fork("run", *idNumber(campaign.run->id.value, kRunPrefix)).fork("stop", stop);
		}

		std::vector<CardId> rollReward(const Campaign& campaign, const Content& content, const CampaignRules& rules, int stop) {
			foundation::Rng stream = stopStream(campaign, stop).fork("reward");
			return rollCardOffers(stream, content, rules.compound.rewardCards, !campaign.convoy.empty());
		}

		// The run on the road at a stop, with no reward on offer unless `reward` asks for one.
		const RunRoute& atStop(const Campaign& campaign, std::string_view action, bool reward = false) {
			if (!campaign.run || !campaign.run->route) {
				throw std::invalid_argument(std::string(action) + ": no run is on the road");
			}
			const RunRoute& route = *campaign.run->route;
			if (static_cast<size_t>(route.next) >= route.stops.size()) {
				throw std::invalid_argument(std::string(action) + ": the run is past its last stop");
			}
			if (route.reward.empty() == reward) {
				throw std::invalid_argument(std::string(action) + (reward ? ": no reward is on offer" : ": a reward is on offer"));
			}
			return route;
		}

		const map::Stop& stopOf(const MapLayers& map, const RunRoute& route) {
			return map.stops.stops[static_cast<size_t>(route.stops[static_cast<size_t>(route.next)])];
		}

		Resources haulOf(const map::Haul& haul) {
			Resources resources;
			switch (haul.resource) {
				case map::Resource::Food:
					resources.food = haul.amount;
					break;
				case map::Resource::Water:
					resources.water = haul.amount;
					break;
				case map::Resource::Fuel:
					resources.fuel = haul.amount;
					break;
				case map::Resource::Meds:
					resources.meds = haul.amount;
					break;
				case map::Resource::Scrap:
					resources.scrap = haul.amount;
					break;
			}
			return resources;
		}

	} // namespace

	std::vector<map::RouteOffer> offersToday(const Campaign& campaign, const MapLayers& map) {
		return offersAt(campaign, map, mapToday(campaign));
	}

	std::optional<DepartBlocker> departBlocker(const Campaign& campaign, const MapLayers& map, const RouteChoice& choice) {
		const map::RouteDescriptor route = routeOf(map, choice);
		if (campaign.end) {
			return DepartBlocker{.reason = DepartRefusal::CampaignOver};
		}
		if (!campaign.run) {
			return DepartBlocker{.reason = DepartRefusal::NoLoadOut};
		}
		if (campaign.run->route) {
			return DepartBlocker{.reason = DepartRefusal::Gone};
		}
		if (std::ranges::binary_search(campaign.mapState.clearedPois, choice.poi)) {
			return DepartBlocker{.reason = DepartRefusal::Cleared};
		}
		if (campaign.stores.fuel < route.fuel) {
			return DepartBlocker{.reason = DepartRefusal::Fuel, .fuel = route.fuel};
		}
		return std::nullopt;
	}

	void depart(Campaign& campaign, const MapLayers& map, const RouteChoice& choice) {
		if (departBlocker(campaign, map, choice)) {
			throw std::invalid_argument("depart: the run can't leave on that route");
		}
		map::RouteDescriptor route = routeOf(map, choice);
		Run&				 run = *campaign.run;
		RunRoute			 leaving{
						.poi = choice.poi,
						.route = choice.route,
						.tier = map.pois.pois[static_cast<size_t>(choice.poi)].tier,
						.legs = std::move(route.legs),
						.stops = {},
						.leg = 0,
						.next = 0,
						.reward = {},
		};
		for (const int leg : leaving.legs) {
			for (const int stop : map::stopsAtStage(map.stops.legs[static_cast<size_t>(leg)], map.stops, run.stage)) {
				if (!clearedNow(campaign.mapState, stop)) {
					leaving.stops.push_back(stop);
				}
			}
		}
		leaving.leg = legOn(leaving, map);
		campaign.stores.fuel -= route.fuel;
		run.route = std::move(leaving);
	}

	std::optional<int> stopAhead(const Campaign& campaign) {
		if (!campaign.run || !campaign.run->route) {
			return std::nullopt;
		}
		const RunRoute& route = *campaign.run->route;
		if (static_cast<size_t>(route.next) >= route.stops.size()) {
			return std::nullopt;
		}
		return route.stops[static_cast<size_t>(route.next)];
	}

	CampaignFightStart startStopFight(const Campaign& campaign, const Content& content, const MapLayers& map) {
		const RunRoute&	 route = atStop(campaign, "startStopFight");
		const map::Stop& stop = stopOf(map, route);
		if (!map::isFight(stop.type)) {
			throw std::invalid_argument("startStopFight: the stop the run is at isn't a fight");
		}
		const int		  id = route.stops[static_cast<size_t>(route.next)];
		const EncounterId encounter = pickEncounter(content, stop.skulls, route.tier, stopStream(campaign, id).seed());
		return startCampaignFight(campaign, content, encounter);
	}

	FightWriteBack
	endStopFight(Campaign& campaign, const Content& content, const CampaignRules& rules, const MapLayers& map, const CampaignFight& fight) {
		const RunRoute& route = atStop(campaign, "endStopFight");
		if (!map::isFight(stopOf(map, route).type)) {
			// Checked before the write-back, so a fight from anywhere else changes nothing.
			throw std::invalid_argument("endStopFight: the stop the run is at isn't a fight");
		}
		const int	   stop = route.stops[static_cast<size_t>(route.next)];
		FightWriteBack written = writeBackFight(campaign, content, rules, fight);
		if (written.outcome == Outcome::Lost) {
			return written;
		}
		RunRoute& onward = *campaign.run->route;
		if (written.outcome == Outcome::Won) {
			onward.reward = rollReward(campaign, content, rules, stop);
		} else {
			passStop(onward, map);
		}
		return written;
	}

	TakenFind takeFind(
		Campaign&					 campaign,
		const Content&				 content,
		const CampaignRules&		 rules,
		const MapLayers&			 map,
		const std::vector<DriverId>& unlocked
	) {
		(void)atStop(campaign, "takeFind");
		RunRoute&		 route = *campaign.run->route;
		const map::Stop& stop = stopOf(map, route);
		const int		 id = route.stops[static_cast<size_t>(route.next)];
		TakenFind		 taken;
		switch (stop.type) {
			case map::StopType::FindSupplies: {
				taken.haul = map::rollStop(map.stops, id, rollOf(campaign.mapState, id), map.content.stops).supplies;
				campaign.run->cargo = campaign.run->cargo + haulOf(*taken.haul);
				passStop(route, map);
				break;
			}
			case map::StopType::FindDriver: {
				taken.driver = whoIsFound(campaign, content, unlocked, stopStream(campaign, id).fork("driver").nextUInt32());
				takeFoundDriver(campaign, content, *taken.driver);
				passStop(route, map);
				break;
			}
			case map::StopType::FindCards:
				taken.reward = rollReward(campaign, content, rules, id);
				route.reward = taken.reward;
				break;
			default:
				throw std::invalid_argument("takeFind: the stop the run is at isn't a find");
		}
		return taken;
	}

	void takeReward(Campaign& campaign, const Content& content, const MapLayers& map, const std::optional<CardId>& card) {
		(void)atStop(campaign, "takeReward", true);
		if (card) {
			const std::vector<CardId>& reward = campaign.run->route->reward;
			if (std::ranges::find(reward, *card) == reward.end()) {
				throw std::invalid_argument("takeReward: " + card->value + " isn't on offer");
			}
			addCardsWon(campaign, content, {{*card, 1}});
		}
		passStop(*campaign.run->route, map);
	}

	void driveOn(Campaign& campaign, const MapLayers& map) {
		(void)atStop(campaign, "driveOn");
		RunRoute& route = *campaign.run->route;
		if (map::isFight(stopOf(map, route).type)) {
			throw std::invalid_argument("driveOn: the run is at a fight, which only fighting gets past");
		}
		passStop(route, map);
	}

} // namespace rules::campaign
