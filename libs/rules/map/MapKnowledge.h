#pragma once

#include "LandFog.h"
#include "MapParams.h"
#include "Pois.h"
#include "RoadNetwork.h"

#include <filesystem>
#include <string>
#include <vector>

namespace rules::map {

	// What's known of a leg, least first (Compound and Supply Runs, Fog of war).
	enum class LegKnowledge { Uncharted, Rumored, Charted };

	// How far the land is seen and how much the radio has heard at the start, a pack's map/knowledge.json.
	struct KnowledgeTuning {
		// Shares of the radius: how far either side of a leg's road the land is revealed, and round a POI reached.
		double sight{0};
		double poiSight{0};
		// Legs toward the next tier's POIs that start rumored, the radio's first rumors.
		int startingRumors{0};
	};

	// {"sight", "poiSight", "startingRumors"}: the sights shares of the radius above 0, a POI's at least a leg's, and the
	// rumors a whole number from 0. Anything else fails with a ContentError naming the file and the field.
	[[nodiscard]] KnowledgeTuning readKnowledgeTuning(const std::filesystem::path& file);

	// What's known of the map: each leg's knowledge, and the land revealed. Plain data that only grows, since nothing here
	// takes knowledge back: a revealed stop stays revealed.
	struct MapKnowledge {
		// By leg id, one for each of the POI layer's legs.
		std::vector<LegKnowledge> legs;
		LandFog					  land;

		bool operator==(const MapKnowledge&) const = default;
	};

	// What knowledge reads of a made map, which outlives it with the tuning.
	struct KnowledgeArgs {
		const RoadNetwork& network;
		const PoiLayer&	   pois;
		// Validated: radius and startingReveal are read.
		const MapParams&	   params;
		const KnowledgeTuning& tuning;
	};

	// The compound's knowledge at founding (Area Map Generation, 10. Starting knowledge): a pure function of the gameplay
	// map, taking no draws, so it's worked out whenever it's wanted and never saved. Out from the compound, every leg in
	// the first startingReveal tiers is charted, and so is one wholly on the metro's streets; then each highway one leg
	// further, a leg of the next tier more highway than anything else, and never one into a stronghold, which is tier 5.
	// Then the startingRumors legs off charted road nearest the next tier's POIs, by their routes' hours, ties to the
	// lower leg, start rumored. The land is revealed within sight of every charted leg and every street.
	[[nodiscard]] MapKnowledge startingKnowledge(const KnowledgeArgs& args);

	// What a run reveals as it passes (Area Map Generation, Knowledge and fog), over the map and never into it. Driving
	// a leg charts it and reveals the land within sight of its road, where the legs leaving its far end show as stubs.
	void driveLeg(MapKnowledge& knowledge, const KnowledgeArgs& args, int leg);
	// Reaching a POI reveals the land within poiSight of it, which takes in the ends of its other routes' last legs.
	void reachPoi(MapKnowledge& knowledge, const KnowledgeArgs& args, int poi);
	// A rumor, the radio's or an event's: an uncharted leg becomes rumored, and a charted one stays charted.
	void rumorLeg(MapKnowledge& knowledge, int leg);

	// Whether a POI is found: its land is revealed, or a leg into it, one of its last legs, is rumored or charted. The
	// spec's rule for a stronghold, and every POI's, since the fog lifting over one or its road rumored is how it's found.
	[[nodiscard]] bool isFound(const MapKnowledge& knowledge, const KnowledgeArgs& args, int poi);

	// What the starting knowledge breaks of Guarantees 6, each as "reveal: detail": a stronghold within a tier of the
	// starting reveal, or found at the start. The map validator holds the POIs to it.
	[[nodiscard]] std::vector<std::string> revealProblems(const KnowledgeArgs& args);

} // namespace rules::map
