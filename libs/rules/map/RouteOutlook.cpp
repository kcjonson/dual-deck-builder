#include "RouteOutlook.h"

#include <algorithm>
#include <cassert>
#include <cstddef>

namespace rules::map {

	std::vector<int> stopsAtStage(const LegStops& leg, const StopLayer& layer, int gameStage) {
		std::vector<int> ids = leg.stops;
		for (const int id : leg.extras) {
			if (layer.stops[static_cast<size_t>(id)].stage <= gameStage) {
				ids.push_back(id);
			}
		}
		// Ids run in driving order along a leg, extras among the rest.
		std::ranges::sort(ids);
		return ids;
	}

	RouteOutlook outlookOf(const OutlookArgs& args) {
		const MapToday& today = args.today;
		assert(
			(today.legs.empty() || today.legs.size() == args.routeLegs.legs.size()) && "outlookOf: what's known of every leg, or of none"
		);
		RouteOutlook outlook;
		double		 stopHours = 0;
		bool		 nextShown = false;
		for (const int leg : args.route.legs) {
			const LegKnowledge known = today.legs.empty() ? LegKnowledge::Charted : today.legs[static_cast<size_t>(leg)];
			// Past the first uncharted leg nothing is known but a direction and the next stop.
			const LegKnowledge state = outlook.knowledge == LegKnowledge::Uncharted ? LegKnowledge::Uncharted : known;
			outlook.knowledge = std::min(outlook.knowledge, state);
			const std::vector<int> ids = stopsAtStage(args.stops.legs[static_cast<size_t>(leg)], args.stops, today.gameStage);
			const auto			   shown = [&](int id, bool typed) {
				const Stop& stop = args.stops.stops[static_cast<size_t>(id)];
				outlook.stops.push_back({
								.stop = id,
								.leg = leg,
								.at = stop.at,
								.type = typed ? std::optional(stop.type) : std::nullopt,
								.skulls = typed ? stop.skulls : 0,
								.cleared = today.cleared.contains(id),
				});
			};
			if (state == LegKnowledge::Charted) {
				for (const int id : ids) {
					shown(id, true);
					stopHours += args.tuning.types[static_cast<size_t>(args.stops.stops[static_cast<size_t>(id)].type)].hours;
				}
			} else if (state == LegKnowledge::Rumored) {
				for (const int id : ids) {
					shown(id, false);
				}
				stopHours += static_cast<double>(ids.size()) * args.tuning.unknownStopHours;
			} else {
				if (!nextShown && !ids.empty()) {
					shown(ids.front(), false);
					nextShown = true;
				}
				const Leg& held = args.routeLegs.legs[static_cast<size_t>(leg)];
				stopHours += legEarns(args.network, held, args.params.stopDensity, args.tuning) * args.tuning.unknownStopHours;
			}
		}
		outlook.hours = {.out = args.route.hours + stopHours, .objective = args.objectiveHours, .home = args.route.hours};
		outlook.back = args.tuning.dawn + outlook.hours.out + outlook.hours.objective + outlook.hours.home;
		outlook.dark = args.tuning.dawn + args.params.daylightHours;
		outlook.spare = outlook.dark - outlook.back;
		for (const KnownStop& stop : outlook.stops) {
			if (stop.type && isFight(*stop.type) && !stop.cleared) {
				outlook.risk = std::max(outlook.risk, stop.skulls);
			}
		}
		outlook.estimated = outlook.knowledge != LegKnowledge::Charted;
		return outlook;
	}

} // namespace rules::map
