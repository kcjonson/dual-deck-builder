#include "Stops.h"

#include "StopRoom.h"
#include "StopRules.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <functional>
#include <optional>
#include <set>
#include <string>
#include <utility>

namespace rules::map {

	namespace {

		// Passes of the daylight check at most, each over every POI it covers: a Find: driver moved off one route can tip
		// another's past dark, which a pass or two more settles.
		constexpr int kDaylightPasses = 4;
		// Halvings the search for a leg's gap takes between tightGap and minGap.
		constexpr int kGapSteps = 16;

		// Which calm stops turn into a Find: driver first: events, then hazards and garages, then the other finds.
		int turnOrder(StopType type) {
			switch (type) {
				case StopType::Wreck:
				case StopType::Distress:
					return 0;
				case StopType::Hazard:
					return 1;
				case StopType::Garage:
					return 2;
				case StopType::Checkpoint:
					return 3;
				case StopType::FindSettlers:
				case StopType::FindVehicle:
				case StopType::FindCards:
				case StopType::FindSupplies:
					return 4;
				case StopType::Ambush:
				case StopType::Warband:
					return 5;
				case StopType::FindDriver:
					return 6;
			}
			return 6;
		}

		// Ranks a stop on a leg that already has a Find: driver after every one on a leg that hasn't.
		constexpr int kTurnGroups = 7;

		// How many fights a run of stops holds with a non-fight in any three.
		int fightRoom(int count) {
			return count - count / 3;
		}

		// A route through a leg: its POI, its place among the POI's routes, and the leg's place along it.
		struct Through {
			int poi{0};
			int route{0};
			int place{0};
		};

		// A stop by its leg and its place among the leg's stops.
		struct StopAt {
			int	   leg{0};
			size_t index{0};
		};

		struct Gap {
			int	   leg{0};
			double along{0};
		};

		class StopPlacer {
		  public:
			explicit StopPlacer(const StopArgs& placing)
				: args(placing),
				  tuning(placing.tuning),
				  legs(placing.pois.legs.legs),
				  tiers(legTiers(placing.pois)),
				  territory(placing.tables.territory(kNoTerritory)),
				  routesOn(placing.pois.legs.legs.size()),
				  placed(placing.pois.legs.legs.size()) {
				for (size_t poi = 0; poi < args.pois.pois.size(); ++poi) {
					const int tier = args.pois.pois[poi].tier;
					routes.push_back(routesTo(args.pois.legs, static_cast<int>(poi)));
					bands.push_back(bandFor(tier, tuning));
					needs.push_back(ownRoadNeed(tier, tuning));
					for (size_t route = 0; route < routes.back().size(); ++route) {
						const std::vector<int>& along = routes.back()[route].legs;
						for (size_t place = 0; place < along.size(); ++place) {
							routesOn[static_cast<size_t>(along[place])].push_back(
								{.poi = static_cast<int>(poi), .route = static_cast<int>(route), .place = static_cast<int>(place)}
							);
						}
					}
				}
				owners = legOwners(legs.size(), routes);
				const std::vector<int> degrees = nodeDegrees(args.network);
				std::set<int>		   lastLegs;
				for (const std::vector<int>& last : args.pois.legs.lastLegs) {
					lastLegs.insert(last.begin(), last.end());
				}
				const int extras = static_cast<int>(tuning.extras.size());
				for (size_t id = 0; id < legs.size(); ++id) {
					const Leg& leg = legs[id];
					joins.push_back(junctionsAlong(args.network, leg, degrees));
					rooms.push_back(legRoom(leg.length, joins.back(), tuning.tightGap, tuning));
					bandRooms.push_back(lastLegs.contains(static_cast<int>(id)) ? std::max(rooms.back() - extras, 0) : rooms.back());
					lines.push_back(legPoints(args.network, leg));
					earns.push_back(legEarns(args.network, leg, args.params.stopDensity, tuning));
				}
			}

			StopLayer place() {
				std::vector<foundation::Rng> streams;
				std::vector<double>			 countDraws;
				std::vector<double>			 fightDraws;
				for (size_t id = 0; id < legs.size(); ++id) {
					foundation::Rng& stream = streams.emplace_back(args.stream.fork("leg", id));
					countDraws.push_back(stream.nextDouble());
					fightDraws.push_back(stream.nextDouble());
				}
				const std::vector<int>			   counts = allocateCounts(countDraws);
				const std::vector<int>			   extras = allocateExtras(counts);
				const std::vector<int>			   fights = allocateFights(counts, fightDraws);
				std::vector<std::vector<StopType>> tails(legs.size());
				for (size_t id = 0; id < legs.size(); ++id) {
					const int					 parent = legs[id].parent;
					const std::vector<StopType>& behind = parent < 0 ? kNoStops : tails[static_cast<size_t>(parent)];
					placeOnLeg(id, streams[id], behind, counts[id], fights[id], extras[id]);
					std::vector<StopType> tail = behind;
					for (const Stop& stop : placed[id]) {
						if (stop.stage == 0) {
							tail.push_back(stop.type);
						}
					}
					tails[id].assign(tail.end() - static_cast<std::ptrdiff_t>(std::min<size_t>(tail.size(), 2)), tail.end());
				}
				findDrivers();
				daylight();
				topUp();
				foundation::Rng rates = args.stream.fork("rates");
				keepRates(rates);
				reportShortfalls();
				return layer();
			}

		  private:
			inline static const std::vector<StopType> kNoStops{};

			const StopArgs&					  args;
			const StopTuning&				  tuning;
			const std::vector<Leg>&			  legs;
			std::vector<int>				  tiers;
			int								  territory{0};
			std::vector<std::vector<Route>>	  routes;
			std::vector<StopBand>			  bands;
			std::vector<int>				  needs;
			std::vector<std::vector<Through>> routesOn;
			std::vector<int>				  owners;
			std::vector<std::vector<double>>  joins;
			// Each leg's room at the tight gap, and its room for its band's stops: a route's own last leg keeps room
			// for its dormant extras back.
			std::vector<int>				rooms;
			std::vector<int>				bandRooms;
			std::vector<std::vector<Point>> lines;
			std::vector<double>				earns;
			// Each leg's stops, extras among them, in driving order.
			std::vector<std::vector<Stop>> placed;
			std::vector<std::string>	   failures;
			int							   thinned{0};

			[[nodiscard]] const Route& routeOf(const Through& through) const {
				return routes[static_cast<size_t>(through.poi)][static_cast<size_t>(through.route)];
			}

			[[nodiscard]] bool owns(int poi, int leg) const { return owners[static_cast<size_t>(leg)] == poi; }

			// Each leg's stops, parents first. A leg starts from what its road earns, rounded by its draw, clamped from
			// above by its room and by the tightest route through it, which keeps back what its own road still has to
			// hold, and from below by the loosest route's band minimum, less the room past this leg, and on a route's own
			// road by its need, less the own road past it. A route's own last leg keeps room for its dormant extras back
			// from everything but that need. Where the bounds cross, the upper wins and the route falls short of its
			// band, which the shortfalls report.
			std::vector<int> allocateCounts(const std::vector<double>& draws) const {
				std::vector<int> counts(legs.size());
				std::vector<int> behind(legs.size());
				for (size_t id = 0; id < legs.size(); ++id) {
					const int parent = legs[id].parent;
					behind[id] = parent < 0 ? 0 : behind[static_cast<size_t>(parent)] + counts[static_cast<size_t>(parent)];
					const int earned = static_cast<int>(std::floor(earns[id] + draws[id]));
					int		  upper = rooms[id];
					int		  lower = 0;
					int		  ownLower = 0;
					for (const Through& through : routesOn[id]) {
						const std::vector<int>& along = routeOf(through).legs;
						const IntRange&			band = bands[static_cast<size_t>(through.poi)].stops;
						int						roomAfter = 0;
						int						ownRoomAfter = 0;
						int						ownBehind = 0;
						for (size_t at = static_cast<size_t>(through.place) + 1; at < along.size(); ++at) {
							roomAfter += bandRooms[static_cast<size_t>(along[at])];
							ownRoomAfter += owns(through.poi, along[at]) ? rooms[static_cast<size_t>(along[at])] : 0;
						}
						for (size_t at = 0; at < static_cast<size_t>(through.place); ++at) {
							ownBehind += owns(through.poi, along[at]) ? counts[static_cast<size_t>(along[at])] : 0;
						}
						const int  ownLeft = std::max(needs[static_cast<size_t>(through.poi)] - ownBehind, 0);
						const bool own = owns(through.poi, static_cast<int>(id));
						upper = std::min(upper, band.max - behind[id] - (own ? 0 : std::min(ownLeft, ownRoomAfter)));
						lower = std::max(lower, band.min - behind[id] - roomAfter);
						if (own) {
							ownLower = std::max(ownLower, ownLeft - ownRoomAfter);
						}
					}
					upper = std::max(std::min(upper, std::max(bandRooms[id], ownLower)), 0);
					lower = std::max(lower, ownLower);
					counts[id] = lower > upper ? upper : std::clamp(earned, lower, upper);
				}
				return counts;
			}

			// Up to one dormant calm extra a game stage in the tuning's, on each route's own last leg, where it has room
			// past its stops.
			std::vector<int> allocateExtras(const std::vector<int>& counts) const {
				std::vector<int> extras(legs.size());
				const int		 most = static_cast<int>(tuning.extras.size());
				for (const std::vector<int>& last : args.pois.legs.lastLegs) {
					for (const int leg : last) {
						extras[static_cast<size_t>(leg)] =
							std::clamp(rooms[static_cast<size_t>(leg)] - counts[static_cast<size_t>(leg)], 0, most);
					}
				}
				return extras;
			}

			// Each leg's fights, as its stops are: its stops times the share of fights in its routes' bands, the least of
			// them, rounded by its draw (call 19), clamped from above by the tightest route's fight ceiling, keeping its
			// floor back for its own road, and from below on a route's own road by the floor it still needs. A leg no
			// single POI owns keeps a calm stop, so a route's floor fights can follow it without three in a row.
			std::vector<int> allocateFights(const std::vector<int>& counts, const std::vector<double>& draws) const {
				std::vector<int> fights(legs.size());
				std::vector<int> behind(legs.size());
				for (size_t id = 0; id < legs.size(); ++id) {
					const int parent = legs[id].parent;
					behind[id] = parent < 0 ? 0 : behind[static_cast<size_t>(parent)] + fights[static_cast<size_t>(parent)];
					const int count = counts[id];
					if (count == 0) {
						continue;
					}
					int	   upper = owners[id] < 0 ? count - 1 : fightRoom(count);
					int	   lower = 0;
					double share = 1;
					for (const Through& through : routesOn[id]) {
						const std::vector<int>& along = routeOf(through).legs;
						const StopBand&			band = bands[static_cast<size_t>(through.poi)];
						share = std::min(
							share,
							static_cast<double>(band.fights.min + band.fights.max) / static_cast<double>(band.stops.min + band.stops.max)
						);
						int ownStopsAfter = 0;
						int ownBehind = 0;
						for (size_t at = static_cast<size_t>(through.place) + 1; at < along.size(); ++at) {
							ownStopsAfter += owns(through.poi, along[at]) ? fightRoom(counts[static_cast<size_t>(along[at])]) : 0;
						}
						for (size_t at = 0; at < static_cast<size_t>(through.place); ++at) {
							ownBehind += owns(through.poi, along[at]) ? fights[static_cast<size_t>(along[at])] : 0;
						}
						const int  floorLeft = std::max(band.fights.min - ownBehind, 0);
						const bool own = owns(through.poi, static_cast<int>(id));
						upper = std::min(upper, band.fights.max - behind[id] - (own ? 0 : std::min(floorLeft, ownStopsAfter)));
						if (own) {
							lower = std::max(lower, floorLeft - ownStopsAfter);
						}
					}
					upper = std::max(upper, 0);
					const int earned = static_cast<int>(std::floor(count * share + draws[id]));
					fights[id] = lower > upper ? upper : std::clamp(earned, lower, upper);
				}
				return fights;
			}

			// A leg's stops: which are fights (arrange), and where they stand, each in a slot of its own along the leg,
			// clear of the ends and of junctions and a gap apart, the widest gap from minGap down to tightGap the leg has
			// room for, at the nearest such point to where its draw aims it, or packed from the inner end where a slot has
			// none; then each one's type. Its extras take slots spread among the rest. Three draws a stop.
			void placeOnLeg(size_t id, foundation::Rng& stream, const std::vector<StopType>& behind, int count, int fights, int extras) {
				const int total = count + extras;
				if (total == 0) {
					return;
				}
				struct Draws {
					double target{0};
					double type{0};
					double skulls{0};
				};
				std::vector<Draws> draws;
				for (int index = 0; index < total; ++index) {
					const double target = stream.nextDouble();
					const double type = stream.nextDouble();
					draws.push_back({.target = target, .type = type, .skulls = stream.nextDouble()});
				}
				const double		length = legs[id].length;
				const double		gap = gapFor(id, total);
				const double		ends = legEnds(length, tuning);
				const double		slot = (length - 2 * ends) / total;
				const double		clear = tuning.clearance.junctions;
				std::vector<double> alongs;
				for (int index = 0; index < total; ++index) {
					const double start = ends + index * slot;
					const double target = start + (0.5 + (draws[static_cast<size_t>(index)].target - 0.5) * tuning.jitter) * slot;
					const double from = !alongs.empty() && alongs.back() + gap > start ? alongs.back() + gap : start;
					const std::optional<double> along = nearestClear(target, from, start + slot, joins[id], clear);
					if (!along) {
						break;
					}
					alongs.push_back(*along);
				}
				if (std::cmp_less(alongs.size(), total)) {
					const LegSpan span = legSpan(length, gap, tuning);
					alongs = packAlong(span.from, span.to, gap, joins[id], clear, static_cast<size_t>(total));
				}
				assert(std::cmp_equal(alongs.size(), total) && "placeStops: a leg has room for the stops it's dealt");
				std::set<int> extraSlots;
				for (int extra = 0; extra < extras; ++extra) {
					extraSlots.insert((extra + 1) * total / (extras + 1));
				}
				const std::vector<bool> pattern = arrange({.behind = behind, .count = count, .fights = fights, .shared = owners[id] < 0});
				size_t					active = 0;
				size_t					extra = 0;
				for (size_t index = 0; index < alongs.size(); ++index) {
					Stop	   stop = stopAt(static_cast<int>(id), alongs[index]);
					const bool isExtra = extraSlots.contains(static_cast<int>(index));
					const bool fight = !isExtra && pattern[active];
					stop.type = args.tables.draw(stop.roadClass, stop.biome, tiers[id], territory, draws[index].type, fight);
					stop.skulls = skullsFor(stop.type, tiers[id], draws[index].skulls);
					stop.stage = isExtra ? tuning.extras[extra] : 0;
					extra += isExtra ? 1 : 0;
					active += isExtra ? 0 : 1;
					placed[id].push_back(stop);
				}
			}

			// The widest gap from minGap down to tightGap at which a leg has room for this many stops.
			[[nodiscard]] double gapFor(size_t id, int count) const {
				const auto fits = [&](double gap) {
					return legRoom(legs[id].length, joins[id], gap, tuning) >= count;
				};
				if (fits(tuning.minGap)) {
					return tuning.minGap;
				}
				double low = tuning.tightGap;
				double high = tuning.minGap;
				for (int step = 0; step < kGapSteps; ++step) {
					const double middle = (low + high) / 2;
					(fits(middle) ? low : high) = middle;
				}
				return low;
			}

			// A stop from game stage 0 at a point along a leg, typed later: the class and biome there.
			[[nodiscard]] Stop stopAt(int leg, double along) const {
				const Leg& held = legs[static_cast<size_t>(leg)];
				RoadClass  roadClass = args.network.stretches[static_cast<size_t>(held.pieces.back().stretch)].roadClass;
				double	   passed = 0;
				for (const LegPiece& piece : held.pieces) {
					passed += piece.length;
					if (along <= passed) {
						roadClass = args.network.stretches[static_cast<size_t>(piece.stretch)].roadClass;
						break;
					}
				}
				const Point point = pointAlong(lines[static_cast<size_t>(leg)], along);
				return {
					.leg = leg,
					.along = along,
					.at = 0,
					.point = point,
					.type = StopType::Wreck,
					.skulls = 0,
					.roadClass = roadClass,
					.biome = args.biomeAt(point),
					.stage = 0,
				};
			}

			// 1 at tier 1, rising by the step a tier times dangerCurve, rounded by a draw, a warband's raised, at most 3
			// (call 5); 0 for anything but a fight.
			[[nodiscard]] int skullsFor(StopType type, int tier, double draw) const {
				if (!isFight(type)) {
					return 0;
				}
				const int level = static_cast<int>(std::floor(1 + (tier - 1) * tuning.skulls.step * args.params.dangerCurve + draw)) +
								  (type == StopType::Warband ? tuning.skulls.warband : 0);
				return std::clamp(level, 1, 3);
			}

			void insert(Stop stop) {
				std::vector<Stop>& stops = placed[static_cast<size_t>(stop.leg)];
				const auto		   at = std::ranges::find_if(stops, [&](const Stop& other) { return other.along > stop.along; });
				stops.insert(at, stop);
			}

			// The stops on from game stage 0 on legs of the tiers it holds.
			[[nodiscard]] std::vector<StopAt> stopsIn(const std::function<bool(int)>& tierHolds) const {
				std::vector<StopAt> stops;
				for (size_t leg = 0; leg < placed.size(); ++leg) {
					if (!tierHolds(tiers[leg])) {
						continue;
					}
					for (size_t index = 0; index < placed[leg].size(); ++index) {
						if (placed[leg][index].stage == 0) {
							stops.push_back({.leg = static_cast<int>(leg), .index = index});
						}
					}
				}
				return stops;
			}

			[[nodiscard]] Stop&		  stopOf(const StopAt& at) { return placed[static_cast<size_t>(at.leg)][at.index]; }
			[[nodiscard]] const Stop& stopOf(const StopAt& at) const { return placed[static_cast<size_t>(at.leg)][at.index]; }

			[[nodiscard]] int countFinds(const std::vector<StopAt>& stops) const {
				return static_cast<int>(std::ranges::count_if(stops, [&](const StopAt& at) {
					return stopOf(at).type == StopType::FindDriver;
				}));
			}

			// Find: driver: in every tier, at least its rate of the tier's stops, rounded down; across the floor's tiers,
			// at least driverFinds, adding stops where the legs there hold too few calm stops to turn (call 6). Each is a
			// calm stop turned, never a fight or a dormant extra, so the per-route rules hold.
			void findDrivers() {
				foundation::Rng stream = args.stream.fork("finds");
				keepRates(stream);
				if (legs.empty()) {
					return;
				}
				const int  floorTiers = tuning.driverFinds.floorTiers;
				const auto inFloor = [floorTiers](int tier) {
					return tier <= floorTiers;
				};
				int need = args.params.driverFinds - countFinds(stopsIn(inFloor));
				need -= turnToFinds(stopsIn(inFloor), need, stream);
				for (; need > 0; --need) {
					if (!addFind(inFloor, [](int) { return true; })) {
						failures.push_back(
							"no leg in tiers 1 to " + std::to_string(floorTiers) + " has room for " + std::to_string(need) +
							" more Find: driver stops (driverFinds " + std::to_string(args.params.driverFinds) + ")"
						);
						return;
					}
				}
			}

			void keepRates(foundation::Rng& stream) {
				for (int tier = 1; tier <= kStopTiers; ++tier) {
					const std::vector<StopAt> stops = stopsIn([tier](int legTier) { return legTier == tier; });
					const auto want = static_cast<int>(std::floor(tuning.driverFinds.rates[static_cast<size_t>(tier - 1)] * stops.size()));
					(void)turnToFinds(stops, want - countFinds(stops), stream);
				}
			}

			// Turns up to `need` of these stops' calm ones into Find: driver, events first, then on legs without one, a
			// draw picking among the best; returns how many it turned.
			int turnToFinds(const std::vector<StopAt>& stops, int need, foundation::Rng& stream) {
				int turned = 0;
				for (; turned < need; ++turned) {
					std::set<int> withFind;
					for (const StopAt& at : stops) {
						if (stopOf(at).type == StopType::FindDriver) {
							withFind.insert(at.leg);
						}
					}
					std::vector<StopAt> best;
					int					bestRank = 0;
					for (const StopAt& at : stops) {
						const StopType type = stopOf(at).type;
						if (type == StopType::FindDriver || !isCalm(type)) {
							continue;
						}
						const int rank = turnOrder(type) + (withFind.contains(at.leg) ? kTurnGroups : 0);
						if (best.empty() || rank < bestRank) {
							best.clear();
							bestRank = rank;
						}
						if (rank == bestRank) {
							best.push_back(at);
						}
					}
					if (best.empty()) {
						break;
					}
					Stop& stop = stopOf(best[static_cast<size_t>(stream.nextInt(size_t{0}, best.size() - 1))]);
					stop.type = StopType::FindDriver;
					stop.skulls = 0;
				}
				return turned;
			}

			// Adds a Find: driver at the widest gap on a leg of these tiers that `allowed` lets it onto; false with none.
			bool addFind(const std::function<bool(int)>& tierHolds, const std::function<bool(int)>& allowed) {
				const std::optional<Gap> gap =
					widestGap([&](int leg) { return tierHolds(tiers[static_cast<size_t>(leg)]) && allowed(leg); });
				if (!gap) {
					return false;
				}
				Stop stop = stopAt(gap->leg, gap->along);
				stop.type = StopType::FindDriver;
				insert(stop);
				return true;
			}

			// The gap between stops, or a stop and the clearance at a leg's end, where a stop added on a leg `allowed`
			// lets it onto, under every route's band there, stands furthest from both sides, at least tightGap from a
			// stop and clear of junctions, as near the gap's middle as junctions let it; none with no room.
			[[nodiscard]] std::optional<Gap> widestGap(const std::function<bool(int)>& allowed) const {
				std::optional<Gap> best;
				double			   widest = 0;
				for (size_t leg = 0; leg < legs.size(); ++leg) {
					const double length = legs[leg].length;
					if (!(length > 0) || !allowed(static_cast<int>(leg)) || !underBands(static_cast<int>(leg))) {
						continue;
					}
					const double		ends = legEnds(length, tuning);
					std::vector<double> marks{ends};
					for (const Stop& stop : placed[leg]) {
						marks.push_back(stop.along);
					}
					marks.push_back(length - ends);
					for (size_t index = 1; index < marks.size(); ++index) {
						const double from = index == 1 ? marks[0] : marks[index - 1] + tuning.tightGap;
						const double to = index + 1 == marks.size() ? marks[index] : marks[index] - tuning.tightGap;
						if (!(from <= to)) {
							continue;
						}
						const std::optional<double> along =
							nearestClear((marks[index - 1] + marks[index]) / 2, from, to, joins[leg], tuning.clearance.junctions);
						if (!along) {
							continue;
						}
						const double room = std::min(*along - marks[index - 1], marks[index] - *along);
						if (!best || room > widest) {
							best = Gap{.leg = static_cast<int>(leg), .along = *along};
							widest = room;
						}
					}
				}
				return best;
			}

			// Every route through the leg holds fewer stops from game stage 0 than its band's most.
			[[nodiscard]] bool underBands(int leg) const {
				return std::ranges::all_of(routesOn[static_cast<size_t>(leg)], [&](const Through& through) {
					return activeCount(routeOf(through)) < bands[static_cast<size_t>(through.poi)].stops.max;
				});
			}

			// A route's stops from game stage 0, in driving order, leaving out one.
			[[nodiscard]] std::vector<StopType> activeOn(const Route& route, const Stop* without = nullptr) const {
				std::vector<StopType> types;
				for (const int leg : route.legs) {
					for (const Stop& stop : placed[static_cast<size_t>(leg)]) {
						if (stop.stage == 0 && &stop != without) {
							types.push_back(stop.type);
						}
					}
				}
				return types;
			}

			[[nodiscard]] int activeCount(const Route& route) const {
				int count = 0;
				for (const int leg : route.legs) {
					count += static_cast<int>(std::ranges::count(placed[static_cast<size_t>(leg)], 0, &Stop::stage));
				}
				return count;
			}

			// A route the daylight check left under its band's minimum, most often by thinning road it shares, takes calm
			// stops back on its own road, drawn on the `fill` fork, where its own legs have room and the stop tips no POI
			// home by dark past it. Where they have none, a dormant extra there turns on from the start instead, the
			// latest first, which the daylight check already counted (call 20).
			void topUp() {
				foundation::Rng stream = args.stream.fork("fill");
				for (size_t poi = 0; poi < routes.size(); ++poi) {
					for (const Route& route : routes[poi]) {
						std::set<int> own;
						for (const int leg : route.legs) {
							if (owns(static_cast<int>(poi), leg)) {
								own.insert(leg);
							}
						}
						while (activeCount(route) < bands[poi].stops.min) {
							const double			 draw = stream.nextDouble();
							const std::optional<Gap> gap = widestGap([&](int leg) { return own.contains(leg); });
							if (gap) {
								Stop stop = stopAt(gap->leg, gap->along);
								stop.type = args.tables.draw(
									stop.roadClass, stop.biome, tiers[static_cast<size_t>(gap->leg)], territory, draw, false
								);
								if (roomFor(gap->leg, tuning.types[static_cast<size_t>(stop.type)].hours)) {
									insert(stop);
									continue;
								}
							}
							Stop* extra = latestExtra(own);
							if (extra == nullptr) {
								break;
							}
							extra->stage = 0;
						}
					}
				}
			}

			// The dormant extra on these legs, each under its routes' bands, that turns on latest, the furthest out on a
			// tie.
			[[nodiscard]] Stop* latestExtra(const std::set<int>& onLegs) {
				Stop* latest = nullptr;
				for (const int leg : onLegs) {
					if (!underBands(leg)) {
						continue;
					}
					for (Stop& stop : placed[static_cast<size_t>(leg)]) {
						if (stop.stage > 0 && (latest == nullptr || stop.stage >= latest->stage)) {
							latest = &stop;
						}
					}
				}
				return latest;
			}

			// Guarantees 10: every POI in tiers 1 to 3 has a route whose estimated run, every extra on, fits in
			// daylightHours. Where none does, its quickest route sheds stops until it fits (thin). One whose quickest
			// route runs past dark with no stops at all no thinning can mend, and goes in the failures; one that can't get
			// home without going under a fight floor stays past dark, which the checks fail.
			void daylight() {
				const double  daylightHours = args.params.daylightHours;
				std::set<int> unmendable;
				bool		  changed = true;
				for (int pass = 0; changed && pass < kDaylightPasses; ++pass) {
					changed = false;
					for (size_t index = 0; index < routes.size(); ++index) {
						const int  poi = static_cast<int>(index);
						const Poi& destination = args.pois.pois[index];
						if (destination.tier > kDaylightTiers || unmendable.contains(poi) || routes[index].empty() || fitsDaylight(poi)) {
							continue;
						}
						const double bare = runHours(destination.arrivals.front().hours, 0, objectiveHours(destination, tuning));
						if (bare > daylightHours) {
							unmendable.insert(poi);
							failures.push_back(
								"poi " + std::to_string(poi) + " (tier " + std::to_string(destination.tier) +
								"): its quickest route runs past daylightHours " + std::to_string(daylightHours) + " with no stops at all"
							);
							continue;
						}
						changed = true;
						while (estimate(poi, 0) > daylightHours) {
							if (!thin(poi)) {
								unmendable.insert(poi);
								break;
							}
						}
					}
				}
			}

			[[nodiscard]] bool fitsDaylight(int poi) const {
				for (size_t route = 0; route < routes[static_cast<size_t>(poi)].size(); ++route) {
					if (estimate(poi, static_cast<int>(route)) <= args.params.daylightHours) {
						return true;
					}
				}
				return false;
			}

			// An estimated run, every extra on: out with its stops, the objective, and home, on the arrival's hours.
			[[nodiscard]] double estimate(int poi, int route) const {
				double stopHours = 0;
				for (const int leg : routes[static_cast<size_t>(poi)][static_cast<size_t>(route)].legs) {
					for (const Stop& stop : placed[static_cast<size_t>(leg)]) {
						stopHours += tuning.types[static_cast<size_t>(stop.type)].hours;
					}
				}
				const Poi& destination = args.pois.pois[static_cast<size_t>(poi)];
				return runHours(destination.arrivals[static_cast<size_t>(route)].hours, stopHours, objectiveHours(destination, tuning));
			}

			// Takes the best stop to lose off a POI's quickest route, false when none can go (call 8): its extras first,
			// then its calm stops, then a Find: driver, then a fight above every route's floor; within each, one whose
			// going leaves every route through its leg in its band first (call 264's), then on legs fewer routes share,
			// then the costliest, the furthest out first. A calm stop goes only where every route through its leg keeps
			// the rules without it, and a fight only where every route through its leg keeps its floor, on its own road
			// too. A Find: driver the floor or its tier's rate still needs moves to the widest gap on a leg of its tiers
			// off this route, and only onto one where it tips no POI home by dark past it, so two POIs can't hand one
			// find back and forth.
			bool thin(int poi) {
				const Route& route = routes[static_cast<size_t>(poi)].front();
				using Rank = std::array<double, 6>;
				struct Candidate {
					StopAt at;
					Rank   rank{};
				};
				std::vector<Candidate> candidates;
				for (size_t place = 0; place < route.legs.size(); ++place) {
					const int leg = route.legs[place];
					for (size_t index = 0; index < placed[static_cast<size_t>(leg)].size(); ++index) {
						const Stop& stop = placed[static_cast<size_t>(leg)][index];
						const int	order = stop.stage > 0 ? 0 : isFight(stop.type) ? 3 : stop.type == StopType::FindDriver ? 2 : 1;
						const bool	toBand =
							stop.stage == 0 && std::ranges::any_of(routesOn[static_cast<size_t>(leg)], [&](const Through& through) {
								return activeCount(routeOf(through)) <= bands[static_cast<size_t>(through.poi)].stops.min;
							});
						candidates.push_back({
							.at = {.leg = leg, .index = index},
							.rank = {
								static_cast<double>(order),
								toBand ? 1.0 : 0.0,
								static_cast<double>(routesOn[static_cast<size_t>(leg)].size()),
								-tuning.types[static_cast<size_t>(stop.type)].hours,
								-static_cast<double>(place),
								-stop.along,
							},
						});
					}
				}
				std::ranges::stable_sort(candidates, std::less<>{}, &Candidate::rank);
				const std::set<int> onRoute(route.legs.begin(), route.legs.end());
				for (const Candidate& candidate : candidates) {
					std::vector<Stop>& stops = placed[static_cast<size_t>(candidate.at.leg)];
					const Stop		   stop = stops[candidate.at.index];
					if (stop.stage == 0 && isFight(stop.type) && !keepsFloors(candidate.at.leg)) {
						continue;
					}
					if (stop.stage == 0 && isCalm(stop.type) && !canLose(candidate.at)) {
						continue;
					}
					stops.erase(stops.begin() + static_cast<std::ptrdiff_t>(candidate.at.index));
					if (stop.stage == 0 && stop.type == StopType::FindDriver && !findsHold(tiers[static_cast<size_t>(stop.leg)])) {
						const int  tier = tiers[static_cast<size_t>(stop.leg)];
						const int  floorTiers = tuning.driverFinds.floorTiers;
						const auto sameTiers = [tier, floorTiers](int legTier) {
							return tier <= floorTiers ? legTier <= floorTiers : legTier == tier;
						};
						const double hours = tuning.types[static_cast<size_t>(StopType::FindDriver)].hours;
						if (!addFind(sameTiers, [&](int other) { return !onRoute.contains(other) && roomFor(other, hours); })) {
							stops.insert(stops.begin() + static_cast<std::ptrdiff_t>(candidate.at.index), stop);
							continue;
						}
					}
					thinned += 1;
					return true;
				}
				return false;
			}

			// Every route through the leg keeps its fight floor, on its own road too, with one fight fewer on the leg.
			[[nodiscard]] bool keepsFloors(int leg) const {
				return std::ranges::all_of(routesOn[static_cast<size_t>(leg)], [&](const Through& through) {
					int fights = 0;
					int own = 0;
					for (const int on : routeOf(through).legs) {
						for (const Stop& stop : placed[static_cast<size_t>(on)]) {
							if (stop.stage == 0 && isFight(stop.type)) {
								fights += 1;
								own += owns(through.poi, on) ? 1 : 0;
							}
						}
					}
					const int least = bands[static_cast<size_t>(through.poi)].fights.min;
					return fights - 1 >= least && (owns(through.poi, leg) ? own - 1 : own) >= least;
				});
			}

			// Whether `extra` more hours on the leg would tip past dark no POI in tiers 1 to 3 whose routes use it and
			// that's home by dark now.
			[[nodiscard]] bool roomFor(int leg, double extra) const {
				std::set<int> through;
				for (const Through& each : routesOn[static_cast<size_t>(leg)]) {
					through.insert(each.poi);
				}
				for (const int poi : through) {
					if (args.pois.pois[static_cast<size_t>(poi)].tier > kDaylightTiers || !fitsDaylight(poi)) {
						continue;
					}
					bool stillFits = false;
					for (size_t route = 0; route < routes[static_cast<size_t>(poi)].size(); ++route) {
						const std::vector<int>& along = routes[static_cast<size_t>(poi)][route].legs;
						const bool				uses = std::ranges::find(along, leg) != along.end();
						stillFits = stillFits || estimate(poi, static_cast<int>(route)) + (uses ? extra : 0) <= args.params.daylightHours;
					}
					if (!stillFits) {
						return false;
					}
				}
				return true;
			}

			// The Find: driver floor holds, and this tier's rate.
			[[nodiscard]] bool findsHold(int tier) const {
				const std::vector<StopAt> inTier = stopsIn([tier](int legTier) { return legTier == tier; });
				const auto				  rate = tuning.driverFinds.rates[static_cast<size_t>(tier - 1)];
				if (countFinds(inTier) < static_cast<int>(std::floor(rate * inTier.size()))) {
					return false;
				}
				const int floorTiers = tuning.driverFinds.floorTiers;
				return tier > floorTiers ||
					   countFinds(stopsIn([floorTiers](int legTier) { return legTier <= floorTiers; })) >= args.params.driverFinds;
			}

			// Every route through the stop's leg keeps the rules without it.
			[[nodiscard]] bool canLose(const StopAt& at) const {
				const Stop* lost = &placed[static_cast<size_t>(at.leg)][at.index];
				return std::ranges::all_of(routesOn[static_cast<size_t>(at.leg)], [&](const Through& through) {
					return keepsRules(activeOn(routeOf(through), lost));
				});
			}

			// The band's soft rules a route misses: outside its band, or short of half its band's least on its own road.
			void reportShortfalls() {
				for (size_t poi = 0; poi < routes.size(); ++poi) {
					const IntRange& band = bands[poi].stops;
					for (size_t place = 0; place < routes[poi].size(); ++place) {
						const Route&	  route = routes[poi][place];
						const std::string where = "poi " + std::to_string(poi) + " route " + std::to_string(place);
						const int		  count = activeCount(route);
						if (count < band.min || count > band.max) {
							failures.push_back(
								where + ": " + std::to_string(count) + " stops, outside its band of " + std::to_string(band.min) + " to " +
								std::to_string(band.max)
							);
						}
						int own = 0;
						for (const int leg : route.legs) {
							own += owns(static_cast<int>(poi), leg)
									   ? static_cast<int>(std::ranges::count(placed[static_cast<size_t>(leg)], 0, &Stop::stage))
									   : 0;
						}
						if (own < (band.min + 1) / 2) {
							failures.push_back(
								where + ": " + std::to_string(own) + " stops on its own road, under half its band's " +
								std::to_string(band.min)
							);
						}
					}
				}
			}

			[[nodiscard]] StopLayer layer() const {
				StopLayer out{
					.stops = {},
					.legs = {},
					.contentSeed = args.stream.fork("contents").seed(),
					.thinned = thinned,
					.failures = failures,
				};
				const std::string name(args.tables.territories()[static_cast<size_t>(territory)]);
				for (size_t id = 0; id < legs.size(); ++id) {
					LegStops& each = out.legs.emplace_back(LegStops{.stops = {}, .extras = {}, .tier = tiers[id], .territory = name});
					for (Stop stop : placed[id]) {
						stop.at = legs[id].length > 0 ? stop.along / legs[id].length : 0;
						(stop.stage == 0 ? each.stops : each.extras).push_back(static_cast<int>(out.stops.size()));
						out.stops.push_back(stop);
					}
				}
				return out;
			}
		};

	} // namespace

	StopLayer placeStops(const StopArgs& args) {
		return StopPlacer(args).place();
	}

	std::vector<int> legTiers(const PoiLayer& pois) {
		std::vector<int> tiers(pois.legs.legs.size(), kStopTiers);
		for (size_t poi = 0; poi < pois.pois.size(); ++poi) {
			for (const Route& route : routesTo(pois.legs, static_cast<int>(poi))) {
				for (const int leg : route.legs) {
					tiers[static_cast<size_t>(leg)] = std::min(tiers[static_cast<size_t>(leg)], pois.pois[poi].tier);
				}
			}
		}
		return tiers;
	}

	double legEarns(const RoadNetwork& network, const Leg& leg, double stopDensity, const StopTuning& tuning) {
		double earned = 0;
		for (const LegPiece& piece : leg.pieces) {
			const RoadClass roadClass = network.stretches[static_cast<size_t>(piece.stretch)].roadClass;
			earned += piece.length / tuning.spacing[static_cast<size_t>(roadClass)];
		}
		return earned * stopDensity;
	}

	double objectiveHours(const Poi& poi, const StopTuning& tuning) {
		return poi.type == kStrongholdType ? tuning.objectiveHours.stronghold : tuning.objectiveHours.poi;
	}

} // namespace rules::map
