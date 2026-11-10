#include "scenes/map/Planning.h"

#include "Words.h"

#include <rules/campaign/SupplyRun.h>
#include <rules/map/LandFog.h>
#include <rules/map/PoiNames.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <map>
#include <string_view>

namespace game {

	namespace {

		using rules::map::RouteOffer;

		// Each type's letter (area-map-atlas-style.md, Visual calls 9), unique case-insensitively.
		const std::map<std::string, std::string, std::less<>>& glyphs() {
			static const std::map<std::string, std::string, std::less<>> letters{
				{"hospital", "H"},
				{"clinic", "C"},
				{"school", "S"},
				{"store", "G"},
				{"mall", "M"},
				{"waterPlant", "W"},
				{"fuelDepot", "F"},
				{"truckStop", "T"},
				{"quarry", "Q"},
				{"mine", "X"},
				{"farm", "B"},
				{"silo", "O"},
				{"salvageYard", "J"},
			};
			return letters;
		}

		double quickestOut(const Destination& destination) {
			return destination.routes.empty() ? std::numeric_limits<double>::infinity() : destination.routes.front().outlook.hours.out;
		}

		// A space that doesn't break, so a route's facts wrap only between them.
		constexpr std::string_view kNoBreak = "\xC2\xA0";

		std::string unbroken(std::string words) {
			std::string out;
			for (const char letter : words) {
				if (letter == ' ') {
					out += kNoBreak;
				} else {
					out += letter;
				}
			}
			return out;
		}

	} // namespace

	bool Destination::homeByDark() const {
		return routes.empty() || std::ranges::any_of(routes, [](const RouteOffer& offer) { return offer.outlook.spare >= 0.0; });
	}

	const Destination* Planning::find(int poi) const {
		const auto found = std::ranges::find(destinations, poi, &Destination::poi);
		return found == destinations.end() ? nullptr : &*found;
	}

	Planning planning(const Session& session) {
		const rules::campaign::MapLayers& layers = session.layers();
		const rules::campaign::Campaign&  campaign = session.campaign;
		const rules::map::KnowledgeArgs	  args{
			  .network = layers.network,
			  .pois = layers.pois,
			  .params = layers.params,
			  .tuning = layers.content.knowledge,
		  };
		Planning planned{.knowledge = rules::map::startingKnowledge(args), .destinations = {}, .explored = 0};
		for (const int leg : campaign.mapState.chartedLegs) {
			rules::map::driveLeg(planned.knowledge, args, leg);
		}
		for (const int poi : campaign.mapState.clearedPois) {
			rules::map::reachPoi(planned.knowledge, args, poi);
		}
		planned.explored = rules::map::exploredShare(planned.knowledge.land);

		std::map<int, std::vector<RouteOffer>> offers;
		for (RouteOffer& offer : rules::campaign::offersToday(campaign, layers)) {
			offers[offer.destination.poi].push_back(std::move(offer));
		}
		const std::vector<std::string> names = rules::map::poiNames(
			layers.pois, layers.places, layers.content.pois, layers.content.factions, static_cast<double>(layers.params.radius)
		);
		const std::vector<rules::map::Poi>& pois = layers.pois.pois;
		for (size_t index = 0; index < pois.size(); ++index) {
			const int poi = static_cast<int>(index);
			if (!rules::map::isFound(planned.knowledge, args, poi)) {
				continue;
			}
			const rules::map::Poi& site = pois[index];
			Destination			   destination{
						   .poi = poi,
						   .name = names[index],
						   .kind = "Stronghold",
						   .glyph = {},
						   .tier = site.tier,
						   .stronghold = site.type == rules::map::kStrongholdType,
						   .cleared = std::ranges::find(campaign.mapState.clearedPois, poi) != campaign.mapState.clearedPois.end(),
						   .yields = {},
						   .routes = {},
			   };
			if (!destination.stronghold) {
				const auto type = layers.content.pois.types.find(site.type);
				if (type == layers.content.pois.types.end()) {
					throw std::logic_error("planning: a POI of a type the pack doesn't have, " + site.type);
				}
				destination.kind = type->second.label;
				destination.yields = type->second.yields;
				const auto letter = glyphs().find(site.type);
				destination.glyph = letter == glyphs().end() ? std::string() : letter->second;
			}
			if (const auto found = offers.find(poi); found != offers.end()) {
				destination.routes = std::move(found->second);
				std::ranges::stable_sort(destination.routes, {}, [](const RouteOffer& offer) { return offer.outlook.hours.out; });
			}
			planned.destinations.push_back(std::move(destination));
		}
		std::ranges::stable_sort(planned.destinations, [](const Destination& a, const Destination& b) {
			if (a.stronghold != b.stronghold) {
				return b.stronghold;
			}
			if (a.tier != b.tier) {
				return a.tier < b.tier;
			}
			return quickestOut(a) < quickestOut(b);
		});
		return planned;
	}

	std::optional<std::string> planBlocker(const rules::campaign::Campaign& campaign, const Destination& destination) {
		if (campaign.end) {
			return "The campaign is over.";
		}
		if (campaign.run) {
			return "A run is out, and only one goes at a time.";
		}
		if (destination.cleared) {
			return "A run cleared it. Nothing's left there to take.";
		}
		if (destination.stronghold) {
			return "Not yet: taking a stronghold isn't in the alpha.";
		}
		if (destination.routes.empty()) {
			return "No road reaches it.";
		}
		return std::nullopt;
	}

	std::string yieldsText(const std::array<int, 5>& yields) {
		std::string text;
		for (size_t resource = 0; resource < yields.size(); ++resource) {
			if (yields[resource] > 0) {
				text += (text.empty() ? "" : ", ") + std::to_string(yields[resource]) + " " +
						std::string(nameOf(rules::map::kResourceNames, static_cast<rules::map::Resource>(resource)));
			}
		}
		if (const size_t last = text.rfind(", "); last != std::string::npos) {
			text.replace(last, 2, " and ");
		}
		return text.empty() ? "nothing" : text;
	}

	std::string stopTag(rules::map::StopType type) {
		using rules::map::StopType;
		switch (type) {
			case StopType::Ambush:
			case StopType::Warband:
				return "FIGHT";
			case StopType::Checkpoint:
				return "CHECKPOINT";
			case StopType::Wreck:
				return "WRECK";
			case StopType::Distress:
				return "DISTRESS";
			case StopType::Garage:
				return "GARAGE";
			case StopType::Hazard:
				return "HAZARD";
			case StopType::FindDriver:
			case StopType::FindSettlers:
			case StopType::FindVehicle:
			case StopType::FindCards:
			case StopType::FindSupplies:
				return "FIND";
		}
		return "STOP";
	}

	std::string hoursText(double hours) {
		std::array<char, 32> written{};
		std::snprintf(written.data(), written.size(), "%.1f h", std::round(hours * 10.0) / 10.0);
		return written.data();
	}

	std::string clockText(double hourOfDay) {
		const bool			 nextDay = hourOfDay >= 24.0;
		const int			 minutes = static_cast<int>(std::lround(std::fmod(std::max(0.0, hourOfDay), 24.0) * 60.0)) % (24 * 60);
		std::array<char, 16> written{};
		std::snprintf(written.data(), written.size(), "%02d:%02d", minutes / 60, minutes % 60);
		return std::string(written.data()) + (nextDay ? " the next morning" : "");
	}

	std::string routeFacts(const RouteOffer& offer) {
		static constexpr std::array<const char*, 3> kKnowledge{"uncharted", "rumored", "charted"};
		const rules::map::RouteOutlook&				outlook = offer.outlook;
		const std::string							hours = (outlook.estimated ? "about " : "") + hoursText(outlook.hours.out) + " out";
		const std::string							parts[] = {
			  kKnowledge.at(static_cast<size_t>(outlook.knowledge)),
			  counted(static_cast<int>(outlook.stops.size()), "stop", "stops"),
			  hours,
			  "fuel " + std::to_string(offer.route.fuel),
			  "risk " + std::to_string(offer.risk) + " of 3",
		  };
		std::string text;
		for (const std::string& part : parts) {
			text += (text.empty() ? "" : " / ") + unbroken(part);
		}
		return text;
	}

} // namespace game
