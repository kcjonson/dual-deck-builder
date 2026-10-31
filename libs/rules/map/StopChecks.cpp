#include "StopChecks.h"

#include "StopRoom.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <set>
#include <string_view>
#include <utility>

namespace rules::map {

	namespace {

		// Slack for a clearance or a share, which arithmetic can miss by a rounding.
		constexpr double kSlack = 1e-9;

		std::string_view nameOf(StopRule rule) {
			for (const auto& [name, each] : kStopRuleNames) {
				if (each == rule) {
					return name;
				}
			}
			return {};
		}

		std::string written(double value) {
			std::string text = std::to_string(value);
			text.erase(text.find_last_not_of('0') + 1);
			if (text.back() == '.') {
				text.pop_back();
			}
			return text;
		}

		class StopChecker {
		  public:
			explicit StopChecker(const StopCheckArgs& checking)
				: args(checking),
				  legs(checking.pois.legs.legs),
				  layer(checking.stops) {}

			std::vector<StopViolation> check() {
				if (!checkPlacement()) {
					return found;
				}
				checkClearance();
				std::vector<std::vector<Route>> routes;
				for (size_t poi = 0; poi < args.pois.pois.size(); ++poi) {
					routes.push_back(routesTo(args.pois.legs, static_cast<int>(poi)));
				}
				const std::vector<int> owners = legOwners(legs.size(), routes);
				checkExtras();
				for (size_t poi = 0; poi < routes.size(); ++poi) {
					checkRoutes(static_cast<int>(poi), routes[poi], owners);
					checkDaylight(static_cast<int>(poi), routes[poi]);
				}
				checkFinds();
				return std::move(found);
			}

		  private:
			const StopCheckArgs&	   args;
			const std::vector<Leg>&	   legs;
			const StopLayer&		   layer;
			std::vector<StopViolation> found;

			void report(StopRule rule, std::string detail) { found.push_back({.rule = rule, .detail = std::move(detail)}); }

			// False where the layer doesn't hang together well enough to read routes off it.
			bool checkPlacement() {
				if (layer.legs.size() != legs.size()) {
					report(
						StopRule::Placement,
						std::to_string(layer.legs.size()) + " legs of stops for " + std::to_string(legs.size()) + " legs"
					);
					return false;
				}
				bool				   whole = true;
				const std::vector<int> tiers = legTiers(args.pois);
				const auto			   territories = args.tables.territories();
				std::vector<int>	   listed(layer.stops.size());
				for (size_t leg = 0; leg < legs.size(); ++leg) {
					const LegStops& held = layer.legs[leg];
					if (held.tier != tiers[leg]) {
						report(
							StopRule::Placement,
							"leg " + std::to_string(leg) + " is tier " + std::to_string(held.tier) + ", where its routes' lowest is " +
								std::to_string(tiers[leg])
						);
					}
					if (std::ranges::find(territories, held.territory) == territories.end()) {
						report(
							StopRule::Placement,
							"leg " + std::to_string(leg) + " is in territory \"" + held.territory + "\", which the stop tables don't have"
						);
					}
					for (const auto& [ids, extra] : {std::pair{&held.stops, false}, std::pair{&held.extras, true}}) {
						for (const int id : *ids) {
							if (id < 0 || std::cmp_greater_equal(id, layer.stops.size())) {
								report(
									StopRule::Placement,
									"leg " + std::to_string(leg) + " lists stop " + std::to_string(id) + ", which the layer doesn't have"
								);
								whole = false;
								continue;
							}
							listed[static_cast<size_t>(id)] += 1;
							const Stop& stop = layer.stops[static_cast<size_t>(id)];
							if (stop.leg != static_cast<int>(leg) || (stop.stage > 0) != extra) {
								report(
									StopRule::Placement,
									"leg " + std::to_string(leg) + " lists stop " + std::to_string(id) + " among its " +
										(extra ? "extras" : "stops") + ", which is on leg " + std::to_string(stop.leg) +
										" from game stage " + std::to_string(stop.stage)
								);
							}
						}
					}
				}
				for (size_t id = 0; id < layer.stops.size(); ++id) {
					const Stop&		  stop = layer.stops[id];
					const std::string what = "stop " + std::to_string(id);
					if (listed[id] != 1) {
						report(StopRule::Placement, what + " is listed " + std::to_string(listed[id]) + " times");
					}
					if (stop.leg < 0 || std::cmp_greater_equal(stop.leg, legs.size())) {
						report(StopRule::Placement, what + " is on leg " + std::to_string(stop.leg) + ", which the map doesn't have");
						whole = false;
						continue;
					}
					const double length = legs[static_cast<size_t>(stop.leg)].length;
					if (!(stop.along > 0 && stop.along < length)) {
						report(StopRule::Placement, what + " is " + written(stop.along) + " along a leg " + written(length) + " long");
					}
					if (std::abs(stop.at * length - stop.along) > 1e-6 * (1 + length)) {
						report(
							StopRule::Placement,
							what + "'s share " + written(stop.at) + " isn't " + written(stop.along) + " of " + written(length)
						);
					}
					if (!isResolvable(stop.type)) {
						report(StopRule::Placement, what + " is a type the run can't resolve");
					}
					if (isFight(stop.type) ? stop.skulls < 1 || stop.skulls > 3 : stop.skulls != 0) {
						report(StopRule::Placement, what + " has " + std::to_string(stop.skulls) + " skulls");
					}
					if (id > 0) {
						const Stop& before = layer.stops[id - 1];
						if (before.leg > stop.leg || (before.leg == stop.leg && !(before.along < stop.along))) {
							report(
								StopRule::Placement, what + " isn't after stop " + std::to_string(id - 1) + ", leg by leg in driving order"
							);
						}
					}
				}
				return whole;
			}

			void checkClearance() {
				const std::vector<int> degrees = nodeDegrees(args.network);
				const double		   clear = args.tuning.clearance.junctions;
				for (size_t leg = 0; leg < legs.size(); ++leg) {
					std::vector<int> ids = layer.legs[leg].stops;
					ids.insert(ids.end(), layer.legs[leg].extras.begin(), layer.legs[leg].extras.end());
					std::ranges::sort(ids);
					if (ids.empty()) {
						continue;
					}
					const double			  length = legs[leg].length;
					const double			  ends = legEnds(length, args.tuning);
					const std::vector<double> joins = junctionsAlong(args.network, legs[leg], degrees);
					for (size_t place = 0; place < ids.size(); ++place) {
						const double	  along = layer.stops[static_cast<size_t>(ids[place])].along;
						const std::string what = "stop " + std::to_string(ids[place]);
						if (along < ends - kSlack || along > length - ends + kSlack) {
							report(
								StopRule::Clearance,
								what + " is " + written(along) + " along leg " + std::to_string(leg) + ", inside its " + written(ends) +
									" from an end"
							);
						}
						for (const double join : joins) {
							if (std::abs(along - join) < clear - kSlack) {
								report(
									StopRule::Clearance,
									what + " is " + written(std::abs(along - join)) + " from a junction on leg " + std::to_string(leg)
								);
							}
						}
						if (place > 0) {
							const double apart = along - layer.stops[static_cast<size_t>(ids[place - 1])].along;
							if (apart < args.tuning.tightGap - kSlack) {
								report(
									StopRule::Clearance,
									what + " is " + written(apart) + " past the stop before it on leg " + std::to_string(leg)
								);
							}
						}
					}
				}
			}

			void checkExtras() {
				std::set<int> lastLegs;
				for (const std::vector<int>& last : args.pois.legs.lastLegs) {
					lastLegs.insert(last.begin(), last.end());
				}
				for (size_t leg = 0; leg < legs.size(); ++leg) {
					for (const int id : layer.legs[leg].extras) {
						const Stop&		  stop = layer.stops[static_cast<size_t>(id)];
						const std::string what = "stop " + std::to_string(id) + ", a dormant extra,";
						if (!isCalm(stop.type)) {
							report(StopRule::Extras, what + " isn't calm");
						}
						if (std::ranges::find(args.tuning.extras, stop.stage) == args.tuning.extras.end()) {
							report(
								StopRule::Extras,
								what + " turns on at game stage " + std::to_string(stop.stage) + ", which the tuning doesn't have"
							);
						}
						if (!lastLegs.contains(static_cast<int>(leg))) {
							report(StopRule::Extras, what + " is on leg " + std::to_string(leg) + ", no route's own last leg");
						}
					}
				}
			}

			void checkRoutes(int poi, const std::vector<Route>& routes, const std::vector<int>& owners) {
				const StopBand& band = bandFor(args.pois.pois[static_cast<size_t>(poi)].tier, args.tuning);
				for (size_t place = 0; place < routes.size(); ++place) {
					const std::string	  where = "poi " + std::to_string(poi) + " route " + std::to_string(place);
					std::vector<StopType> types;
					int					  fights = 0;
					int					  ownStops = 0;
					int					  ownFights = 0;
					for (const int leg : routes[place].legs) {
						const bool own = owners[static_cast<size_t>(leg)] == poi;
						for (const int id : layer.legs[static_cast<size_t>(leg)].stops) {
							const StopType type = layer.stops[static_cast<size_t>(id)].type;
							types.push_back(type);
							fights += isFight(type) ? 1 : 0;
							ownStops += own ? 1 : 0;
							ownFights += own && isFight(type) ? 1 : 0;
						}
					}
					for (size_t at = 2; at < types.size(); ++at) {
						const std::span<const StopType> window(types.begin() + static_cast<std::ptrdiff_t>(at) - 2, 3);
						const std::string				stops = ": stops " + std::to_string(at - 2) + " to " + std::to_string(at);
						if (std::ranges::all_of(window, isFight)) {
							report(StopRule::Fights, where + stops + " are all fights");
						}
						if (std::ranges::none_of(window, isCalm)) {
							report(StopRule::Calm, where + stops + " hold no non-fight");
						}
					}
					if (fights < band.fights.min) {
						report(
							StopRule::Floor,
							where + ": " + std::to_string(fights) + " fights, under its floor of " + std::to_string(band.fights.min)
						);
					} else if (ownFights < band.fights.min) {
						report(
							StopRule::Floor,
							where + ": " + std::to_string(ownFights) + " fights on its own road, under its floor of " +
								std::to_string(band.fights.min)
						);
					}
					if (fights > band.fights.max) {
						report(
							StopRule::FightBand,
							where + ": " + std::to_string(fights) + " fights, over its band's " + std::to_string(band.fights.max)
						);
					}
					const auto count = static_cast<int>(types.size());
					if (count < band.stops.min || count > band.stops.max) {
						report(
							StopRule::Band,
							where + ": " + std::to_string(count) + " stops, outside its band of " + std::to_string(band.stops.min) +
								" to " + std::to_string(band.stops.max)
						);
					}
					if (ownStops < (band.stops.min + 1) / 2) {
						report(
							StopRule::OwnRoad,
							where + ": " + std::to_string(ownStops) + " stops on its own road, under half its band's " +
								std::to_string(band.stops.min)
						);
					}
				}
			}

			void checkDaylight(int poi, const std::vector<Route>& routes) {
				const Poi& destination = args.pois.pois[static_cast<size_t>(poi)];
				if (destination.tier > kDaylightTiers || routes.empty()) {
					return;
				}
				const double objective = objectiveHours(destination, args.tuning);
				double		 best = 0;
				for (size_t place = 0; place < routes.size(); ++place) {
					double stopHours = 0;
					for (const int leg : routes[place].legs) {
						for (const auto* ids :
							 {&layer.legs[static_cast<size_t>(leg)].stops, &layer.legs[static_cast<size_t>(leg)].extras}) {
							for (const int id : *ids) {
								stopHours += args.tuning.types[static_cast<size_t>(layer.stops[static_cast<size_t>(id)].type)].hours;
							}
						}
					}
					const double hours = runHours(destination.arrivals[place].hours, stopHours, objective);
					best = place == 0 || hours < best ? hours : best;
				}
				const double bare = runHours(destination.arrivals.front().hours, 0, objective);
				if (best <= args.params.daylightHours || bare > args.params.daylightHours) {
					return;
				}
				report(
					StopRule::Daylight,
					"poi " + std::to_string(poi) + " (tier " + std::to_string(destination.tier) +
						"): its best route's estimated run takes " + written(best) + " hours, past daylightHours " +
						written(args.params.daylightHours)
				);
			}

			void checkFinds() {
				const int			   floorTiers = args.tuning.driverFinds.floorTiers;
				const std::vector<int> tiers = legTiers(args.pois);
				bool				   floorLegs = false;
				int					   finds = 0;
				for (size_t leg = 0; leg < legs.size(); ++leg) {
					if (tiers[leg] > floorTiers) {
						continue;
					}
					floorLegs = true;
					for (const int id : layer.legs[leg].stops) {
						finds += layer.stops[static_cast<size_t>(id)].type == StopType::FindDriver ? 1 : 0;
					}
				}
				if (floorLegs && finds < args.params.driverFinds) {
					report(
						StopRule::Finds,
						std::to_string(finds) + " Find: driver stops in tiers 1 to " + std::to_string(floorTiers) + ", under driverFinds " +
							std::to_string(args.params.driverFinds)
					);
				}
			}
		};

	} // namespace

	std::vector<StopViolation> checkStopLayer(const StopCheckArgs& args) {
		return StopChecker(args).check();
	}

	std::vector<std::string> stopProblems(std::span<const StopViolation> violations) {
		std::vector<std::string> problems;
		for (const StopViolation& violation : violations) {
			if (isHard(violation.rule)) {
				problems.push_back(std::string(nameOf(violation.rule)) + ": " + violation.detail);
			}
		}
		return problems;
	}

	bool keepableStops(const std::vector<std::string>& problems) {
		const std::string floor = std::string(nameOf(StopRule::Floor)) + ": ";
		return std::ranges::none_of(problems, [&](const std::string& problem) { return problem.starts_with(floor); });
	}

} // namespace rules::map
