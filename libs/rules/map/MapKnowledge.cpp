#include "MapKnowledge.h"

#include "ContentReading.h"
#include "MoveCost.h"
#include "RouteLegs.h"
#include "Stops.h"

#include <rules/core/JsonReader.h>

#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>

namespace rules::map {

	namespace {

		[[nodiscard]] bool onStreets(const RoadNetwork& network, const Leg& leg) {
			return std::ranges::all_of(leg.pieces, [&](const LegPiece& piece) {
				return network.stretches[static_cast<size_t>(piece.stretch)].street;
			});
		}

		// The class most of it is, ties to the earlier, as a route's is.
		[[nodiscard]] bool mostlyHighway(const RoadNetwork& network, const Leg& leg) {
			std::array<double, 3> lengths{};
			for (const LegPiece& piece : leg.pieces) {
				lengths[static_cast<size_t>(network.stretches[static_cast<size_t>(piece.stretch)].roadClass)] += piece.length;
			}
			return std::ranges::max_element(lengths) == lengths.begin();
		}

		void revealLeg(MapKnowledge& knowledge, const KnowledgeArgs& args, int leg) {
			const double radius = args.params.radius;
			revealAround(
				knowledge.land, legPoints(args.network, args.pois.legs.legs[static_cast<size_t>(leg)]), args.tuning.sight * radius, radius
			);
		}

		// A route's way toward a POI of the next tier, as the radio hears of it.
		struct Lead {
			double hours{0};
			int	   leg{0};
		};

	} // namespace

	KnowledgeTuning readKnowledgeTuning(const std::filesystem::path& file) {
		const nlohmann::json json = readJsonFile(file);
		JsonReader			 reader(json, file.generic_string());
		KnowledgeTuning		 tuning;
		tuning.sight = readShare(reader, "sight");
		if (tuning.sight <= 0) {
			reader.failAt("sight", "must be above 0");
		}
		tuning.poiSight = readShare(reader, "poiSight");
		if (tuning.poiSight < tuning.sight) {
			reader.failAt("poiSight", "must be at least sight: reaching a POI sees further than driving past");
		}
		tuning.startingRumors = readIntAtLeast(reader, "startingRumors", 0);
		reader.finish();
		return tuning;
	}

	MapKnowledge startingKnowledge(const KnowledgeArgs& args) {
		const std::vector<Leg>& legs = args.pois.legs.legs;
		const std::vector<int>	tiers = legTiers(args.pois);
		const int				reveal = args.params.startingReveal;
		MapKnowledge			knowledge{.legs = std::vector<LegKnowledge>(legs.size(), LegKnowledge::Uncharted), .land = {}};
		const auto				charted = [](const std::vector<LegKnowledge>& known, int leg) {
			 return leg < 0 || known[static_cast<size_t>(leg)] == LegKnowledge::Charted;
		};
		// Parents come first, so charting runs out from the compound and every charted leg's parent is charted.
		for (size_t id = 0; id < legs.size(); ++id) {
			if (charted(knowledge.legs, legs[id].parent) && (tiers[id] <= reveal || onStreets(args.network, legs[id]))) {
				knowledge.legs[id] = LegKnowledge::Charted;
			}
		}
		// One leg further, off the reveal alone, so a highway never runs on two.
		const std::vector<LegKnowledge> revealed = knowledge.legs;
		for (size_t id = 0; id < legs.size(); ++id) {
			if (revealed[id] == LegKnowledge::Uncharted && charted(revealed, legs[id].parent) && tiers[id] <= reveal + 1 &&
				mostlyHighway(args.network, legs[id])) {
				knowledge.legs[id] = LegKnowledge::Charted;
			}
		}
		// Each next-tier route's first leg off charted road, nearest first.
		std::vector<Lead> leads;
		for (size_t poi = 0; poi < args.pois.pois.size(); ++poi) {
			if (args.pois.pois[poi].tier != reveal + 1) {
				continue;
			}
			for (const Route& route : routesTo(args.pois.legs, static_cast<int>(poi))) {
				const auto first = std::ranges::find_if(route.legs, [&](int leg) { return !charted(knowledge.legs, leg); });
				if (first != route.legs.end()) {
					leads.push_back({.hours = route.hours, .leg = *first});
				}
			}
		}
		std::ranges::sort(leads, [](const Lead& a, const Lead& b) { return a.hours != b.hours ? a.hours < b.hours : a.leg < b.leg; });
		int rumored = 0;
		for (const Lead& lead : leads) {
			LegKnowledge& known = knowledge.legs[static_cast<size_t>(lead.leg)];
			if (rumored < args.tuning.startingRumors && known == LegKnowledge::Uncharted) {
				known = LegKnowledge::Rumored;
				rumored += 1;
			}
		}
		for (size_t id = 0; id < legs.size(); ++id) {
			if (knowledge.legs[id] == LegKnowledge::Charted) {
				revealLeg(knowledge, args, static_cast<int>(id));
			}
		}
		const double radius = args.params.radius;
		for (const RoadStretch& road : args.network.stretches) {
			if (road.street) {
				revealAround(knowledge.land, road.points, args.tuning.sight * radius, radius);
			}
		}
		return knowledge;
	}

	void driveLeg(MapKnowledge& knowledge, const KnowledgeArgs& args, int leg) {
		assert(leg >= 0 && static_cast<size_t>(leg) < knowledge.legs.size() && "driveLeg: a leg of the map");
		knowledge.legs[static_cast<size_t>(leg)] = LegKnowledge::Charted;
		revealLeg(knowledge, args, leg);
	}

	void reachPoi(MapKnowledge& knowledge, const KnowledgeArgs& args, int poi) {
		assert(poi >= 0 && static_cast<size_t>(poi) < args.pois.pois.size() && "reachPoi: a POI of the map");
		const double			   radius = args.params.radius;
		const std::array<Point, 1> site{args.pois.pois[static_cast<size_t>(poi)].site.at};
		revealAround(knowledge.land, site, args.tuning.poiSight * radius, radius);
	}

	void rumorLeg(MapKnowledge& knowledge, int leg) {
		assert(leg >= 0 && static_cast<size_t>(leg) < knowledge.legs.size() && "rumorLeg: a leg of the map");
		LegKnowledge& known = knowledge.legs[static_cast<size_t>(leg)];
		known = std::max(known, LegKnowledge::Rumored);
	}

	bool isFound(const MapKnowledge& knowledge, const KnowledgeArgs& args, int poi) {
		assert(poi >= 0 && static_cast<size_t>(poi) < args.pois.pois.size() && "isFound: a POI of the map");
		if (revealedAt(knowledge.land, args.pois.pois[static_cast<size_t>(poi)].site.at, args.params.radius)) {
			return true;
		}
		return std::ranges::any_of(args.pois.legs.lastLegs[static_cast<size_t>(poi)], [&](int leg) {
			return knowledge.legs[static_cast<size_t>(leg)] != LegKnowledge::Uncharted;
		});
	}

	std::vector<std::string> revealProblems(const KnowledgeArgs& args) {
		const MapKnowledge		 start = startingKnowledge(args);
		const int				 reveal = args.params.startingReveal;
		std::vector<std::string> problems;
		for (const Stronghold& stronghold : args.pois.strongholds) {
			const std::string named = "the " + stronghold.faction + " stronghold, POI " + std::to_string(stronghold.poi) + ",";
			const int		  tier = args.pois.pois[static_cast<size_t>(stronghold.poi)].tier;
			if (tier < reveal + 2) {
				problems.push_back(
					"reveal: " + named + " is tier " + std::to_string(tier) + ", within a tier of the starting reveal's " +
					std::to_string(reveal)
				);
			}
			if (isFound(start, args, stronghold.poi)) {
				problems.push_back("reveal: " + named + " is found at the start");
			}
		}
		return problems;
	}

} // namespace rules::map
