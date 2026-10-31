#include "GenReport.h"

#include "Report.h"
#include "ReportText.h"

#include <format>
#include <ostream>
#include <string>

namespace sim {

	namespace {

		using Json = nlohmann::ordered_json;

		Json spreadJson(const Spread& spread) {
			Json counts = Json::object();
			for (const auto& [value, count] : spread.counts) {
				counts[std::to_string(value)] = count;
			}
			Json json;
			json["mean"] = numberJson(spread.mean);
			json["least"] = spread.least;
			json["most"] = spread.most;
			json["counts"] = std::move(counts);
			return json;
		}

		Json auditJson(const RouteAudit& route) {
			Json stops = Json::array();
			for (const rules::map::StopType type : route.stops) {
				stops.push_back(stopTypeName(type));
			}
			Json json;
			json["poi"] = route.poi;
			json["route"] = route.route;
			json["tier"] = route.tier;
			json["stronghold"] = route.stronghold;
			json["name"] = route.name;
			json["stops"] = std::move(stops);
			json["skulls"] = route.skulls;
			json["unresolved"] = route.unresolved;
			json["hours"] = route.hours;
			json["pastDark"] = route.pastDark;
			json["fuel"] = route.fuel;
			json["own"] = Json{
				{"legs", route.ownLegs},
				{"length", route.ownLength},
				{"stops", route.ownStops},
				{"fights", route.ownFights},
				{"room", route.ownRoom},
				{"lastLegAlone", route.ownIsLastLeg},
			};
			json["lastLeg"] = Json{{"length", route.lastLength}, {"stops", route.lastStops}, {"room", route.lastRoom}};
			json["neighbor"] = route.neighbor ? Json{
													{"poi", route.neighbor->poi},
													{"shared", route.neighbor->shared},
													{"route", route.neighborRoute ? Json(*route.neighborRoute) : Json(nullptr)},
													{"cleared", route.cleared},
													{"fightsLeft", route.fightsLeft},
												}
											  : Json(nullptr);
			return json;
		}

		Json mapJson(const MapAudit& map) {
			Json rings = Json::array();
			for (const rules::map::RingCount& ring : map.rings) {
				rings.push_back(Json{{"target", ring.target}, {"placed", ring.placed}, {"promoted", ring.promoted}});
			}
			Json routes = Json::array();
			for (const RouteAudit& route : map.routes) {
				routes.push_back(auditJson(route));
			}
			Json json;
			json["seed"] = map.seed;
			json["settled"] = map.settled;
			json["fingerprint"] = std::format("{:016x}", map.fingerprint);
			json["poiFailures"] = map.poiFailures;
			json["stopFailures"] = map.stopFailures;
			json["thinned"] = map.thinned;
			json["rings"] = std::move(rings);
			json["routes"] = std::move(routes);
			return json;
		}

		Json tierJson(const GenTierRow& row) {
			Json types = Json::object();
			for (const auto& [type, count] : row.types) {
				types[type] = count;
			}
			Json json;
			json["tier"] = row.tier;
			json["routes"] = row.routes;
			json["band"] = Json{
				{"stops", Json::array({row.fewestStops, row.mostStops})},
				{"fights", Json::array({row.fightFloor, row.fightCeiling})},
				{"ownNeed", row.ownNeed},
			};
			json["stops"] = spreadJson(row.stops);
			json["inBand"] = rateJson(row.inBand);
			json["belowBand"] = rateJson(row.belowBand);
			json["aboveBand"] = rateJson(row.aboveBand);
			json["fights"] = spreadJson(row.fights);
			json["noFight"] = rateJson(row.noFight);
			json["floorMet"] = rateJson(row.floorMet);
			json["types"] = std::move(types);
			json["unresolved"] = row.unresolved;
			json["skulls"] = spreadJson(row.skulls);
			json["hours"] = numberJson(row.hours);
			json["pastDark"] = rateJson(row.pastDark);
			json["ownShare"] = numberJson(row.ownShare);
			json["floorOnOwn"] = rateJson(row.floorOnOwn);
			json["halfBandOnOwn"] = rateJson(row.halfBandOnOwn);
			json["roomForBoth"] = rateJson(row.roomForBoth);
			json["ownIsLastLeg"] = rateJson(row.ownIsLastLeg);
			json["lastLegNoRoom"] = rateJson(row.lastLegNoRoom);
			json["neighborClears"] = numberJson(row.neighborClears);
			json["neighborTakesEveryFight"] = rateJson(row.neighborTakesEveryFight);
			return json;
		}

		std::string ranged(const Spread& spread) {
			return spread.mean ? std::format("{:.1f} ({}-{})", *spread.mean, spread.least, spread.most) : "-";
		}

		std::string counted(const Spread& spread) {
			std::string text;
			for (const auto& [value, count] : spread.counts) {
				text += std::format("{}{}:{}", text.empty() ? "" : " ", value, count);
			}
			return text;
		}

	} // namespace

	nlohmann::ordered_json genReportJson(const GenReport& report, std::span<const rules::PackManifest> packs) {
		Json json;
		json["mode"] = "gen";
		json["packs"] = packsJson(packs);
		json["config"] = Json(genConfigJson(report.config));
		Json maps = Json::array();
		for (const MapAudit& map : report.maps) {
			maps.push_back(mapJson(map));
		}
		json["maps"] = std::move(maps);
		Json tiers = Json::array();
		for (const GenTierRow& row : report.tiers) {
			tiers.push_back(tierJson(row));
		}
		json["tiers"] = std::move(tiers);
		Json rings = Json::array();
		for (const GenRingRow& row : report.rings) {
			rings.push_back(
				Json{
					{"ring", row.ring},
					{"target", row.target},
					{"placed", row.placed},
					{"promoted", row.promoted},
					{"perMap", spreadJson(row.perMap)},
				}
			);
		}
		json["rings"] = std::move(rings);
		Json unresolved = Json::object();
		for (const auto& [type, count] : report.unresolved) {
			unresolved[type] = count;
		}
		json["unresolved"] = std::move(unresolved);
		return json;
	}

	void printGenReport(std::ostream& out, const GenReport& report, std::span<const rules::PackManifest> packs) {
		int stopFailures = 0;
		int poiFailures = 0;
		int thinned = 0;
		int routes = 0;
		for (const MapAudit& map : report.maps) {
			stopFailures += static_cast<int>(map.stopFailures.size());
			poiFailures += static_cast<int>(map.poiFailures.size());
			thinned += map.thinned;
			routes += static_cast<int>(map.routes.size());
		}
		out << std::format(
			"gen: {} maps, {} routes, every route to every POI as a run reads it at game stage 0; packs {}\n",
			report.maps.size(),
			routes,
			packsText(packs)
		);
		for (const MapAudit& map : report.maps) {
			if (map.settled != map.seed) {
				out << std::format("  map {} settled on params seed {}, its own seed's attempts all failing\n", map.seed, map.settled);
			}
		}

		out << "\nstops and fights a route by destination tier, against the band at stage 0 (Runs and Encounters, How many stops); "
			   "tier 5 is the strongholds', which no run leaves for yet\n";
		out << std::format(
			"{:>4}{:>8}{:>7}{:>17}{:>8}{:>7}{:>7}{:>8}{:>16}{:>9}{:>8}{:>8}{:>7}  {}\n",
			"tier",
			"routes",
			"band",
			"stops (range)",
			"in",
			"below",
			"above",
			"floor",
			"fights (range)",
			"none",
			"met",
			"hours",
			"dark",
			"stops a route"
		);
		for (const GenTierRow& row : report.tiers) {
			out << std::format(
				"{:>4}{:>8}{:>7}{:>17}{:>8}{:>7}{:>7}{:>8}{:>16}{:>9}{:>8}{:>8}{:>7}  {}\n",
				row.tier,
				row.routes,
				std::format("{}-{}", row.fewestStops, row.mostStops),
				ranged(row.stops),
				percent(row.inBand),
				percent(row.belowBand),
				percent(row.aboveBand),
				std::format("{}-{}", row.fightFloor, row.fightCeiling),
				ranged(row.fights),
				percent(row.noFight),
				percent(row.floorMet),
				fixed(row.hours),
				percent(row.pastDark),
				counted(row.stops)
			);
		}

		out << "\nstop types by tier, a stop two routes share counted on each, and the fights' skulls\n";
		for (const GenTierRow& row : report.tiers) {
			int total = 0;
			for (const auto& [type, count] : row.types) {
				total += count;
			}
			std::string types;
			for (const auto& [type, count] : row.types) {
				types += std::format("{}{} {}", types.empty() ? "" : ", ", type, percent(share(count, total)));
			}
			out << std::format("{:>4}  {}  | skulls {}\n", row.tier, types, counted(row.skulls));
		}

		out << "\nown road (legs no other POI's routes use) and neighbors by tier: own share of a route's stops; routes whose own road "
			   "holds the fight floor, half the band's least stops, and has room for both; own road the last leg alone; last leg "
			   "with no room; the share of a route's stops its neighbor's run clears; and that run taking every fight, over routes "
			   "with one\n";
		out << std::format(
			"{:>4}{:>8}{:>11}{:>10}{:>11}{:>11}{:>12}{:>14}{:>17}{:>13}\n",
			"tier",
			"routes",
			"own share",
			"floor on",
			"half band",
			"room both",
			"last alone",
			"last no room",
			"neighbor clears",
			"takes every"
		);
		for (const GenTierRow& row : report.tiers) {
			out << std::format(
				"{:>4}{:>8}{:>11}{:>10}{:>11}{:>11}{:>12}{:>14}{:>17}{:>13}\n",
				row.tier,
				row.routes,
				percent(row.ownShare),
				percent(row.floorOnOwn),
				percent(row.halfBandOnOwn),
				percent(row.roomForBoth),
				percent(row.ownIsLastLeg),
				percent(row.lastLegNoRoom),
				percent(row.neighborClears),
				percent(row.neighborTakesEveryFight)
			);
		}

		out << "\nPOIs by ring, strongholds aside: aimed for and seated over every map, seated as tier 4 for daylight, and a map's "
			   "fewest and most\n";
		for (const GenRingRow& row : report.rings) {
			out << std::format(
				"  ring {}: {} aimed for, {} seated, {} as tier 4, {}-{} a map\n",
				row.ring,
				row.target,
				row.placed,
				row.promoted,
				row.perMap.least,
				row.perMap.most
			);
		}
		out << std::format(
			"\nthe stops stage's reported shortfalls {}, the POIs' {}, stops the daylight check thinned {}\n",
			stopFailures,
			poiFailures,
			thinned
		);
		if (report.unresolved.empty()) {
			out << "every stop placed is one a run resolves\n";
		} else {
			for (const auto& [type, count] : report.unresolved) {
				out << std::format("placed with no resolver: {} {}\n", type, count);
			}
		}
		out << std::format("\naudited in {:.1f} s on {} workers\n", report.seconds, report.workers);
	}

} // namespace sim
