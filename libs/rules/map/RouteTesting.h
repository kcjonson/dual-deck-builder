#pragma once

// What the route tree's tests and the stages after it share: synthetic networks, meshes laid by hand and random
// planar ones with loops, for shapes no seed draws; a stand-in for the POIs; and the checks every tree and every cut
// of legs pass. Tests only: nothing in the library includes it.

#include "Polyline.h"
#include "RoadNetwork.h"
#include "RouteDescriptors.h"
#include "RouteLegs.h"
#include "RouteTree.h"

#include <random/Rng.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <map>
#include <numeric>
#include <set>
#include <span>
#include <string>
#include <utility>
#include <vector>

namespace rules::map::fixtures {

	// The base pack's route names and fuel.
	inline const RouteTuning& routeTuning() {
		static const RouteTuning tuning = readRouteTuning(std::filesystem::path(DDB_PACKS_DIR) / "base" / "map" / "routes.json");
		return tuning;
	}

	// An edge between two of a mesh's nodes: a back road unless it says otherwise, and a highway's index its own.
	struct MeshEdge {
		int		  from{0};
		int		  to{0};
		RoadClass roadClass{RoadClass::BackRoad};
		int		  highway{0};
	};

	// A network from points and edges in the order given: node 0 the compound, the rest junctions, and each edge a
	// straight stretch from its first node to its second, with no bridges. Highway h carries route number 10 + h.
	inline RoadNetwork meshFrom(const std::vector<Point>& points, const std::vector<MeshEdge>& edges) {
		RoadNetwork network;
		for (size_t id = 0; id < points.size(); ++id) {
			network.nodes.push_back({
				.kind = id == 0 ? RoadNodeKind::Compound : RoadNodeKind::Junction,
				.x = points[id].x,
				.y = points[id].y,
				.place = id == 0 ? 0 : -1,
			});
		}
		int highways = 0;
		for (const MeshEdge& edge : edges) {
			std::vector<Point> line{points[static_cast<size_t>(edge.from)], points[static_cast<size_t>(edge.to)]};
			const bool		   highway = edge.roadClass == RoadClass::Highway;
			const double	   length = polylineLength(line);
			network.stretches.push_back({
				.roadClass = edge.roadClass,
				.from = edge.from,
				.to = edge.to,
				.length = length,
				.points = std::move(line),
				.bridges = {},
				.street = false,
				.highway = highway ? edge.highway : -1,
			});
			highways = highway ? std::max(highways, edge.highway + 1) : highways;
		}
		for (int highway = 0; highway < highways; ++highway) {
			network.routeNumbers.push_back(10 + highway);
		}
		return network;
	}

	struct RandomMeshArgs {
		uint32_t seed{0};
		double	 radius{1000};
		// World units between grid points before jitter, and the share of that each point moves at most each way.
		double spacing{90};
		double jitter{0.25};
		// The chances a grid square gets a diagonal, an edge off the spanning tree is kept, which is what makes
		// loops, and a back road is a trail.
		double diagonals{0.4};
		double loops{0.6};
		double trails{0.2};
	};

	// A random planar mesh over a disc: a jittered square grid with the compound at its origin, each square given at
	// most one diagonal so no two edges cross, cut to a random spanning tree plus `loops` of the rest, each edge
	// running either way. The grid's two axes through the compound are highways 0 to 3, east, north, west, and
	// south. Points stay within 0.97 of the radius.
	inline RoadNetwork randomMesh(const RandomMeshArgs& args) {
		foundation::Rng					   rng(args.seed);
		const double					   rim = 0.97 * args.radius;
		const int						   span = static_cast<int>(std::floor(rim / args.spacing));
		std::map<std::pair<int, int>, int> ids;
		std::vector<Point>				   points;
		const auto						   add = [&](int i, int j) {
			const bool	 home = i == 0 && j == 0;
			const double x = i * args.spacing + (home ? 0 : (rng.nextDouble() * 2 - 1) * args.jitter * args.spacing);
			const double y = j * args.spacing + (home ? 0 : (rng.nextDouble() * 2 - 1) * args.jitter * args.spacing);
			if (x * x + y * y <= rim * rim) {
				ids[{i, j}] = static_cast<int>(points.size());
				points.push_back({.x = x, .y = y});
			}
		};
		add(0, 0);
		for (int j = -span; j <= span; ++j) {
			for (int i = -span; i <= span; ++i) {
				if (i != 0 || j != 0) {
					add(i, j);
				}
			}
		}
		const auto at = [&](int i, int j) {
			const auto found = ids.find({i, j});
			return found == ids.end() ? -1 : found->second;
		};
		std::vector<MeshEdge> candidates;
		const auto			  link = [&](int a, int b, int highway) {
			   if (a < 0 || b < 0) {
				   return;
			   }
			   const RoadClass road = highway >= 0					   ? RoadClass::Highway
											  : rng.nextDouble() < args.trails ? RoadClass::Trail
																			   : RoadClass::BackRoad;
			   candidates.push_back({.from = a, .to = b, .roadClass = road, .highway = highway});
		};
		for (int j = -span; j <= span; ++j) {
			for (int i = -span; i <= span; ++i) {
				link(at(i, j), at(i + 1, j), j == 0 ? (i >= 0 ? 0 : 2) : -1);
				link(at(i, j), at(i, j + 1), i == 0 ? (j >= 0 ? 1 : 3) : -1);
				if (rng.nextDouble() < args.diagonals) {
					if (rng.nextDouble() < 0.5) {
						link(at(i, j), at(i + 1, j + 1), -1);
					} else {
						link(at(i + 1, j), at(i, j + 1), -1);
					}
				}
			}
		}
		// Kruskal over random weights: a random spanning tree, then each other edge kept by chance.
		std::vector<double> weights;
		for (size_t index = 0; index < candidates.size(); ++index) {
			weights.push_back(rng.nextDouble());
		}
		std::vector<size_t> order(candidates.size());
		std::iota(order.begin(), order.end(), size_t{0});
		std::ranges::stable_sort(order, [&](size_t a, size_t b) { return weights[a] < weights[b]; });
		std::vector<int> root(points.size());
		std::iota(root.begin(), root.end(), 0);
		const auto find = [&](int node) {
			while (root[static_cast<size_t>(node)] != node) {
				root[static_cast<size_t>(node)] = root[static_cast<size_t>(root[static_cast<size_t>(node)])];
				node = root[static_cast<size_t>(node)];
			}
			return node;
		};
		std::vector<uint8_t> kept(candidates.size());
		for (const size_t index : order) {
			const int a = find(candidates[index].from);
			const int b = find(candidates[index].to);
			if (a != b) {
				root[static_cast<size_t>(a)] = b;
				kept[index] = 1;
			} else if (rng.nextDouble() < args.loops) {
				kept[index] = 1;
			}
		}
		std::vector<MeshEdge> edges;
		for (size_t index = 0; index < candidates.size(); ++index) {
			if (kept[index] == 1) {
				MeshEdge edge = candidates[index];
				if (rng.nextDouble() < 0.5) {
					std::swap(edge.from, edge.to);
				}
				edges.push_back(edge);
			}
		}
		return meshFrom(points, edges);
	}

	// A destination at every meeting point none before it took a stretch of, the middle of each on a stretch: at
	// most one on a stretch, so no route passes another's, which is all legs need. A stand-in for the POIs, which
	// seat far fewer.
	inline std::vector<Destination> everyFreeMeetingPoint(const RoadNetwork& network, const RouteTree& tree) {
		std::set<int>			 taken;
		std::vector<Destination> destinations;
		for (const MeetingPoint& point : tree.meetingPoints) {
			if (std::ranges::any_of(point.via, [&](int via) { return taken.contains(via); })) {
				continue;
			}
			taken.insert(point.via.begin(), point.via.end());
			const double along = point.stretch >= 0 ? network.stretches[static_cast<size_t>(point.stretch)].length / 2 : 0;
			destinations.push_back(arrivalsAt(network, tree, point, along));
		}
		return destinations;
	}

	// Every node's way home in one tree: each node's parent stretch joins it to a node one stretch nearer home, the
	// hours adding up, and no stretch brings either of its ends home sooner, or as soon on a lower id. Ties are
	// checked exactly, which holds at travel pace 1, where the hours add as the tree's own do.
	inline void expectQuickestTree(const RoadNetwork& network, const RouteTree& tree) {
		ASSERT_EQ(tree.parentStretch.size(), network.nodes.size());
		ASSERT_EQ(tree.stretchHours.size(), network.stretches.size());
		EXPECT_EQ(tree.depth[0], 0);
		EXPECT_EQ(tree.hours[0], 0);
		for (size_t node = 1; node < network.nodes.size(); ++node) {
			const int parent = tree.parentNode[node];
			ASSERT_GE(parent, 0) << "node " << node << " has no way home";
			const auto		   along = static_cast<size_t>(tree.parentStretch[node]);
			const RoadStretch& stretch = network.stretches[along];
			const auto		   self = static_cast<int>(node);
			EXPECT_TRUE((stretch.from == self && stretch.to == parent) || (stretch.to == self && stretch.from == parent))
				<< "node " << node;
			EXPECT_EQ(tree.depth[node], tree.depth[static_cast<size_t>(parent)] + 1);
			EXPECT_NEAR(tree.hours[node], tree.hours[static_cast<size_t>(parent)] + tree.stretchHours[along], 1e-9);
		}
		for (size_t id = 0; id < network.stretches.size(); ++id) {
			const RoadStretch& stretch = network.stretches[id];
			for (const auto& [near, far] : {std::pair{stretch.from, stretch.to}, std::pair{stretch.to, stretch.from}}) {
				const double via = tree.hours[static_cast<size_t>(near)] + tree.stretchHours[id];
				EXPECT_LE(tree.hours[static_cast<size_t>(far)], via + 1e-9) << "stretch " << id;
				if (far != 0 && tree.hours[static_cast<size_t>(far)] == via) {
					EXPECT_LE(tree.parentStretch[static_cast<size_t>(far)], static_cast<int>(id)) << "stretch " << id;
				}
			}
		}
	}

	// Whether a name is one the tuning gives a route: a biome's or a class's, a highway's with one of the network's
	// route numbers, then perhaps the side it comes in from, then perhaps its letter.
	inline bool namedAsTuned(std::string name, const RouteTuning& tuning, std::span<const int> routeNumbers) {
		if (name.size() > 2 && name[name.size() - 2] == ' ' && name.back() >= 'A' && name.back() <= 'C') {
			name.resize(name.size() - 2);
		}
		if (const size_t side = name.find(" from the "); side != std::string::npos) {
			const std::set<std::string> points{"north", "south", "east", "west", "north-east", "north-west", "south-east", "south-west"};
			if (!points.contains(name.substr(side + 10))) {
				return false;
			}
			name.resize(side);
		}
		if (std::ranges::find(tuning.biomeNames, name) != tuning.biomeNames.end() || name == tuning.classNames[1] ||
			name == tuning.classNames[2]) {
			return true;
		}
		const std::string& highway = tuning.classNames[0];
		const size_t	   slot = highway.find(kRouteNumberSlot);
		const std::string  before = highway.substr(0, slot);
		const std::string  after = highway.substr(slot + kRouteNumberSlot.size());
		if (name.size() <= before.size() + after.size() || !name.starts_with(before) || !name.ends_with(after)) {
			return false;
		}
		const std::string number = name.substr(before.size(), name.size() - before.size() - after.size());
		return std::ranges::all_of(number, [](char digit) { return digit >= '0' && digit <= '9'; }) &&
			   std::ranges::find(routeNumbers, std::stoi(number)) != routeNumbers.end();
	}

	// A destination's descriptors: one for each route, quickest first, with its legs, length, hours, and fuel, and
	// named as the tuning names routes, no two alike.
	inline void expectDescriptorsMatchTheirRoutes(
		const RoadNetwork&				 network,
		const RouteLegs&				 cut,
		int								 destination,
		std::span<const RouteDescriptor> described,
		const RouteTuning&				 tuning
	) {
		const std::vector<Route> routes = routesTo(cut, destination);
		ASSERT_EQ(described.size(), routes.size());
		std::set<std::string> names;
		for (size_t place = 0; place < routes.size(); ++place) {
			const RouteDescriptor& descriptor = described[place];
			EXPECT_EQ(descriptor.route, static_cast<int>(place));
			EXPECT_EQ(descriptor.legs, routes[place].legs);
			EXPECT_EQ(descriptor.length, routes[place].length);
			EXPECT_EQ(descriptor.hours, routes[place].hours);
			EXPECT_EQ(descriptor.fuel, std::max(1, static_cast<int>(std::ceil(descriptor.length / tuning.unitsPerFuel))));
			EXPECT_TRUE(namedAsTuned(descriptor.name, tuning, network.routeNumbers)) << descriptor.name;
			names.insert(descriptor.name);
		}
		EXPECT_EQ(names.size(), routes.size()) << "destination " << destination << "'s routes share a name";
	}

	// Meeting points as the spec has them (Area Map Generation, 7. POIs and strongholds): on a stretch no way home uses
	// joining two nodes, or at a leaf no way home passes through with exactly three roads from three neighbours, each
	// pair of their ways home splitting in time.
	inline void expectMeetingPointsOffTheWaysHome(const RoadNetwork& network, const RouteTree& tree, double routeSplit) {
		const std::set<int> used(tree.parentStretch.begin(), tree.parentStretch.end());
		for (const MeetingPoint& point : tree.meetingPoints) {
			if (point.stretch >= 0) {
				const RoadStretch& stretch = network.stretches[static_cast<size_t>(point.stretch)];
				EXPECT_FALSE(used.contains(point.stretch)) << "stretch " << point.stretch << " is on a way home";
				EXPECT_EQ(point.from, (std::vector<int>{stretch.from, stretch.to}));
				EXPECT_EQ(point.via, (std::vector<int>{point.stretch, point.stretch}));
			} else {
				ASSERT_EQ(point.from.size(), 3U);
				EXPECT_EQ(std::ranges::count(tree.parentNode, point.node), 0) << "a way home passes node " << point.node;
				EXPECT_EQ(std::set<int>(point.from.begin(), point.from.end()).size(), 3U);
				int roads = 0;
				for (const RoadStretch& stretch : network.stretches) {
					roads += stretch.from != stretch.to && (stretch.from == point.node || stretch.to == point.node) ? 1 : 0;
				}
				EXPECT_EQ(roads, 3) << "node " << point.node;
				for (size_t road = 0; road < 3; ++road) {
					const RoadStretch& via = network.stretches[static_cast<size_t>(point.via[road])];
					EXPECT_EQ(std::set<int>({via.from, via.to}), std::set<int>({point.node, point.from[road]}));
				}
			}
			for (size_t a = 0; a < point.from.size(); ++a) {
				for (size_t b = a + 1; b < point.from.size(); ++b) {
					EXPECT_TRUE(splitsInTime(tree, point.from[a], point.from[b], routeSplit));
				}
			}
		}
	}

	// What every cut of legs holds (Area Map Generation, Guarantees 2 and 5, and 6. The route tree): parents first,
	// each leg carrying on from where its parent ends and running over the network piece by piece; legs leaving a
	// node only at the compound and where routes split; every road a route uses driven by one leg, but a POI's own
	// stretch, which its two arrivals drive from either end to it; and each destination's routes leaving the
	// compound, ending at it, and sharing nothing past where they split, which is no later than `routeSplit` of the
	// shorter's hours.
	inline void expectLegsOverTheNetwork(
		const RoadNetwork&			 network,
		std::span<const Destination> destinations,
		const RouteLegs&			 cut,
		double						 routeSplit
	) {
		std::vector<int>	  starting(network.nodes.size());
		std::map<int, double> driven;
		std::map<int, int>	  drivers;
		for (size_t id = 0; id < cut.legs.size(); ++id) {
			const Leg& leg = cut.legs[id];
			ASSERT_FALSE(leg.pieces.empty()) << "leg " << id;
			if (leg.parent >= 0) {
				EXPECT_LT(leg.parent, static_cast<int>(id));
				EXPECT_EQ(cut.legs[static_cast<size_t>(leg.parent)].to, leg.from);
				EXPECT_EQ(cut.legs[static_cast<size_t>(leg.parent)].destination, -1);
			} else {
				EXPECT_EQ(leg.from, 0);
			}
			starting[static_cast<size_t>(leg.from)] += 1;
			int	   at = leg.from;
			double length = 0;
			for (size_t index = 0; index < leg.pieces.size(); ++index) {
				const LegPiece&	   piece = leg.pieces[index];
				const RoadStretch& road = network.stretches[static_cast<size_t>(piece.stretch)];
				EXPECT_EQ(piece.forward ? road.from : road.to, at) << "leg " << id << " piece " << index;
				if (piece.length < road.length) {
					EXPECT_TRUE(index + 1 == leg.pieces.size() && leg.destination >= 0 && leg.to == -1) << "leg " << id;
					at = -1;
				} else {
					EXPECT_EQ(piece.length, road.length);
					at = piece.forward ? road.to : road.from;
				}
				length += piece.length;
				driven[piece.stretch] += piece.length;
				drivers[piece.stretch] += 1;
			}
			EXPECT_NEAR(leg.length, length, 1e-9);
			if (at >= 0) {
				EXPECT_EQ(leg.to, at) << "leg " << id;
			}
		}
		for (size_t node = 1; node < starting.size(); ++node) {
			EXPECT_NE(starting[node], 1) << "a leg leaves node " << node << ", where routes don't split";
		}
		for (const Leg& leg : cut.legs) {
			if (leg.destination < 0) {
				EXPECT_GE(starting[static_cast<size_t>(leg.to)], 2) << "a leg ends at node " << leg.to << ", where routes don't split";
			}
		}
		for (const auto& [stretch, count] : drivers) {
			EXPECT_LE(count, 2) << "stretch " << stretch;
			if (count == 2) {
				EXPECT_NEAR(driven[stretch], network.stretches[static_cast<size_t>(stretch)].length, 1e-9) << "stretch " << stretch;
			}
		}
		ASSERT_EQ(cut.lastLegs.size(), destinations.size());
		for (size_t destination = 0; destination < destinations.size(); ++destination) {
			const std::vector<Route> routes = routesTo(cut, static_cast<int>(destination));
			ASSERT_EQ(routes.size(), destinations[destination].size());
			for (size_t place = 0; place < routes.size(); ++place) {
				const Route& route = routes[place];
				EXPECT_EQ(cut.legs[static_cast<size_t>(route.legs.front())].from, 0);
				EXPECT_EQ(cut.legs[static_cast<size_t>(route.legs.back())].destination, static_cast<int>(destination));
				for (size_t index = 1; index < route.legs.size(); ++index) {
					EXPECT_EQ(cut.legs[static_cast<size_t>(route.legs[index])].parent, route.legs[index - 1]);
				}
				EXPECT_NEAR(route.hours, destinations[destination][place].hours, 1e-9);
				for (size_t other = place + 1; other < routes.size(); ++other) {
					const Route& second = routes[other];
					size_t		 shared = 0;
					double		 sharedHours = 0;
					while (shared < route.legs.size() && shared < second.legs.size() && route.legs[shared] == second.legs[shared]) {
						sharedHours += cut.legs[static_cast<size_t>(route.legs[shared])].hours;
						shared += 1;
					}
					const std::set<int> past(route.legs.begin() + static_cast<std::ptrdiff_t>(shared), route.legs.end());
					for (size_t index = shared; index < second.legs.size(); ++index) {
						EXPECT_FALSE(past.contains(second.legs[index])) << "destination " << destination << " routes meet again";
					}
					EXPECT_LE(sharedHours, routeSplit * std::min(route.hours, second.hours) + 1e-9);
				}
			}
		}
	}

} // namespace rules::map::fixtures
