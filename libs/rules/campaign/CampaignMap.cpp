#include "CampaignMap.h"

#include "CampaignJson.h"
#include "Events.h"
#include "RunDecks.h"

#include <rules/core/ContentError.h>
#include <rules/map/Ground.h>
#include <rules/map/RollParams.h>

#include <utils/Log.h>

#include <algorithm>
#include <cassert>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace rules::campaign {

	namespace {

		// FNV-1a over each value's bytes, little end first, so it's the same on every platform.
		class Fingerprint {
		  public:
			void add(int64_t value) {
				for (int byte = 0; byte < 8; ++byte) {
					mix(static_cast<uint8_t>(static_cast<uint64_t>(value) >> (8 * byte)));
				}
			}

			void add(std::string_view text) {
				add(static_cast<int64_t>(text.size()));
				for (const char letter : text) {
					mix(static_cast<uint8_t>(letter));
				}
			}

			void add(const std::vector<int>& ids) {
				add(static_cast<int64_t>(ids.size()));
				for (const int id : ids) {
					add(id);
				}
			}

			[[nodiscard]] uint64_t value() const { return hash; }

		  private:
			uint64_t hash{0xcbf29ce484222325ULL};

			void mix(uint8_t byte) {
				hash ^= byte;
				hash *= 0x100000001b3ULL;
			}
		};

		map::AreaMap remakeMap(const MapOrigin& origin, const map::MapContent& content, const MapMaking& making) {
			try {
				return map::generateAreaMap(
						   origin.params,
						   content,
						   {.onProgress = making.onProgress,
							.replay = map::PipelineReplay{.mapAttempt = origin.mapAttempt, .attempts = origin.stageAttempts},
							.cancel = making.cancel,
							.debug = making.debug}
				)
					.products;
			} catch (const std::invalid_argument& error) {
				throw ContentError(std::string("campaign.mapOrigin's attempts don't fit the map's stages: ") + error.what());
			}
		}

		void checkIds(const std::vector<int>& ids, std::string_view field, std::string_view what, size_t count) {
			for (size_t index = 0; index < ids.size(); ++index) {
				if (ids[index] < 0 || static_cast<size_t>(ids[index]) >= count) {
					throw ContentError(
						"campaign.mapState." + std::string(field) + "[" + std::to_string(index) + "] names " + std::string(what) + " " +
						std::to_string(ids[index]) + ", and the map has " + std::to_string(count)
					);
				}
			}
		}

		void insertSorted(std::vector<int>& ids, int id) {
			const auto at = std::ranges::lower_bound(ids, id);
			if (at == ids.end() || *at != id) {
				ids.insert(at, id);
			}
		}

		// The run's route is one the map has to a POI that isn't a stronghold, its legs that route's, every stop on them,
		// the leg it's on the next stop's, and what waits at the stop it's at one the stop can hold: a reward at a fight,
		// a Find: cards, or an event, and the fight an event turned into at an event.
		void checkRunRoute(const RunRoute& route, const map::PoiLayer& pois, const map::StopLayer& stops) {
			const std::string at = "campaign.run.route";
			if (static_cast<size_t>(route.poi) >= pois.pois.size()) {
				throw ContentError(
					at + ".poi names POI " + std::to_string(route.poi) + ", and the map has " + std::to_string(pois.pois.size())
				);
			}
			if (pois.pois[static_cast<size_t>(route.poi)].type == map::kStrongholdType) {
				throw ContentError(at + ".poi names POI " + std::to_string(route.poi) + ", a stronghold, which no run leaves for yet");
			}
			const std::vector<map::Route> routes = map::routesTo(pois.legs, route.poi);
			if (static_cast<size_t>(route.route) >= routes.size()) {
				throw ContentError(
					at + ".route names route " + std::to_string(route.route) + " of POI " + std::to_string(route.poi) + ", which has " +
					std::to_string(routes.size())
				);
			}
			if (route.legs != routes[static_cast<size_t>(route.route)].legs) {
				throw ContentError(at + ".legs aren't the legs of route " + std::to_string(route.route) + " on the map");
			}
			if (route.tier != pois.pois[static_cast<size_t>(route.poi)].tier) {
				throw ContentError(
					at + ".tier is " + std::to_string(route.tier) + ", and the POI's on the map is " +
					std::to_string(pois.pois[static_cast<size_t>(route.poi)].tier)
				);
			}
			for (size_t index = 0; index < route.stops.size(); ++index) {
				const int stop = route.stops[index];
				if (static_cast<size_t>(stop) >= stops.stops.size() ||
					std::ranges::find(route.legs, stops.stops[static_cast<size_t>(stop)].leg) == route.legs.end()) {
					throw ContentError(
						at + ".stops[" + std::to_string(index) + "] names stop " + std::to_string(stop) + ", which isn't on the route"
					);
				}
			}
			const size_t next = static_cast<size_t>(route.next);
			const auto	 on = next == route.stops.size()
								  ? route.legs.end()
								  : std::ranges::find(route.legs, stops.stops[static_cast<size_t>(route.stops[next])].leg);
			if (route.leg != on - route.legs.begin()) {
				throw ContentError(at + ".leg is " + std::to_string(route.leg) + ", and the run's next stop isn't on that leg");
			}
			if (next == route.stops.size()) {
				return;
			}
			const map::StopType type = stops.stops[static_cast<size_t>(route.stops[next])].type;
			if (!route.reward.empty() && !map::isFight(type) && type != map::StopType::FindCards && !resolvesAsEvent(type)) {
				throw ContentError(at + ".reward is on offer at a stop where nothing offers one");
			}
			if (route.handOff && !resolvesAsEvent(type)) {
				throw ContentError(at + ".handOff waits at a stop that isn't an event");
			}
		}

	} // namespace

	CampaignMap makeCampaignMap(uint32_t seed, const map::MapContent& content, const MapMaking& making) {
		for (int tried = 0;; ++tried) {
			const uint32_t		 onSeed = seed + static_cast<uint32_t>(tried);
			const map::MapParams params = map::rollParams(onSeed).params;
			try {
				map::PipelineResult<map::AreaMap> made = map::generateAreaMap(
					params, content, {.onProgress = making.onProgress, .cancel = making.cancel, .debug = making.debug}
				);
				MapOrigin origin{.params = params, .mapAttempt = made.mapAttempt, .stageAttempts = {}, .fingerprint = 0};
				for (const map::StageRecord& stage : made.stages) {
					origin.stageAttempts.emplace(stage.name, stage.attempt);
				}
				origin.fingerprint = mapFingerprint(made.products);
				return CampaignMap{.origin = std::move(origin), .map = std::move(made.products)};
			} catch (const map::MapPipelineError& error) {
				if (making.debug || error.exhausted != map::Exhausted::Map || tried + 1 == kFoundingSeeds) {
					throw;
				}
				// An error, since Release compiles warnings out and only a release build moves on.
				LOG_ERROR(Game, "makeCampaignMap: %s; founding on seed %u instead", error.what(), onSeed + 1);
			}
		}
	}

	uint64_t mapFingerprint(const map::AreaMap& map) {
		assert(map.pois && map.stops && "mapFingerprint: a made map, with its POIs and stops");
		Fingerprint			 print;
		const map::PoiLayer& pois = *map.pois;
		print.add(static_cast<int64_t>(pois.pois.size()));
		for (const map::Poi& poi : pois.pois) {
			print.add(poi.type);
			print.add(poi.ring);
			print.add(poi.tier);
			print.add(static_cast<int64_t>(poi.arrivals.size()));
			for (const map::Arrival& arrival : poi.arrivals) {
				print.add(arrival.from);
				print.add(arrival.stretch);
			}
		}
		print.add(static_cast<int64_t>(pois.strongholds.size()));
		for (const map::Stronghold& stronghold : pois.strongholds) {
			print.add(stronghold.poi);
			print.add(stronghold.faction);
			print.add(stronghold.sector);
		}
		print.add(static_cast<int64_t>(pois.legs.legs.size()));
		for (const map::Leg& leg : pois.legs.legs) {
			print.add(leg.parent);
			print.add(leg.from);
			print.add(leg.to);
			print.add(leg.destination);
			print.add(static_cast<int64_t>(leg.pieces.size()));
			for (const map::LegPiece& piece : leg.pieces) {
				print.add(piece.stretch);
				print.add(piece.forward ? 1 : 0);
			}
		}
		print.add(static_cast<int64_t>(pois.legs.lastLegs.size()));
		for (const std::vector<int>& lastLegs : pois.legs.lastLegs) {
			print.add(lastLegs);
		}
		const map::StopLayer& stops = *map.stops;
		print.add(static_cast<int64_t>(stops.stops.size()));
		for (const map::Stop& stop : stops.stops) {
			print.add(stop.leg);
			print.add(static_cast<int64_t>(stop.type));
			print.add(stop.skulls);
			print.add(stop.stage);
			print.add(static_cast<int64_t>(stop.roadClass));
			print.add(static_cast<int64_t>(stop.biome));
		}
		print.add(static_cast<int64_t>(stops.legs.size()));
		for (const map::LegStops& leg : stops.legs) {
			print.add(leg.stops);
			print.add(leg.extras);
			print.add(leg.tier);
			print.add(leg.territory);
		}
		print.add(stops.contentSeed);
		return print.value();
	}

	void checkCampaignMap(const Campaign& campaign, const map::AreaMap& map) {
		const uint64_t fingerprint = mapFingerprint(map);
		if (fingerprint != campaign.mapOrigin.fingerprint) {
			throw ContentError(
				"campaign.mapOrigin.fingerprint is " + fingerprintText(campaign.mapOrigin.fingerprint) +
				", and the map its params and attempts make is " + fingerprintText(fingerprint) +
				": the attempts aren't the ones that won, or another build's generator made the map"
			);
		}
		const map::PoiLayer& pois = *map.pois;
		const MapState&		 state = campaign.mapState;
		checkIds(state.clearedPois, "clearedPois", "POI", pois.pois.size());
		checkIds(state.chartedLegs, "chartedLegs", "leg", pois.legs.legs.size());
		checkIds(state.strongholdsTaken, "strongholdsTaken", "POI", pois.pois.size());
		for (size_t index = 0; index < state.strongholdsTaken.size(); ++index) {
			if (std::ranges::find(pois.strongholds, state.strongholdsTaken[index], &map::Stronghold::poi) == pois.strongholds.end()) {
				throw ContentError(
					"campaign.mapState.strongholdsTaken[" + std::to_string(index) + "] names POI " +
					std::to_string(state.strongholdsTaken[index]) + ", which isn't a stronghold"
				);
			}
		}
		std::vector<int> stops;
		for (const StopState& stop : state.stops) {
			stops.push_back(stop.stop);
		}
		checkIds(stops, "stops", "stop", map.stops->stops.size());
		if (campaign.run && campaign.run->route) {
			checkRunRoute(*campaign.run->route, pois, *map.stops);
		}
	}

	LoadedCampaign
	loadCampaign(const nlohmann::json& json, const Content& content, const map::MapContent& mapContent, const MapMaking& making) {
		Campaign	 campaign = readCampaign(json, content);
		map::AreaMap map = remakeMap(campaign.mapOrigin, mapContent, making);
		checkCampaignMap(campaign, map);
		return LoadedCampaign{.campaign = std::move(campaign), .map = std::move(map)};
	}

	MapLayers layersOf(const map::AreaMap& map, const MapOrigin& origin, const map::MapContent& content, const map::RouteTuning& routes) {
		assert(map.roads && map.places && map.pois && map.stops && "layersOf: a made map");
		const map::Ground ground(*map.terrain, *map.water, *map.hazards);
		return MapLayers{
			.network = map.roads->network(),
			.places = *map.places,
			.pois = *map.pois,
			.stops = *map.stops,
			.biomeAt = [ground](map::Point at) { return ground.biome(at.x, at.y); },
			.params = origin.params,
			.content = content,
			.routes = routes,
		};
	}

	void clearStop(MapState& state, int stop, int day) {
		const auto at = std::ranges::lower_bound(state.stops, stop, {}, &StopState::stop);
		if (at != state.stops.end() && at->stop == stop) {
			at->cleared = day;
			return;
		}
		state.stops.insert(at, StopState{.stop = stop, .roll = 0, .cleared = day});
	}

	void clearPoi(MapState& state, int poi) {
		insertSorted(state.clearedPois, poi);
	}

	void chartLeg(MapState& state, int leg) {
		insertSorted(state.chartedLegs, leg);
	}

	map::MapToday mapToday(const Campaign& campaign) {
		map::MapToday today{.legs = {}, .cleared = {}, .rolls = {}, .gameStage = gameStage(campaign)};
		for (const StopState& stop : campaign.mapState.stops) {
			if (stop.cleared) {
				today.cleared.insert(stop.stop);
			}
			if (stop.roll > 0) {
				today.rolls.emplace(stop.stop, stop.roll);
			}
		}
		return today;
	}

} // namespace rules::campaign
