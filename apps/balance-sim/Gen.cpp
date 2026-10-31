#include "Gen.h"

#include "ConfigFields.h"
#include "Workers.h"

#include <rules/campaign/Founding.h>
#include <rules/campaign/SupplyRun.h>
#include <rules/core/JsonReader.h>
#include <rules/map/RouteLegs.h>
#include <rules/map/StopRoom.h>
#include <rules/map/Stops.h>

#include <algorithm>
#include <chrono>
#include <set>

namespace sim {

	using namespace rules;
	using namespace rules::campaign;

	namespace {

		// The baseline the TypeScript's gen measured over.
		constexpr int kGenMaps = 30;

		bool isFightAt(const MapLayers& layers, int stop) {
			return map::isFight(layers.stops.stops[static_cast<size_t>(stop)].type);
		}

		RouteAudit auditRoute(
			const MapLayers&				  layers,
			const map::RouteOffer&			  offer,
			std::span<const map::RouteOffer>  offers,
			const std::map<int, Neighbor>&	  nearest,
			std::span<const int>			  owners,
			std::span<const std::vector<int>> room,
			std::span<const int>			  degrees
		) {
			const int			   poi = offer.destination.poi;
			const map::StopTuning& tuning = layers.content.stops;
			RouteAudit			   audit{
							.poi = poi,
							.route = offer.route.route,
							.tier = offer.destination.tier,
							.stronghold = offer.destination.stronghold,
							.name = offer.route.name,
							.hours = offer.outlook.hours.out + offer.outlook.hours.objective + offer.outlook.hours.home,
							.pastDark = offer.outlook.spare < 0,
							.fuel = offer.route.fuel,
							.ownRoom = room[static_cast<size_t>(poi)][static_cast<size_t>(offer.route.route)],
			};
			const std::vector<int> met = stopsMet(layers, offer.route.legs, 0);
			for (const int stop : met) {
				const map::Stop& placed = layers.stops.stops[static_cast<size_t>(stop)];
				audit.stops.push_back(placed.type);
				if (map::isFight(placed.type)) {
					audit.skulls.push_back(placed.skulls);
				}
				audit.unresolved += map::isResolvable(placed.type) ? 0 : 1;
			}
			std::vector<int> own;
			for (const int leg : offer.route.legs) {
				if (owners[static_cast<size_t>(leg)] == poi) {
					own.push_back(leg);
					audit.ownLength += layers.pois.legs.legs[static_cast<size_t>(leg)].length;
				}
			}
			audit.ownLegs = static_cast<int>(own.size());
			for (const int stop : stopsMet(layers, own, 0)) {
				++audit.ownStops;
				audit.ownFights += isFightAt(layers, stop) ? 1 : 0;
			}
			const int		last = offer.route.legs.back();
			const map::Leg& lastLeg = layers.pois.legs.legs[static_cast<size_t>(last)];
			audit.ownIsLastLeg = own == std::vector{last};
			audit.lastLength = lastLeg.length;
			audit.lastStops = static_cast<int>(stopsMet(layers, std::span(&last, 1), 0).size());
			audit.lastRoom = map::legRoom(lastLeg.length, map::junctionsAlong(layers.network, lastLeg, degrees), tuning.tightGap, tuning);

			if (const auto near = nearest.find(poi); near != nearest.end()) {
				audit.neighbor = near->second;
				if (const std::optional<NeighborRun> run = neighborRun(layers, offers, near->second.poi, met, 0)) {
					audit.neighborRoute = run->route;
					for (const int stop : met) {
						const bool cleared = std::ranges::find(run->cleared, stop) != run->cleared.end();
						audit.cleared += cleared ? 1 : 0;
						audit.fightsLeft += !cleared && isFightAt(layers, stop) ? 1 : 0;
					}
				} else {
					audit.fightsLeft = audit.fights();
				}
			}
			return audit;
		}

		GenTierRow tierRow(int tier, std::span<const RouteAudit* const> routes, const map::StopTuning& tuning) {
			const map::StopBand& band = map::bandFor(tier, tuning);
			const int			 halfBand = (band.stops.min + 1) / 2;
			GenTierRow			 row{
						  .tier = tier,
						  .routes = static_cast<int>(routes.size()),
						  .fewestStops = band.stops.min,
						  .mostStops = band.stops.max,
						  .fightFloor = band.fights.min,
						  .fightCeiling = band.fights.max,
						  .ownNeed = map::ownRoadNeed(tier, tuning),
			  };
			const auto every = [](const RouteAudit*) {
				return true;
			};
			const auto stopsOf = [](const RouteAudit* route) {
				return static_cast<int>(route->stops.size());
			};
			std::vector<int> stops;
			std::vector<int> fights;
			std::vector<int> skulls;
			for (const RouteAudit* route : routes) {
				stops.push_back(stopsOf(route));
				fights.push_back(route->fights());
				skulls.insert(skulls.end(), route->skulls.begin(), route->skulls.end());
				row.unresolved += route->unresolved;
				for (const map::StopType type : route->stops) {
					++row.types[stopTypeName(type)];
				}
			}
			row.stops = spreadOf(stops);
			row.fights = spreadOf(fights);
			row.skulls = spreadOf(skulls);
			row.inBand = rateWhere(routes, every, [&](const RouteAudit* route) {
				return stopsOf(route) >= band.stops.min && stopsOf(route) <= band.stops.max;
			});
			row.belowBand = rateWhere(routes, every, [&](const RouteAudit* route) { return stopsOf(route) < band.stops.min; });
			row.aboveBand = rateWhere(routes, every, [&](const RouteAudit* route) { return stopsOf(route) > band.stops.max; });
			row.noFight = rateWhere(routes, every, [](const RouteAudit* route) { return route->fights() == 0; });
			row.floorMet = rateWhere(routes, every, [&](const RouteAudit* route) { return route->fights() >= band.fights.min; });
			row.hours = meanWhere(routes, every, [](const RouteAudit* route) { return route->hours; });
			row.pastDark = rateWhere(routes, every, [](const RouteAudit* route) { return route->pastDark; });
			const auto withStops = [&](const RouteAudit* route) {
				return stopsOf(route) > 0;
			};
			row.ownShare = meanWhere(routes, withStops, [&](const RouteAudit* route) { return share(route->ownStops, stopsOf(route)); });
			row.floorOnOwn = rateWhere(routes, every, [&](const RouteAudit* route) { return route->ownFights >= band.fights.min; });
			row.halfBandOnOwn = rateWhere(routes, every, [&](const RouteAudit* route) { return route->ownStops >= halfBand; });
			row.roomForBoth = rateWhere(routes, every, [&](const RouteAudit* route) { return route->ownRoom >= row.ownNeed; });
			row.ownIsLastLeg = rateWhere(routes, every, [](const RouteAudit* route) { return route->ownIsLastLeg; });
			row.lastLegNoRoom = rateWhere(routes, every, [](const RouteAudit* route) { return route->lastRoom == 0; });
			row.neighborClears = meanWhere(
				routes,
				[&](const RouteAudit* route) { return withStops(route) && route->neighbor.has_value(); },
				[&](const RouteAudit* route) { return share(route->cleared, stopsOf(route)); }
			);
			row.neighborTakesEveryFight = rateWhere(
				routes,
				[](const RouteAudit* route) { return route->fights() > 0; },
				[](const RouteAudit* route) { return route->neighbor.has_value() && route->fightsLeft == 0; }
			);
			return row;
		}

	} // namespace

	GenConfig readGenConfig(const nlohmann::json& config, const std::string& where) {
		JsonReader reader(config, where);
		GenConfig  read{.maps = readMaps(reader, kGenMaps)};
		reader.finish();
		return read;
	}

	nlohmann::json genConfigJson(const GenConfig& config) {
		return nlohmann::json{{"maps", config.maps}};
	}

	MapAudit auditMap(const SimRules& shared, const RunMap& map) {
		const MapLayers& layers = map.layers;
		const Campaign	 founded = foundCampaign(shared.content, shared.campaign, Founding{.map = map.origin, .unlocked = shared.unlocked});
		const std::vector<map::RouteOffer>	 offers = offersToday(founded, layers);
		std::vector<std::vector<map::Route>> routes;
		for (size_t poi = 0; poi < layers.pois.pois.size(); ++poi) {
			routes.push_back(map::routesTo(layers.pois.legs, static_cast<int>(poi)));
		}
		const std::vector<int>				degrees = map::nodeDegrees(layers.network);
		const std::vector<int>				owners = map::legOwners(layers.pois.legs.legs.size(), routes);
		const std::vector<std::vector<int>> room =
			map::ownRoadRoom(layers.network, layers.pois.legs.legs, routes, degrees, layers.content.stops);
		const std::map<int, Neighbor> nearest = nearestNeighbors(offers);

		MapAudit audit{
			.seed = map.seed,
			.settled = map.origin.params.seed,
			.fingerprint = map.origin.fingerprint,
			.poiFailures = layers.pois.failures,
			.stopFailures = layers.stops.failures,
			.thinned = layers.stops.thinned,
			.rings = layers.pois.rings,
		};
		for (const map::RouteOffer& offer : offers) {
			audit.routes.push_back(auditRoute(layers, offer, offers, nearest, owners, room, degrees));
		}
		return audit;
	}

	GenReport auditMaps(const GenConfig& config, const SimRules& shared, std::span<const RunMap> maps, int workers) {
		GenReport  report{.config = config, .workers = workers};
		const auto started = std::chrono::steady_clock::now();
		report.maps.resize(maps.size());
		inParallel(maps.size(), workers, [&](size_t begin, size_t end) {
			for (size_t index = begin; index < end; ++index) {
				report.maps[index] = auditMap(shared, maps[index]);
			}
		});
		report.seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();

		std::set<int> tiers;
		for (const MapAudit& map : report.maps) {
			for (const RouteAudit& route : map.routes) {
				tiers.insert(route.tier);
				for (const map::StopType type : route.stops) {
					if (!map::isResolvable(type)) {
						++report.unresolved[stopTypeName(type)];
					}
				}
			}
		}
		if (maps.empty()) {
			return report;
		}
		const map::StopTuning& tuning = maps.front().layers.content.stops;
		for (const int tier : tiers) {
			std::vector<const RouteAudit*> routes;
			for (const MapAudit& map : report.maps) {
				for (const RouteAudit& route : map.routes) {
					if (route.tier == tier) {
						routes.push_back(&route);
					}
				}
			}
			report.tiers.push_back(tierRow(tier, routes, tuning));
		}

		size_t rings = 0;
		for (const MapAudit& map : report.maps) {
			rings = std::max(rings, map.rings.size());
		}
		for (size_t ring = 0; ring < rings; ++ring) {
			GenRingRow		 row{.ring = static_cast<int>(ring)};
			std::vector<int> perMap;
			for (const MapAudit& map : report.maps) {
				const map::RingCount count = ring < map.rings.size() ? map.rings[ring] : map::RingCount{};
				row.target += count.target;
				row.placed += count.placed;
				row.promoted += count.promoted;
				perMap.push_back(count.placed);
			}
			row.perMap = spreadOf(perMap);
			report.rings.push_back(row);
		}
		return report;
	}

} // namespace sim
