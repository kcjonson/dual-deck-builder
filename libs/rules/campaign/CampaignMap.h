#pragma once

#include "Campaign.h"

#include <rules/map/AreaMapPipeline.h>
#include <rules/map/RouteOutlook.h>
#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <functional>

namespace rules::campaign {

	// The area map on the campaign (campaign.md, The map on the campaign). The campaign keeps what makes the map again,
	// its MapOrigin, and what's changed on it since, its MapState. The map itself is never saved: founding makes it, a
	// load makes it again, and the game holds it beside the campaign.

	// Seeds founding tries, the one it was given and those after it, when a seed's map attempts all fail.
	inline constexpr int kFoundingSeeds = 4;

	// A map made for a campaign, with what makes it again.
	struct CampaignMap {
		MapOrigin	 origin;
		map::AreaMap map;
	};

	struct MapMaking {
		// Told as each stage attempt starts, for the screen waiting on it.
		std::function<void(const map::StageAttempt&)> onProgress{};
		// Past a seed's map attempts, throw rather than go on to the next seed, and past a local-retry stage's, throw
		// rather than keep its best: a development build's default.
		bool debug{map::kDevelopmentBuild};
	};

	// A new campaign's map (campaign-founding.md): its params rolled from the seed, and the map made from them, the
	// map's origin holding where it sat among the seed's attempts and its fingerprint. Past the map attempts a release
	// build goes on to the next seed, wrapping, up to kFoundingSeeds, and the origin's params hold the seed it settled on,
	// which founds the campaign; a debug build throws the map::MapPipelineError at once. It's a whole generation, so the
	// game runs it off the frame.
	[[nodiscard]] CampaignMap makeCampaignMap(uint32_t seed, const map::MapContent& content, const MapMaking& making = {});

	// What the campaign's ids name on a made map, hashed: the POIs' types, tiers, and arrivals, the strongholds, the legs
	// and the routes they make, and the stops' legs, types, skulls, and stages, with their contents' seed. Positions and
	// lengths stay out, so it holds what play reads and nothing a last bit of floating point could move. Reads only the
	// POIs and the stops, which are all the campaign reads of the map so far.
	[[nodiscard]] uint64_t mapFingerprint(const map::AreaMap& map);

	// Throws a ContentError naming the path in the save when `map` isn't the one the campaign's origin makes, by its
	// fingerprint, or an id the map state holds isn't on it: a POI, leg, or stop past the map's, or a stronghold taken
	// that isn't a stronghold.
	void checkCampaignMap(const Campaign& campaign, const map::AreaMap& map);

	// A save loaded, and its map made again beside it, which the game holds for the campaign's screens.
	struct LoadedCampaign {
		Campaign	 campaign;
		map::AreaMap map;
	};

	// How the game opens a save: readCampaign's strict read, then the map made again from the origin, each stage replayed
	// once on the attempt that won it, unchecked, and checkCampaignMap against it. Attempts that don't fit the pipeline
	// (a stage missing or unknown, an attempt past a stage's own) throw a ContentError before any stage runs, and so does
	// a map that comes out with another fingerprint, which is what another build's generator makes. Takes as long as
	// founding's map, less its failed attempts.
	[[nodiscard]] LoadedCampaign
	loadCampaign(const nlohmann::json& json, const Content& content, const map::MapContent& mapContent, const MapMaking& making = {});

	// The map state as a route reads it today (map::routeOffers): the stops cleared and not back, each stop's roll, and
	// the game stage. Every leg reads as charted, as the map stands until it has its starting knowledge and fog, which
	// the charted legs will go over.
	[[nodiscard]] map::MapToday mapToday(const Campaign& campaign);

} // namespace rules::campaign
