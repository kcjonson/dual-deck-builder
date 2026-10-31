#pragma once

// Shared by the campaign tests: the base pack's campaign rules, and a campaign founded on them.

#include <rules/battle/BattleTesting.h>
#include <rules/campaign/CampaignMap.h>
#include <rules/campaign/CampaignRules.h>
#include <rules/campaign/Founding.h>
#include <rules/map/MapTesting.h>
#include <rules/map/ParamValidator.h>

#include <algorithm>
#include <cassert>
#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace rules::campaigns {

	using namespace rules::campaign;
	using fights::testContent;

	inline const CampaignRules& testRules() {
		static const CampaignRules rules = loadCampaignRules(testContent());
		return rules;
	}

	// Each of the area map's stages on its first attempt, by name.
	inline std::map<std::string, uint32_t, std::less<>> firstAttempts() {
		std::map<std::string, uint32_t, std::less<>> attempts;
		for (const std::string_view stage : {"terrain", "water", "hazards", "places", "roads", "routeTree", "pois", "stops"}) {
			attempts.emplace(std::string(stage), 0);
		}
		return attempts;
	}

	// Where a map on `seed` would come from, without making one, for the tests about everything but the map: the
	// table's defaults on the seed, every stage on its first attempt, and a fingerprint of 0. loadCampaign refuses it.
	inline MapOrigin stubOrigin(uint32_t seed) {
		return MapOrigin{
			.params = map::validateMapParams(map::environmentDefaults(seed, map::Environment::Mixed)).params,
			.mapAttempt = 0,
			.stageAttempts = firstAttempts(),
			.fingerprint = 0,
		};
	}

	// Founded on the base pack's start and a stub map on `seed`, with `escorts` hired as starters, in roster order.
	inline Campaign foundTestCampaign(std::vector<std::string_view> escorts = {}, uint32_t seed = 7) {
		CampaignRules rules = testRules();
		for (const std::string_view escort : escorts) {
			rules.start.escorts.push_back(EscortId{std::string(escort)});
		}
		return foundCampaign(testContent(), rules, Founding{.map = stubOrigin(seed), .unlocked = unlockedAtStart(testContent())});
	}

	// A made map without making one: the map tests' POIs and stops for fixtures::mixed(), each stage on its first
	// attempt, which is the map the pipeline makes of those params (AreaMapPipeline.slow.test.cpp holds it). They're
	// all the campaign reads of a map so far, and the fast lane has the roads under them already.
	inline const CampaignMap& testMap() {
		static const CampaignMap made = [] {
			map::AreaMap areaMap;
			areaMap.pois = map::fixtures::poisFor(map::fixtures::mixed());
			areaMap.stops = map::fixtures::stopsFor(map::fixtures::mixed());
			const MapOrigin origin{
				.params = map::fixtures::mixed(),
				.mapAttempt = 0,
				.stageAttempts = firstAttempts(),
				.fingerprint = mapFingerprint(areaMap),
			};
			return CampaignMap{.origin = origin, .map = std::move(areaMap)};
		}();
		return made;
	}

	// Founded on testMap(), on its seed.
	inline Campaign foundOnTestMap() {
		return foundCampaign(testContent(), testRules(), Founding{.map = testMap().origin, .unlocked = unlockedAtStart(testContent())});
	}

	// The first driver in the pool of an archetype.
	inline CrewId crewOf(const Campaign& campaign, std::string_view archetype) {
		const auto found = std::ranges::find(campaign.drivers, DriverId{std::string(archetype)}, &DriverRecord::archetype);
		assert(found != campaign.drivers.end() && "crewOf: the pool has a driver of that archetype");
		return found->id;
	}

	inline CardId card(std::string_view id) {
		return CardId{std::string(id)};
	}

} // namespace rules::campaigns
