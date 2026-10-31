#include "RouteLegs.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <map>
#include <utility>

namespace rules::map {

	namespace {

		// Hours to drive `length` of a stretch from either end: all of its hours for the whole of it, so a whole
		// stretch costs exactly what the tree charged for it.
		double pieceHours(const RoadNetwork& network, const RouteTree& tree, int stretch, double length) {
			const double whole = network.stretches[static_cast<size_t>(stretch)].length;
			const double hours = tree.stretchHours[static_cast<size_t>(stretch)];
			return length >= whole ? hours : hours * (length / whole);
		}

		// A line up to `distance` along it, ending on the point there: the whole of it at or past its length.
		std::vector<Point> cutAt(std::span<const Point> line, double distance) {
			std::vector<Point> cut{line.front()};
			double			   travelled = 0;
			for (size_t index = 1; index < line.size(); ++index) {
				const double dx = line[index].x - line[index - 1].x;
				const double dy = line[index].y - line[index - 1].y;
				const double segment = std::sqrt(dx * dx + dy * dy);
				if (travelled + segment >= distance) {
					if (travelled + segment == distance || segment == 0) {
						cut.push_back(line[index]);
					} else {
						const double share = (distance - travelled) / segment;
						cut.push_back({.x = line[index - 1].x + dx * share, .y = line[index - 1].y + dy * share});
					}
					return cut;
				}
				travelled += segment;
				cut.push_back(line[index]);
			}
			return cut;
		}

		// The points at each of `distances` along the line, in one walk: the distances rise, and one past the
		// line's length is its last point.
		std::vector<Point> pointsAlong(std::span<const Point> line, std::span<const double> distances) {
			std::vector<Point> points;
			points.reserve(distances.size());
			size_t index = 1;
			double travelled = 0;
			for (const double distance : distances) {
				while (index < line.size()) {
					const double dx = line[index].x - line[index - 1].x;
					const double dy = line[index].y - line[index - 1].y;
					const double segment = std::sqrt(dx * dx + dy * dy);
					if (travelled + segment >= distance && segment > 0) {
						const double share = (distance - travelled) / segment;
						points.push_back({.x = line[index - 1].x + dx * share, .y = line[index - 1].y + dy * share});
						break;
					}
					travelled += segment;
					index += 1;
				}
				if (index >= line.size()) {
					points.push_back(line.back());
				}
			}
			return points;
		}

		struct Leaving {
			int destination{0};
			int arrival{0};
		};

		// A branch waiting to become a leg: the leg it carries on from, the node it leaves, and either the next
		// node along the tree or an arrival out of it.
		struct Branch {
			int parent{-1};
			int node{0};
			int next{-1};
			int destination{-1};
			int arrival{-1};
		};

	} // namespace

	Destination arrivalsAt(const RoadNetwork& network, const RouteTree& tree, const MeetingPoint& point, double along) {
		const auto hoursAt = [&](int node) {
			return tree.hours[static_cast<size_t>(node)];
		};
		Destination arrivals;
		if (point.stretch >= 0) {
			const RoadStretch& stretch = network.stretches[static_cast<size_t>(point.stretch)];
			assert(along > 0 && along < stretch.length && "arrivalsAt: a POI on a stretch splits it in two");
			for (const auto& [from, length] : {std::pair{stretch.from, along}, std::pair{stretch.to, stretch.length - along}}) {
				arrivals.push_back({
					.from = from,
					.stretch = point.stretch,
					.length = length,
					.hours = hoursAt(from) + pieceHours(network, tree, point.stretch, length),
				});
			}
		} else {
			assert(along == 0 && "arrivalsAt: a three-way POI sits on its node");
			for (size_t road = 0; road < point.from.size(); ++road) {
				const int via = point.via[road];
				arrivals.push_back({
					.from = point.from[road],
					.stretch = via,
					.length = network.stretches[static_cast<size_t>(via)].length,
					.hours = hoursAt(point.from[road]) + tree.stretchHours[static_cast<size_t>(via)],
				});
			}
		}
		std::ranges::sort(arrivals, [](const Arrival& a, const Arrival& b) {
			return a.hours < b.hours || (a.hours == b.hours && a.from < b.from);
		});
		return arrivals;
	}

	RouteLegs buildLegs(const LegArgs& args) {
		const RoadNetwork&				  network = args.network;
		const RouteTree&				  tree = args.tree;
		const size_t					  nodes = tree.parentNode.size();
		std::vector<uint8_t>			  used(nodes);
		std::vector<std::vector<Leaving>> leaving(nodes);
		RouteLegs						  cut;
		for (size_t destination = 0; destination < args.destinations.size(); ++destination) {
			const Destination& arrivals = args.destinations[destination];
			cut.lastLegs.emplace_back(arrivals.size(), -1);
			for (size_t arrival = 0; arrival < arrivals.size(); ++arrival) {
				const int from = arrivals[arrival].from;
				leaving[static_cast<size_t>(from)].push_back(
					{.destination = static_cast<int>(destination), .arrival = static_cast<int>(arrival)}
				);
				for (int node = from; node >= 0 && used[static_cast<size_t>(node)] == 0;
					 node = tree.parentNode[static_cast<size_t>(node)]) {
					used[static_cast<size_t>(node)] = 1;
				}
			}
		}
		std::vector<std::vector<int>> branches(nodes);
		for (size_t node = 1; node < nodes; ++node) {
			if (used[node] == 1 && tree.parentNode[node] >= 0) {
				branches[static_cast<size_t>(tree.parentNode[node])].push_back(static_cast<int>(node));
			}
		}
		const auto outgoing = [&](int node) {
			return branches[static_cast<size_t>(node)].size() + leaving[static_cast<size_t>(node)].size();
		};
		std::vector<Branch> queue;
		const auto			enqueue = [&](int parent, int node) {
			 for (const int next : branches[static_cast<size_t>(node)]) {
				 queue.push_back({.parent = parent, .node = node, .next = next, .destination = -1, .arrival = -1});
			 }
			 for (const Leaving& out : leaving[static_cast<size_t>(node)]) {
				 queue.push_back({.parent = parent, .node = node, .next = -1, .destination = out.destination, .arrival = out.arrival});
			 }
		};
		if (nodes > 0) {
			enqueue(-1, 0);
		}
		for (size_t head = 0; head < queue.size(); ++head) {
			const Branch branch = queue[head];
			Leg			 leg{.parent = branch.parent, .from = branch.node};
			int			 at = branch.node;
			int			 next = branch.next;
			Leaving		 into{.destination = branch.destination, .arrival = branch.arrival};
			while (next >= 0) {
				const int		   stretch = tree.parentStretch[static_cast<size_t>(next)];
				const RoadStretch& road = network.stretches[static_cast<size_t>(stretch)];
				leg.pieces.push_back({.stretch = stretch, .forward = road.from == at, .length = road.length});
				leg.length += road.length;
				leg.hours += tree.stretchHours[static_cast<size_t>(stretch)];
				at = next;
				next = -1;
				assert(outgoing(at) > 0 && "buildLegs: every node on a pruned way home has a way on");
				if (outgoing(at) == 1) {
					if (branches[static_cast<size_t>(at)].size() == 1) {
						next = branches[static_cast<size_t>(at)].front();
					} else {
						into = leaving[static_cast<size_t>(at)].front();
					}
				}
			}
			const int id = static_cast<int>(cut.legs.size());
			if (into.destination < 0) {
				leg.to = at;
				cut.legs.push_back(std::move(leg));
				enqueue(id, at);
				continue;
			}
			const Arrival&	   arrival = args.destinations[static_cast<size_t>(into.destination)][static_cast<size_t>(into.arrival)];
			const RoadStretch& road = network.stretches[static_cast<size_t>(arrival.stretch)];
			const bool		   forward = road.from == arrival.from;
			leg.pieces.push_back({.stretch = arrival.stretch, .forward = forward, .length = arrival.length});
			leg.length += arrival.length;
			leg.hours += pieceHours(network, tree, arrival.stretch, arrival.length);
			// A three-way POI sits on the node the stretch runs to; one partway along has none.
			leg.to = arrival.length >= road.length ? (forward ? road.to : road.from) : -1;
			leg.destination = into.destination;
			cut.legs.push_back(std::move(leg));
			cut.lastLegs[static_cast<size_t>(into.destination)][static_cast<size_t>(into.arrival)] = id;
		}
		return cut;
	}

	std::vector<Route> routesTo(const RouteLegs& legs, int destination) {
		std::vector<Route> routes;
		for (const int last : legs.lastLegs[static_cast<size_t>(destination)]) {
			Route route;
			for (int at = last; at >= 0; at = legs.legs[static_cast<size_t>(at)].parent) {
				route.legs.push_back(at);
			}
			std::ranges::reverse(route.legs);
			for (const int id : route.legs) {
				route.length += legs.legs[static_cast<size_t>(id)].length;
				route.hours += legs.legs[static_cast<size_t>(id)].hours;
			}
			routes.push_back(std::move(route));
		}
		return routes;
	}

	std::vector<Point> legPoints(const RoadNetwork& network, const Leg& leg) {
		std::vector<Point> line;
		for (const LegPiece& piece : leg.pieces) {
			const RoadStretch& road = network.stretches[static_cast<size_t>(piece.stretch)];
			std::vector<Point> points = road.points;
			if (!piece.forward) {
				std::ranges::reverse(points);
			}
			if (piece.length < road.length) {
				points = cutAt(points, piece.length);
			}
			line.insert(line.end(), points.begin() + (line.empty() ? 0 : 1), points.end());
		}
		return line;
	}

	LegProfile profileLeg(const RoadNetwork& network, const Leg& leg, const BiomeAt& biomeAt, double biomeStep) {
		assert(biomeStep > 0 && "profileLeg: biomes are sampled a step apart");
		LegProfile			  profile;
		std::map<int, double> highways;
		for (const LegPiece& piece : leg.pieces) {
			const RoadStretch& road = network.stretches[static_cast<size_t>(piece.stretch)];
			profile.classLengths[static_cast<size_t>(road.roadClass)] += piece.length;
			if (road.roadClass == RoadClass::Highway) {
				highways[road.highway] += piece.length;
			}
		}
		double most = 0;
		for (const auto& [highway, length] : highways) {
			if (length > most) {
				profile.highway = highway;
				most = length;
			}
		}
		const std::vector<Point> line = legPoints(network, leg);
		const int				 samples = leg.length > 0 ? static_cast<int>(std::ceil(leg.length / biomeStep)) : 0;
		std::vector<double>		 distances;
		distances.reserve(static_cast<size_t>(samples));
		for (int sample = 0; sample < samples; ++sample) {
			distances.push_back((sample + 0.5) * leg.length / samples);
		}
		for (const Point& point : pointsAlong(line, distances)) {
			profile.biomeLengths[static_cast<size_t>(biomeAt(point))] += leg.length / samples;
		}
		profile.middle = pointAlong(line, leg.length / 2);
		return profile;
	}

} // namespace rules::map
