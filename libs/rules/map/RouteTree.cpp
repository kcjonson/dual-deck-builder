#include "RouteTree.h"

#include "NodeHeap.h"

#include <cstddef>
#include <cstdint>
#include <limits>
#include <utility>

namespace rules::map {

	namespace {

		// Each node's stretches, CSR style, by stretch id, each with the node at its other end.
		struct Incidence {
			std::vector<size_t> start;
			std::vector<int>	stretch;
			std::vector<int>	other;

			[[nodiscard]] size_t roads(size_t node) const { return start[node + 1] - start[node]; }
		};

		Incidence incidenceOf(const RoadNetwork& network) {
			const size_t nodes = network.nodes.size();
			Incidence	 incidence{.start = std::vector<size_t>(nodes + 1), .stretch = {}, .other = {}};
			for (const RoadStretch& stretch : network.stretches) {
				if (stretch.from != stretch.to) {
					incidence.start[static_cast<size_t>(stretch.from) + 1] += 1;
					incidence.start[static_cast<size_t>(stretch.to) + 1] += 1;
				}
			}
			for (size_t node = 0; node < nodes; ++node) {
				incidence.start[node + 1] += incidence.start[node];
			}
			incidence.stretch.resize(incidence.start[nodes]);
			incidence.other.resize(incidence.start[nodes]);
			std::vector<size_t> fill(incidence.start.begin(), incidence.start.end() - 1);
			for (size_t id = 0; id < network.stretches.size(); ++id) {
				const RoadStretch& stretch = network.stretches[id];
				if (stretch.from == stretch.to) {
					continue;
				}
				for (const auto& [at, other] : {std::pair{stretch.from, stretch.to}, std::pair{stretch.to, stretch.from}}) {
					size_t& slot = fill[static_cast<size_t>(at)];
					incidence.stretch[slot] = static_cast<int>(id);
					incidence.other[slot] = other;
					slot += 1;
				}
			}
			return incidence;
		}

		std::vector<MeetingPoint>
		findMeetingPoints(const RoadNetwork& network, const RouteTree& tree, const Incidence& incidence, double routeSplit) {
			const size_t		 nodes = network.nodes.size();
			std::vector<uint8_t> onWayHome(network.stretches.size());
			std::vector<int>	 children(nodes);
			for (size_t node = 0; node < nodes; ++node) {
				if (tree.parentStretch[node] >= 0) {
					onWayHome[static_cast<size_t>(tree.parentStretch[node])] = 1;
					children[static_cast<size_t>(tree.parentNode[node])] += 1;
				}
			}
			std::vector<MeetingPoint> points;
			for (size_t id = 0; id < network.stretches.size(); ++id) {
				const RoadStretch& stretch = network.stretches[id];
				if (stretch.from == stretch.to || onWayHome[id] == 1 || !splitsInTime(tree, stretch.from, stretch.to, routeSplit)) {
					continue;
				}
				const int road = static_cast<int>(id);
				points.push_back({.stretch = road, .node = -1, .from = {stretch.from, stretch.to}, .via = {road, road}});
			}
			for (size_t node = 1; node < nodes; ++node) {
				if (tree.depth[node] < 0 || children[node] > 0 || incidence.roads(node) != 3) {
					continue;
				}
				const size_t	 first = incidence.start[node];
				std::vector<int> from(
					incidence.other.begin() + static_cast<std::ptrdiff_t>(first),
					incidence.other.begin() + static_cast<std::ptrdiff_t>(first + 3)
				);
				// Two roads from one neighbour would give two of its routes the same way home.
				if (from[0] == from[1] || from[0] == from[2] || from[1] == from[2]) {
					continue;
				}
				if (splitsInTime(tree, from[0], from[1], routeSplit) && splitsInTime(tree, from[0], from[2], routeSplit) &&
					splitsInTime(tree, from[1], from[2], routeSplit)) {
					std::vector<int> via(
						incidence.stretch.begin() + static_cast<std::ptrdiff_t>(first),
						incidence.stretch.begin() + static_cast<std::ptrdiff_t>(first + 3)
					);
					points.push_back({.stretch = -1, .node = static_cast<int>(node), .from = std::move(from), .via = std::move(via)});
				}
			}
			return points;
		}

	} // namespace

	double hoursFor(double length, RoadClass road, double travelPace) {
		return length / kRoadSpeeds[static_cast<size_t>(road)] * travelPace;
	}

	RouteTree buildRouteTree(const RouteTreeArgs& args) {
		const RoadNetwork&	network = args.network;
		const size_t		nodes = network.nodes.size();
		const size_t		stretches = network.stretches.size();
		std::vector<double> baseHours(stretches);
		for (size_t id = 0; id < stretches; ++id) {
			baseHours[id] = hoursFor(network.stretches[id].length, network.stretches[id].roadClass, 1);
		}
		const Incidence	 incidence = incidenceOf(network);
		constexpr double kUnreached = std::numeric_limits<double>::infinity();
		RouteTree		 tree;
		tree.parentStretch.assign(nodes, -1);
		tree.parentNode.assign(nodes, -1);
		tree.depth.assign(nodes, -1);
		tree.hours.assign(nodes, kUnreached);
		tree.stretchHours.assign(stretches, 0);
		std::vector<double>	 base(nodes, kUnreached);
		std::vector<uint8_t> settled(nodes);
		NodeHeap			 heap;
		if (nodes > 0) {
			base[0] = 0;
			heap.push(0, 0);
		}
		while (!heap.empty()) {
			const auto node = static_cast<size_t>(heap.pop().second);
			if (settled[node] == 1) {
				continue;
			}
			settled[node] = 1;
			tree.depth[node] = node == 0 ? 0 : tree.depth[static_cast<size_t>(tree.parentNode[node])] + 1;
			for (size_t entry = incidence.start[node]; entry < incidence.start[node + 1]; ++entry) {
				const int	 stretch = incidence.stretch[entry];
				const size_t other = static_cast<size_t>(incidence.other[entry]);
				if (settled[other] == 1) {
					continue;
				}
				const double reach = base[node] + baseHours[static_cast<size_t>(stretch)];
				if (reach < base[other] || (reach == base[other] && stretch < tree.parentStretch[other])) {
					if (reach < base[other]) {
						heap.push(reach, static_cast<int>(other));
					}
					base[other] = reach;
					tree.parentStretch[other] = stretch;
					tree.parentNode[other] = static_cast<int>(node);
				}
			}
		}
		for (size_t node = 0; node < nodes; ++node) {
			tree.hours[node] = base[node] * args.travelPace;
		}
		for (size_t id = 0; id < stretches; ++id) {
			tree.stretchHours[id] = baseHours[id] * args.travelPace;
		}
		tree.meetingPoints = findMeetingPoints(network, tree, incidence, args.routeSplit);
		return tree;
	}

	int splitNode(const RouteTree& tree, int a, int b) {
		if (tree.depth[static_cast<size_t>(a)] < 0 || tree.depth[static_cast<size_t>(b)] < 0) {
			return -1;
		}
		const auto up = [&](int node) {
			return tree.parentNode[static_cast<size_t>(node)];
		};
		const auto deep = [&](int node) {
			return tree.depth[static_cast<size_t>(node)];
		};
		while (deep(a) > deep(b)) {
			a = up(a);
		}
		while (deep(b) > deep(a)) {
			b = up(b);
		}
		while (a != b) {
			a = up(a);
			b = up(b);
		}
		return a;
	}

	bool splitsInTime(const RouteTree& tree, int a, int b, double routeSplit) {
		const int split = splitNode(tree, a, b);
		if (split < 0) {
			return false;
		}
		const double first = tree.hours[static_cast<size_t>(a)];
		const double second = tree.hours[static_cast<size_t>(b)];
		return tree.hours[static_cast<size_t>(split)] <= routeSplit * (first < second ? first : second);
	}

} // namespace rules::map
