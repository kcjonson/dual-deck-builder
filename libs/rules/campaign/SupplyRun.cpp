#include "SupplyRun.h"

#include "EventStops.h"
#include "Events.h"
#include "RunDecks.h"
#include "RunProgress.h"

#include <rules/battle/Encounters.h>
#include <rules/map/StopContents.h>

#include <random/Rng.h>

#include <algorithm>
#include <array>
#include <cassert>
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

		bool isFind(map::StopType type) {
			return type == map::StopType::FindDriver || type == map::StopType::FindCards || type == map::StopType::FindSupplies;
		}

		// The route of a run at a stop, with nothing on offer there and no fight an event turned into waiting.
		const RunRoute& atStop(const Campaign& campaign, std::string_view action) {
			const RunRoute& route = routeOnRoad(campaign, action);
			if (static_cast<size_t>(route.next) >= route.stops.size()) {
				throw std::invalid_argument(std::string(action) + ": the run is past its last stop");
			}
			if (!route.reward.empty()) {
				throw std::invalid_argument(std::string(action) + ": a reward is on offer");
			}
			if (route.handOff) {
				throw std::invalid_argument(std::string(action) + ": the fight an event turned into waits");
			}
			return route;
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

		// The route's risk as it left: the most skulls among the fights it meets, and 1 with none (call 13).
		int riskOf(const RunRoute& route, const MapLayers& map) {
			int risk = 1;
			for (const int stop : route.stops) {
				const map::Stop& met = mapStop(map, stop);
				if (map::isFight(met.type)) {
					risk = std::max(risk, met.skulls);
				}
			}
			return risk;
		}

		enum class FightKind { Stop, HandOff, Return };

		// The fight the run is at, its skulls, and the stream it draws on there.
		struct FightAhead {
			FightKind		kind{FightKind::Stop};
			int				skulls{1};
			foundation::Rng stream;
		};

		FightAhead fightAhead(const Campaign& campaign, const MapLayers& map, std::string_view action) {
			const RunRoute& route = routeOnRoad(campaign, action);
			if (route.reward.empty()) {
				if (static_cast<size_t>(route.next) < route.stops.size()) {
					const int stop = stopAt(route);
					if (route.handOff) {
						return FightAhead{
							.kind = FightKind::HandOff, .skulls = route.handOff->skulls, .stream = stopStream(campaign, stop)
						};
					}
					const map::Stop& met = mapStop(map, stop);
					if (map::isFight(met.type)) {
						return FightAhead{.kind = FightKind::Stop, .skulls = met.skulls, .stream = stopStream(campaign, stop)};
					}
				} else if (route.ambush) {
					return FightAhead{.kind = FightKind::Return, .skulls = riskOf(route, map), .stream = returnStream(campaign)};
				}
			}
			throw std::invalid_argument(std::string(action) + ": the run isn't at a fight, or has its reward on offer");
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
		if (map.pois.pois[static_cast<size_t>(choice.poi)].type == map::kStrongholdType) {
			return DepartBlocker{.reason = DepartRefusal::Stronghold};
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
						.handOff = std::nullopt,
						.objective = false,
						.ambush = false,
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
		return stopAt(route);
	}

	Ahead ahead(const Campaign& campaign, const MapLayers& map) {
		const RunRoute& route = routeOnRoad(campaign, "ahead");
		if (!route.reward.empty()) {
			return Ahead::Reward;
		}
		if (static_cast<size_t>(route.next) < route.stops.size()) {
			const map::StopType type = mapStop(map, stopAt(route)).type;
			if (route.handOff || map::isFight(type)) {
				return Ahead::Fight;
			}
			if (resolvesAsEvent(type)) {
				return Ahead::Event;
			}
			if (isFind(type)) {
				return Ahead::Find;
			}
			throw std::logic_error("ahead: the map placed a stop the run can't resolve");
		}
		if (!route.objective) {
			return Ahead::Objective;
		}
		return route.ambush ? Ahead::Fight : Ahead::Home;
	}

	CampaignFightStart startRunFight(const Campaign& campaign, const Content& content, const MapLayers& map) {
		const FightAhead  fight = fightAhead(campaign, map, "startRunFight");
		const EncounterId encounter = pickEncounter(content, fight.skulls, campaign.run->route->tier, fight.stream.seed());
		return startCampaignFight(campaign, content, encounter);
	}

	FightWriteBack
	endRunFight(Campaign& campaign, const Content& content, const CampaignRules& rules, const MapLayers& map, const CampaignFight& fight) {
		// Checked before the write-back, so a fight from anywhere else changes nothing.
		const FightAhead				  at = fightAhead(campaign, map, "endRunFight");
		const std::optional<EventHandOff> handOff = campaign.run->route->handOff;
		FightWriteBack					  written = writeBackFight(campaign, content, rules, fight);
		if (written.outcome == Outcome::Lost) {
			return written;
		}
		const bool won = written.outcome == Outcome::Won;
		RunRoute&  onward = *campaign.run->route;
		switch (at.kind) {
			case FightKind::Return:
				onward.ambush = false;
				break;
			case FightKind::HandOff:
				onward.handOff.reset();
				if (won) {
					giveHandOff(campaign, content, *handOff);
				}
				break;
			case FightKind::Stop:
				break;
		}
		if (won) {
			onward.reward = rollReward(at.stream, campaign, content, rules);
		} else if (at.kind != FightKind::Return) {
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
		const int		 id = stopAt(route);
		const map::Stop& stop = mapStop(map, id);
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
				taken.reward = rollReward(stopStream(campaign, id), campaign, content, rules);
				route.reward = taken.reward;
				break;
			default:
				throw std::invalid_argument("takeFind: the stop the run is at isn't a find");
		}
		return taken;
	}

	void takeReward(Campaign& campaign, const Content& content, const MapLayers& map, const std::optional<CardId>& card) {
		const RunRoute& route = routeOnRoad(campaign, "takeReward");
		if (route.reward.empty()) {
			throw std::invalid_argument("takeReward: no reward is on offer");
		}
		if (card) {
			if (std::ranges::find(route.reward, *card) == route.reward.end()) {
				throw std::invalid_argument("takeReward: " + card->value + " isn't on offer");
			}
			addCardsWon(campaign, content, {{*card, 1}});
		}
		RunRoute& onward = *campaign.run->route;
		if (static_cast<size_t>(onward.next) < onward.stops.size()) {
			passStop(onward, map);
		} else {
			onward.reward.clear();
		}
	}

	void driveOn(Campaign& campaign, const MapLayers& map) {
		const map::StopType type = mapStop(map, stopAt(atStop(campaign, "driveOn"))).type;
		if (map::isFight(type)) {
			throw std::invalid_argument("driveOn: the run is at a fight, which only fighting gets past");
		}
		if (resolvesAsEvent(type)) {
			throw std::invalid_argument("driveOn: the run is at an event, which only one of its choices gets past");
		}
		passStop(*campaign.run->route, map);
	}

	ObjectiveTaken takeObjective(Campaign& campaign, const CampaignRules& rules, const MapLayers& map) {
		const RunRoute& route = routeOnRoad(campaign, "takeObjective");
		if (static_cast<size_t>(route.next) < route.stops.size()) {
			throw std::invalid_argument("takeObjective: the run hasn't reached its POI");
		}
		if (route.objective) {
			throw std::invalid_argument("takeObjective: the run has taken its objective");
		}
		const map::Poi& poi = map.pois.pois[static_cast<size_t>(route.poi)];
		assert(poi.type != map::kStrongholdType && "takeObjective: no run leaves for a stronghold (departBlocker)");
		const std::array<int, 5>& yields = map.content.pois.types.at(poi.type).yields;
		const auto				  yieldOf = [&](map::Resource resource) {
			   return yields[static_cast<size_t>(resource)];
		};
		Run&		   run = *campaign.run;
		ObjectiveTaken taken{
			.yields =
				{
					.food = yieldOf(map::Resource::Food),
					.water = yieldOf(map::Resource::Water),
					.fuel = yieldOf(map::Resource::Fuel),
					.meds = yieldOf(map::Resource::Meds),
					.scrap = yieldOf(map::Resource::Scrap),
					.people = 0,
				},
			.ambush = false,
		};
		run.cargo = run.cargo + taken.yields;
		foundation::Rng roll = returnStream(campaign).fork("ambush");
		taken.ambush = roll.nextInt(0, 99) < rules.compound.returnAmbush[static_cast<size_t>(run.stage)];
		run.route->objective = true;
		run.route->ambush = taken.ambush;
		return taken;
	}

} // namespace rules::campaign
