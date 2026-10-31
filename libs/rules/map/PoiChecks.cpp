#include "PoiChecks.h"

#include "StopRoom.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <utility>

namespace rules::map {

	namespace {

		class Report {
		  public:
			explicit Report(size_t most)
				: limit(most) {}

			void operator()(PoiRule rule, std::string detail) {
				if (found.size() < limit) {
					found.push_back({.rule = rule, .detail = std::move(detail)});
				}
			}

			[[nodiscard]] size_t					size() const { return found.size(); }
			[[nodiscard]] std::vector<PoiViolation> take() { return std::move(found); }

		  private:
			size_t					  limit;
			std::vector<PoiViolation> found;
		};

		std::string at(size_t index) {
			return std::to_string(index);
		}

		void checkTree(const RoadNetwork& network, const RouteTree& tree, Report& report) {
			if (tree.parentNode.size() != network.nodes.size() || tree.parentNode.empty() || tree.parentNode[0] != -1 ||
				tree.depth[0] != 0) {
				report(PoiRule::Tree, "the tree isn't the network's, rooted at the compound");
				return;
			}
			for (size_t node = 1; node < network.nodes.size(); ++node) {
				const int parent = tree.parentNode[node];
				if (parent < 0) {
					report(PoiRule::Tree, "node " + at(node) + " has no way home");
					continue;
				}
				const RoadStretch& stretch = network.stretches[static_cast<size_t>(tree.parentStretch[node])];
				const auto		   self = static_cast<int>(node);
				if (!((stretch.from == self && stretch.to == parent) || (stretch.to == self && stretch.from == parent))) {
					report(
						PoiRule::Tree,
						"node " + at(node) + "'s way home leaves on a stretch that doesn't join it to node " + std::to_string(parent)
					);
				}
				if (tree.depth[static_cast<size_t>(parent)] != tree.depth[node] - 1) {
					report(PoiRule::Tree, "node " + at(node) + " isn't one stretch further from home than its next node");
				}
			}
		}

		void
		checkDestinations(const RoadNetwork& network, const RouteTree& tree, const PoiLayer& layer, double routeSplit, Report& report) {
			std::vector<uint8_t> onWayHome(network.stretches.size());
			std::vector<uint8_t> passed(network.nodes.size());
			for (size_t node = 1; node < network.nodes.size(); ++node) {
				if (tree.parentStretch[node] >= 0) {
					onWayHome[static_cast<size_t>(tree.parentStretch[node])] = 1;
					passed[static_cast<size_t>(tree.parentNode[node])] = 1;
				}
			}
			std::vector<int> onStretch(network.stretches.size(), -1);
			std::vector<int> atNode(network.nodes.size(), -1);
			for (size_t poi = 0; poi < layer.pois.size(); ++poi) {
				const PoiSite& site = layer.pois[poi].site;
				if (site.stretch >= 0) {
					int& holder = onStretch[static_cast<size_t>(site.stretch)];
					if (holder >= 0) {
						report(
							PoiRule::Destination,
							"POIs " + std::to_string(holder) + " and " + at(poi) + " share stretch " + std::to_string(site.stretch)
						);
					}
					holder = static_cast<int>(poi);
				} else if (site.node >= 0) {
					atNode[static_cast<size_t>(site.node)] = static_cast<int>(poi);
				}
			}
			const std::vector<int> roads = nodeDegrees(network);
			for (size_t poi = 0; poi < layer.pois.size(); ++poi) {
				const Poi&		   destination = layer.pois[poi];
				const PoiSite&	   site = destination.site;
				const Destination& arrivals = destination.arrivals;
				if (site.stretch >= 0) {
					const RoadStretch& stretch = network.stretches[static_cast<size_t>(site.stretch)];
					if (!(site.along > 0 && site.along < stretch.length)) {
						report(PoiRule::Destination, "POI " + at(poi) + " isn't inside stretch " + std::to_string(site.stretch));
					}
					if (onWayHome[static_cast<size_t>(site.stretch)] == 1) {
						report(
							PoiRule::Destination,
							"POI " + at(poi) + " is on stretch " + std::to_string(site.stretch) + ", which a way home uses"
						);
					}
					const bool bothEnds =
						arrivals.size() == 2 &&
						std::ranges::all_of(arrivals, [&](const Arrival& arrival) { return arrival.stretch == site.stretch; }) &&
						std::min(arrivals[0].from, arrivals[1].from) == std::min(stretch.from, stretch.to) &&
						std::max(arrivals[0].from, arrivals[1].from) == std::max(stretch.from, stretch.to);
					if (!bothEnds) {
						report(PoiRule::Destination, "POI " + at(poi) + " doesn't arrive from both ends of its stretch along it");
					}
				} else {
					const int node = site.node;
					if (node <= 0 || passed[static_cast<size_t>(node)] == 1) {
						report(
							PoiRule::Destination, "POI " + at(poi) + " is on node " + std::to_string(node) + ", which a way home passes"
						);
					} else if (std::cmp_not_equal(roads[static_cast<size_t>(node)], arrivals.size()) ||
							   std::ranges::any_of(arrivals, [&](const Arrival& arrival) {
								   const RoadStretch& via = network.stretches[static_cast<size_t>(arrival.stretch)];
								   return via.from != node && via.to != node;
							   })) {
						report(
							PoiRule::Destination,
							"POI " + at(poi) + " on node " + std::to_string(node) + " doesn't arrive along every road it has"
						);
					}
				}
				if (arrivals.size() < 2 || arrivals.size() > 3) {
					report(PoiRule::Choice, "POI " + at(poi) + " has " + at(arrivals.size()) + " routes");
				}
				for (size_t first = 0; first < arrivals.size(); ++first) {
					for (size_t second = first + 1; second < arrivals.size(); ++second) {
						const int a = arrivals[first].from;
						const int b = arrivals[second].from;
						if (a == b) {
							report(
								PoiRule::Choice,
								"POI " + at(poi) + "'s routes " + at(first) + " and " + at(second) + " arrive from one node"
							);
						} else if (!splitsInTime(tree, a, b, routeSplit)) {
							report(
								PoiRule::Choice,
								"POI " + at(poi) + "'s routes from nodes " + std::to_string(a) + " and " + std::to_string(b) +
									" split too late"
							);
						}
					}
				}
				for (const Arrival& arrival : arrivals) {
					for (int node = arrival.from; node >= 0; node = tree.parentNode[static_cast<size_t>(node)]) {
						const int stretch = tree.parentStretch[static_cast<size_t>(node)];
						if (atNode[static_cast<size_t>(node)] >= 0 || (stretch >= 0 && onStretch[static_cast<size_t>(stretch)] >= 0)) {
							report(
								PoiRule::Destination,
								"POI " + at(poi) + "'s route from node " + std::to_string(arrival.from) + " passes a POI at node " +
									std::to_string(node)
							);
						}
					}
				}
			}
		}

		void checkLegs(const RoadNetwork& network, const PoiLayer& layer, Report& report) {
			const std::vector<Leg>& legs = layer.legs.legs;
			if (layer.legs.lastLegs.size() != layer.pois.size()) {
				report(PoiRule::Legs, "the legs aren't cut for the POIs");
				return;
			}
			for (size_t id = 0; id < legs.size(); ++id) {
				const Leg& leg = legs[id];
				if (leg.parent >= static_cast<int>(id)) {
					report(PoiRule::Legs, "leg " + at(id) + " carries on from a leg after it");
					continue;
				}
				const int start = leg.parent < 0 ? 0 : legs[static_cast<size_t>(leg.parent)].to;
				if (leg.from != start) {
					report(
						PoiRule::Legs,
						"leg " + at(id) + " starts at node " + std::to_string(leg.from) + ", not node " + std::to_string(start)
					);
				}
				int node = leg.from;
				for (const LegPiece& piece : leg.pieces) {
					const RoadStretch& stretch = network.stretches[static_cast<size_t>(piece.stretch)];
					if ((piece.forward ? stretch.from : stretch.to) != node) {
						report(
							PoiRule::Legs,
							"leg " + at(id) + " enters stretch " + std::to_string(piece.stretch) + " away from node " + std::to_string(node)
						);
					}
					node = piece.forward ? stretch.to : stretch.from;
				}
			}
			for (size_t poi = 0; poi < layer.pois.size(); ++poi) {
				const std::vector<Route> routes = routesTo(layer.legs, static_cast<int>(poi));
				for (size_t place = 0; place < routes.size() && place < layer.pois[poi].arrivals.size(); ++place) {
					const Leg& first = legs[static_cast<size_t>(routes[place].legs.front())];
					const Leg& last = legs[static_cast<size_t>(routes[place].legs.back())];
					if (first.parent != -1 || last.destination != static_cast<int>(poi) ||
						last.pieces.back().stretch != layer.pois[poi].arrivals[place].stretch) {
						report(
							PoiRule::Legs,
							"POI " + at(poi) + "'s route " + at(place) + " doesn't run from the compound to it on its arrival"
						);
					}
				}
			}
		}

		void checkSpacing(const PoiLayer& layer, double radius, const PoiTuning& tuning, Report& report) {
			const double spacing = tuning.sites.spacing * radius;
			const double wider = std::max(spacing, tuning.strongholds.spacing * radius);
			for (size_t first = 0; first < layer.pois.size(); ++first) {
				for (size_t second = first + 1; second < layer.pois.size(); ++second) {
					const Poi&	 a = layer.pois[first];
					const Poi&	 b = layer.pois[second];
					const double least = a.type == kStrongholdType && b.type == kStrongholdType ? wider : spacing;
					const double dx = a.site.at.x - b.site.at.x;
					const double dy = a.site.at.y - b.site.at.y;
					if (dx * dx + dy * dy < least * least) {
						report(
							PoiRule::Spacing, "POIs " + at(first) + " and " + at(second) + " stand closer than " + std::to_string(least)
						);
					}
				}
			}
		}

		void checkSectors(const PoiLayer& layer, int count, double radius, const PoiTuning& tuning, Report& report) {
			const Sectors	 sectors(layer.sectorRotation, count);
			std::vector<int> seated(static_cast<size_t>(count));
			for (const Stronghold& stronghold : layer.strongholds) {
				const Point at = layer.pois[static_cast<size_t>(stronghold.poi)].site.at;
				const int	sector = sectors.sectorOf(at);
				if (sector != stronghold.sector) {
					report(
						PoiRule::Sectors,
						"the stronghold at POI " + std::to_string(stronghold.poi) + " is in sector " + std::to_string(sector)
					);
				}
				seated[static_cast<size_t>(sector)] += 1;
				const double distance = std::sqrt(at.x * at.x + at.y * at.y);
				if (distance < tuning.strongholds.inner * radius || distance > tuning.strongholds.outer * radius) {
					report(PoiRule::Sectors, "the stronghold at POI " + std::to_string(stronghold.poi) + " is outside the outer band");
				}
			}
			for (size_t sector = 0; sector < seated.size(); ++sector) {
				if (seated[sector] != 1) {
					report(PoiRule::Sectors, "sector " + at(sector) + " has " + std::to_string(seated[sector]) + " strongholds");
				}
			}
		}

		void checkOwnRoad(const RoadNetwork& network, const PoiLayer& layer, const StopTuning& stops, Report& report) {
			std::vector<std::vector<Route>> routes;
			for (size_t poi = 0; poi < layer.pois.size(); ++poi) {
				routes.push_back(routesTo(layer.legs, static_cast<int>(poi)));
			}
			const std::vector<std::vector<int>> room = ownRoadRoom(network, layer.legs.legs, routes, nodeDegrees(network), stops);
			for (size_t poi = 0; poi < room.size(); ++poi) {
				const int need = ownRoadNeed(layer.pois[poi].tier, stops);
				for (size_t route = 0; route < room[poi].size(); ++route) {
					if (room[poi][route] < need) {
						report(
							PoiRule::OwnRoad,
							"POI " + at(poi) + " route " + at(route) + ": its own road has room for " + std::to_string(room[poi][route]) +
								" stops, under the " + std::to_string(need) + " its tier needs"
						);
					}
				}
			}
		}

	} // namespace

	std::vector<PoiViolation> checkPoiLayer(const PoiCheckArgs& args) {
		Report report(args.limit);
		checkTree(args.network, args.tree, report);
		if (report.size() > 0) {
			return report.take();
		}
		checkDestinations(args.network, args.tree, args.layer, args.params.routeSplit, report);
		checkLegs(args.network, args.layer, report);
		const bool legsSound = report.size() == 0;
		checkSpacing(args.layer, args.params.radius, args.tuning, report);
		if (args.sectors) {
			checkSectors(args.layer, args.params.strongholds, args.params.radius, args.tuning, report);
		}
		if (legsSound) {
			checkOwnRoad(args.network, args.layer, args.stops, report);
		}
		return report.take();
	}

} // namespace rules::map
