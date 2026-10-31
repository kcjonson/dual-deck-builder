#include "StopRoom.h"

#include <cmath>
#include <cstddef>
#include <map>
#include <optional>

namespace rules::map {

	namespace {

		// Slack for a junction's clearance, which `join + clear` can miss by a rounding.
		constexpr double kClearSlack = 1e-9;

		// The least point of [at, to] `clear` from every junction; none where there's none.
		std::optional<double> firstClear(double at, double to, std::span<const double> joins, double clear) {
			double point = at;
			for (bool moved = true; moved;) {
				moved = false;
				for (const double join : joins) {
					if (point > join - clear + kClearSlack && point < join + clear - kClearSlack) {
						point = join + clear;
						moved = true;
					}
				}
			}
			if (point <= to) {
				return point;
			}
			return std::nullopt;
		}

	} // namespace

	const StopBand& bandFor(int tier, const StopTuning& tuning) {
		const int index = tier < 1 ? 0 : tier > kStopTiers ? kStopTiers - 1 : tier - 1;
		return tuning.bands[static_cast<size_t>(index)];
	}

	int ownRoadNeed(int tier, const StopTuning& tuning) {
		const StopBand& band = bandFor(tier, tuning);
		const int		half = (band.stops.min + 1) / 2;
		return band.fights.min > half ? band.fights.min : half;
	}

	double runHours(double routeHours, double stopHours, double objectiveHours) {
		return 2 * routeHours + stopHours + objectiveHours;
	}

	double floorRunHours(double routeHours, int tier, double objectiveHours, const StopTuning& tuning) {
		double fightHours = 0;
		for (const auto& [name, type] : kStopTypeNames) {
			const double hours = tuning.types[static_cast<size_t>(type)].hours;
			fightHours = isFight(type) && hours > fightHours ? hours : fightHours;
		}
		const double stopHours =
			bandFor(tier, tuning).fights.min * fightHours + tuning.types[static_cast<size_t>(StopType::FindDriver)].hours;
		return runHours(routeHours, stopHours, objectiveHours);
	}

	std::vector<int> nodeDegrees(const RoadNetwork& network) {
		std::vector<int> degrees(network.nodes.size());
		for (const RoadStretch& stretch : network.stretches) {
			if (stretch.from != stretch.to) {
				degrees[static_cast<size_t>(stretch.from)] += 1;
				degrees[static_cast<size_t>(stretch.to)] += 1;
			}
		}
		return degrees;
	}

	std::vector<double> junctionsAlong(const RoadNetwork& network, const Leg& leg, std::span<const int> degrees) {
		std::vector<double> joins;
		double				along = 0;
		for (size_t piece = 0; piece + 1 < leg.pieces.size(); ++piece) {
			along += leg.pieces[piece].length;
			const RoadStretch& stretch = network.stretches[static_cast<size_t>(leg.pieces[piece].stretch)];
			if (degrees[static_cast<size_t>(leg.pieces[piece].forward ? stretch.to : stretch.from)] >= 3) {
				joins.push_back(along);
			}
		}
		return joins;
	}

	double legEnds(double length, const StopTuning& tuning) {
		return tuning.clearance.ends < 0.25 * length ? tuning.clearance.ends : 0.25 * length;
	}

	std::vector<double> packAlong(double from, double to, double gap, std::span<const double> joins, double clear, size_t limit) {
		std::vector<double> out;
		double				at = from;
		while (out.size() < limit) {
			const std::optional<double> point = firstClear(at, to, joins, clear);
			if (!point) {
				break;
			}
			out.push_back(*point);
			at = *point + gap;
		}
		return out;
	}

	int legRoom(double length, std::span<const double> joins, double gap, const StopTuning& tuning) {
		if (!(length > 0)) {
			return 0;
		}
		const double ends = legEnds(length, tuning);
		const double from = ends + gap / 2;
		const double to = length - ends - gap / 2;
		if (from > to) {
			return 0;
		}
		return static_cast<int>(packAlong(from, to, gap, joins, tuning.clearance.junctions).size());
	}

	std::vector<int> legOwners(size_t legs, std::span<const std::vector<Route>> routes) {
		std::vector<int> owners(legs, kNoOwner);
		for (size_t destination = 0; destination < routes.size(); ++destination) {
			const int self = static_cast<int>(destination);
			for (const Route& route : routes[destination]) {
				for (const int leg : route.legs) {
					int& owner = owners[static_cast<size_t>(leg)];
					owner = owner == kNoOwner || owner == self ? self : kShared;
				}
			}
		}
		return owners;
	}

	std::vector<std::vector<int>> ownRoadRoom(
		const RoadNetwork&					network,
		std::span<const Leg>				legs,
		std::span<const std::vector<Route>> routes,
		std::span<const int>				degrees,
		const StopTuning&					tuning
	) {
		const std::vector<int> owners = legOwners(legs.size(), routes);
		std::map<int, int>	   rooms;
		const auto			   roomOf = [&](int leg) {
			const auto found = rooms.find(leg);
			if (found != rooms.end()) {
				return found->second;
			}
			const Leg&				  held = legs[static_cast<size_t>(leg)];
			const std::vector<double> joins = junctionsAlong(network, held, degrees);
			const int				  room = legRoom(held.length, joins, tuning.tightGap, tuning);
			rooms.emplace(leg, room);
			return room;
		};
		std::vector<std::vector<int>> room;
		for (size_t destination = 0; destination < routes.size(); ++destination) {
			std::vector<int>& each = room.emplace_back();
			for (const Route& route : routes[destination]) {
				int held = 0;
				for (const int leg : route.legs) {
					held += owners[static_cast<size_t>(leg)] == static_cast<int>(destination) ? roomOf(leg) : 0;
				}
				each.push_back(held);
			}
		}
		return room;
	}

} // namespace rules::map
