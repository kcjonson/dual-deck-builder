#include "Pois.h"

#include "StopRoom.h"

#include <rules/core/ContentError.h>

#include <math/DeterministicMath.h>

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <numbers>
#include <set>
#include <string>
#include <utility>

namespace rules::map {

	namespace {

		// Points round a stronghold's site its faction fit samples, besides the site itself.
		constexpr int kFitDirections = 6;
		constexpr int kStrongholdTier = 5;
		// World units across the highway index's buckets.
		constexpr double kBucket = 64;

		Point unitVector(double degrees) {
			const double radians = degrees * (std::numbers::pi / 180);
			return {.x = foundation::det_math::cos(radians), .y = foundation::det_math::sin(radians)};
		}

		// Every highway segment in square buckets, for the nearness the scores and placement rules ask.
		class HighwayIndex {
		  public:
			HighwayIndex(const RoadNetwork& network, double radius)
				: extent(radius * 1.25),
				  side(static_cast<int>(std::ceil(2 * extent / kBucket))),
				  buckets(static_cast<size_t>(side) * static_cast<size_t>(side)) {
				for (const RoadStretch& stretch : network.stretches) {
					if (stretch.roadClass != RoadClass::Highway) {
						continue;
					}
					for (size_t point = 1; point < stretch.points.size(); ++point) {
						const Point	 a = stretch.points[point - 1];
						const Point	 b = stretch.points[point];
						const size_t segment = segments.size();
						segments.emplace_back(a, b);
						for (int row = cell(std::min(a.y, b.y)); row <= cell(std::max(a.y, b.y)); ++row) {
							for (int column = cell(std::min(a.x, b.x)); column <= cell(std::max(a.x, b.x)); ++column) {
								buckets[static_cast<size_t>(row * side + column)].push_back(segment);
							}
						}
					}
				}
			}

			[[nodiscard]] bool within(Point point, double reach) const {
				for (int row = cell(point.y - reach); row <= cell(point.y + reach); ++row) {
					for (int column = cell(point.x - reach); column <= cell(point.x + reach); ++column) {
						for (const size_t segment : buckets[static_cast<size_t>(row * side + column)]) {
							const auto& [a, b] = segments[segment];
							if (pointSegmentDistanceSquared(point, a, b) < reach * reach) {
								return true;
							}
						}
					}
				}
				return false;
			}

		  private:
			double								 extent;
			int									 side;
			std::vector<std::vector<size_t>>	 buckets;
			std::vector<std::pair<Point, Point>> segments;

			[[nodiscard]] int cell(double coordinate) const {
				const int at = static_cast<int>(std::floor((coordinate + extent) / kBucket));
				return at < 0 ? 0 : at >= side ? side - 1 : at;
			}
		};

		// World units a site keeps from either end of a stretch this long.
		double edgeMargin(double length, const PoiTuning::Sites& sites) {
			const double scaled = sites.marginShare * length;
			return sites.margin < scaled ? sites.margin : scaled;
		}

		struct Candidate {
			Point  at;
			double along{0};
			// Its meeting point, by index.
			int	   point{0};
			double score{0};
			double distance{0};
		};

		// A seated site, before its type: a stronghold's is its own.
		struct Placement {
			int			candidate{0};
			bool		stronghold{false};
			int			ring{0};
			int			tier{0};
			std::string faction;
			int			sector{-1};
		};

		// Biome counts and ruin round a stronghold's site.
		struct Land {
			std::array<double, 6> biomes{};
			double				  ruin{0};
			double				  samples{0};
		};

		class PoiPlacer {
		  public:
			explicit PoiPlacer(const PoiArgs& placing)
				: args(placing),
				  radius(placing.ground.radius),
				  highways(placing.network, placing.ground.radius),
				  degrees(nodeDegrees(placing.network)),
				  usedStretch(placing.network.stretches.size()) {
				if (std::cmp_less(args.factions.size(), args.params.strongholds)) {
					throw ContentError(
						"the packs' " + std::to_string(args.factions.size()) + " factions can't seat " +
						std::to_string(args.params.strongholds) + " strongholds"
					);
				}
				listCandidates();
			}

			PoiLayer place() {
				PoiLayer layer;
				layer.sectorRotation = seatStrongholds(layer.failures);
				layer.rings = placeRings();
				const std::vector<std::string> types = typePois(layer.failures);
				layer.legs = buildLegs({.network = args.network, .tree = args.tree, .destinations = destinations});
				for (size_t index = 0; index < placements.size(); ++index) {
					const Placement&	placement = placements[index];
					const Candidate&	candidate = candidates[static_cast<size_t>(placement.candidate)];
					const MeetingPoint& point = args.tree.meetingPoints[static_cast<size_t>(candidate.point)];
					layer.pois.push_back({
						.site = {.at = candidate.at, .stretch = point.stretch, .along = candidate.along, .node = point.node},
						.arrivals = destinations[index],
						.type = types[index],
						.ring = placement.ring,
						.tier = placement.tier,
					});
					if (placement.stronghold) {
						layer.strongholds.push_back(
							{.poi = static_cast<int>(index), .faction = placement.faction, .sector = placement.sector}
						);
					}
				}
				return layer;
			}

		  private:
			const PoiArgs&			 args;
			double					 radius;
			HighwayIndex			 highways;
			std::vector<int>		 degrees;
			std::vector<Candidate>	 candidates;
			std::vector<uint8_t>	 usedStretch;
			std::vector<Placement>	 placements;
			std::vector<Destination> destinations;

			// Every `step` along each meeting stretch inside its margins, and each three-way point's node, scored
			// with one draw each from the `sites` fork in the order they're listed.
			void listCandidates() {
				const PoiTuning::Sites& sites = args.tuning.sites;
				for (size_t index = 0; index < args.tree.meetingPoints.size(); ++index) {
					const MeetingPoint& point = args.tree.meetingPoints[index];
					if (point.stretch < 0) {
						const RoadNode& node = args.network.nodes[static_cast<size_t>(point.node)];
						add(static_cast<int>(index), {.x = node.x, .y = node.y}, 0, args.tuning.score.threeWay);
						continue;
					}
					const RoadStretch& stretch = args.network.stretches[static_cast<size_t>(point.stretch)];
					const double	   keep = edgeMargin(stretch.length, sites);
					const int		   steps = static_cast<int>(std::floor((stretch.length - 2 * keep) / sites.step));
					for (int place = 0; place <= steps; ++place) {
						const double along = keep + place * sites.step;
						add(static_cast<int>(index), pointAlong(stretch.points, along), along, 0);
					}
				}
				foundation::Rng			draws = args.stream.fork("sites");
				const PoiTuning::Score& score = args.tuning.score;
				for (Candidate& candidate : candidates) {
					candidate.score += score.noise * draws.nextDouble() + score.ruin * args.ground.ruin(candidate.at) +
									   (highways.within(candidate.at, score.highwayWithin) ? score.highway : 0);
				}
			}

			void add(int point, Point at, double along, double bonus) {
				candidates.push_back(
					{.at = at, .along = along, .point = point, .score = bonus, .distance = std::sqrt(at.x * at.x + at.y * at.y)}
				);
			}

			// The sectors' rotation, drawn, then stepped by an even share of a sector up to rotationSteps times,
			// until one seats a stronghold in every sector. Each step is seated in full, since one whose sectors all
			// hold a band site can still lose one to spacing or a stretch another took. When none seats every sector,
			// the drawn rotation is kept, and each sector it leaves without one is a failure.
			double seatStrongholds(std::vector<std::string>& failures) {
				const int					  count = args.params.strongholds;
				const PoiTuning::Strongholds& tuning = args.tuning.strongholds;
				const double				  drawn = args.stream.fork("sectors").nextDouble() * 360 / count;
				std::vector<int>			  inBand;
				std::vector<Land>			  lands;
				for (size_t candidate = 0; candidate < candidates.size(); ++candidate) {
					const double distance = candidates[candidate].distance;
					if (distance >= tuning.inner * radius && distance <= tuning.outer * radius) {
						inBand.push_back(static_cast<int>(candidate));
						lands.push_back(landAround(candidates[candidate].at));
					}
				}
				foundation::Rng		jittering = args.stream.fork("factions");
				std::vector<double> jitter;
				for (size_t faction = 0; faction < args.factions.size(); ++faction) {
					jitter.push_back(jittering.nextDouble() * tuning.fitJitter);
				}
				for (int step = 0; step < tuning.rotationSteps; ++step) {
					const double rotation = drawn + step * 360.0 / count / tuning.rotationSteps;
					if (seatAt(Sectors(rotation, count), inBand, lands, jitter).empty()) {
						return rotation;
					}
					std::ranges::fill(usedStretch, uint8_t{0});
					placements.clear();
					destinations.clear();
				}
				for (const int sector : seatAt(Sectors(drawn, count), inBand, lands, jitter)) {
					failures.push_back(
						"sector " + std::to_string(sector) + " has no free meeting point in the outer band whose routes all keep own road"
					);
				}
				return drawn;
			}

			// One stronghold a sector, each in turn, on the free band site whose best untaken faction fits it best,
			// ties to the better score, then the earlier site. Returns the sectors left without one.
			std::vector<int>
			seatAt(const Sectors& sectors, std::span<const int> inBand, std::span<const Land> lands, std::span<const double> jitter) {
				std::vector<int>	 missing;
				std::vector<uint8_t> taken(args.factions.size());
				for (int sector = 0; sector < args.params.strongholds; ++sector) {
					struct Fit {
						int	   candidate{0};
						double fit{0};
						int	   faction{0};
					};
					std::vector<Fit> fits;
					for (size_t index = 0; index < inBand.size(); ++index) {
						const int candidate = inBand[index];
						if (sectors.sectorOf(candidates[static_cast<size_t>(candidate)].at) != sector || !free(candidate, true)) {
							continue;
						}
						const auto [fit, faction] = bestFaction(lands[index], jitter, taken);
						fits.push_back({.candidate = candidate, .fit = fit, .faction = faction});
					}
					std::ranges::stable_sort(fits, [&](const Fit& a, const Fit& b) {
						return a.fit > b.fit || (a.fit == b.fit && candidates[static_cast<size_t>(a.candidate)].score >
																	   candidates[static_cast<size_t>(b.candidate)].score);
					});
					const auto best =
						std::ranges::find_if(fits, [&](const Fit& fit) { return keepsOwnRoad(fit.candidate, kStrongholdTier); });
					if (best == fits.end()) {
						missing.push_back(sector);
						continue;
					}
					taken[static_cast<size_t>(best->faction)] = 1;
					take(
						best->candidate,
						{
							.candidate = best->candidate,
							.stronghold = true,
							.ring = ringOf(candidates[static_cast<size_t>(best->candidate)].distance),
							.tier = kStrongholdTier,
							.faction = args.factions[static_cast<size_t>(best->faction)].id,
							.sector = sector,
						}
					);
				}
				return missing;
			}

			// The site and kFitDirections points fitRadius round it, those inside the disc.
			[[nodiscard]] Land landAround(Point site) const {
				Land		 land;
				const double reach = args.tuning.strongholds.fitRadius;
				for (int index = -1; index < kFitDirections; ++index) {
					const Point direction = index < 0 ? Point{} : unitVector(index * 360.0 / kFitDirections);
					const Point at{.x = site.x + direction.x * reach, .y = site.y + direction.y * reach};
					if (at.x * at.x + at.y * at.y > radius * radius) {
						continue;
					}
					land.biomes[static_cast<size_t>(args.ground.biome(at))] += 1;
					land.ruin += args.ground.ruin(at);
					land.samples += 1;
				}
				return land;
			}

			// The untaken faction the land suits best, its fit with its jitter; the earlier faction on a tie.
			[[nodiscard]] std::pair<double, int>
			bestFaction(const Land& land, std::span<const double> jitter, std::span<const uint8_t> taken) const {
				double fit = -std::numeric_limits<double>::infinity();
				int	   best = -1;
				for (size_t index = 0; index < args.factions.size(); ++index) {
					if (taken[index] == 1) {
						continue;
					}
					const Faction& faction = args.factions[index];
					double		   score = faction.ruin * land.ruin;
					for (size_t biome = 0; biome < land.biomes.size(); ++biome) {
						score += faction.biomes[biome] * land.biomes[biome];
					}
					score = (land.samples > 0 ? score / land.samples : 0) + jitter[index];
					if (score > fit) {
						fit = score;
						best = static_cast<int>(index);
					}
				}
				return {fit, best};
			}

			// The best scored free sites first, the lower index on a tie, each into its ring while the ring is under
			// its target.
			std::vector<RingCount> placeRings() {
				std::vector<RingCount> rings;
				for (const int base : args.tuning.rings.targets) {
					rings.push_back({.target = static_cast<int>(std::round(base * args.params.poiDensity)), .placed = 0, .promoted = 0});
				}
				std::vector<int> order(candidates.size());
				for (size_t index = 0; index < order.size(); ++index) {
					order[index] = static_cast<int>(index);
				}
				std::ranges::sort(order, [&](int a, int b) {
					const double first = candidates[static_cast<size_t>(a)].score;
					const double second = candidates[static_cast<size_t>(b)].score;
					return first > second || (first == second && a < b);
				});
				const double start = args.ground.metroRadius;
				const double end = args.tuning.rings.outer * radius;
				for (const int candidate : order) {
					const double distance = candidates[static_cast<size_t>(candidate)].distance;
					if (distance < start || distance > end) {
						continue;
					}
					const int  ring = ringOf(distance);
					RingCount& count = rings[static_cast<size_t>(ring)];
					if (count.placed >= count.target || !free(candidate, false)) {
						continue;
					}
					const int tier = tierAt(candidate, ring);
					if (!keepsOwnRoad(candidate, tier)) {
						continue;
					}
					count.placed += 1;
					count.promoted += tier != ring + 1 ? 1 : 0;
					take(candidate, {.candidate = candidate, .stronghold = false, .ring = ring, .tier = tier, .faction = {}, .sector = -1});
				}
				return rings;
			}

			// Its ring plus one, or one past the daylight tiers where that's in them and its quickest route can't be
			// home by dark carrying its fight floor and a Find: driver.
			[[nodiscard]] int tierAt(int candidate, int ring) const {
				const int tier = ring + 1;
				if (tier > kDaylightTiers) {
					return tier;
				}
				const double hours = floorRunHours(quickest(candidate), tier, args.stops.objectiveHours.poi, args.stops);
				return hours > args.params.daylightHours ? kDaylightTiers + 1 : tier;
			}

			[[nodiscard]] int ringOf(double distance) const {
				const auto	 rings = static_cast<int>(args.tuning.rings.targets.size());
				const double start = args.ground.metroRadius;
				const double span = args.tuning.rings.outer * radius - start;
				const int	 ring = static_cast<int>(std::floor((distance - start) / span * rings));
				return ring < 0 ? 0 : ring >= rings ? rings - 1 : ring;
			}

			// Its meeting point untaken, and the sites' spacing kept from everything placed; a stronghold keeps the
			// strongholds' from the others where that's wider.
			[[nodiscard]] bool free(int candidate, bool stronghold) const {
				const Candidate&	site = candidates[static_cast<size_t>(candidate)];
				const MeetingPoint& point = args.tree.meetingPoints[static_cast<size_t>(site.point)];
				if (std::ranges::any_of(point.via, [&](int via) { return usedStretch[static_cast<size_t>(via)] == 1; })) {
					return false;
				}
				const double spacing = args.tuning.sites.spacing * radius;
				const double wider = std::max(spacing, args.tuning.strongholds.spacing * radius);
				for (const Placement& placed : placements) {
					const Point	 other = candidates[static_cast<size_t>(placed.candidate)].at;
					const double apart = stronghold && placed.stronghold ? wider : spacing;
					const double dx = site.at.x - other.x;
					const double dy = site.at.y - other.y;
					if (dx * dx + dy * dy < apart * apart) {
						return false;
					}
				}
				return true;
			}

			void take(int candidate, Placement placement) {
				const MeetingPoint& point = args.tree.meetingPoints[static_cast<size_t>(candidates[static_cast<size_t>(candidate)].point)];
				for (const int via : point.via) {
					usedStretch[static_cast<size_t>(via)] = 1;
				}
				destinations.push_back(arrivals(candidate));
				placements.push_back(std::move(placement));
			}

			// Whether seating a POI of this tier on the candidate leaves every route, its own and those seated, own road
			// with room for its need at the tight gap. Seating cuts the legs other routes branch from, so the whole
			// layer's legs are cut again with it in, and nothing is kept between candidates: seating more can split a
			// leg at a junction and give it room.
			[[nodiscard]] bool keepsOwnRoad(int candidate, int tier) const {
				std::vector<Destination> trial = destinations;
				trial.push_back(arrivals(candidate));
				const RouteLegs					cut = buildLegs({.network = args.network, .tree = args.tree, .destinations = trial});
				std::vector<std::vector<Route>> routes;
				for (size_t destination = 0; destination < trial.size(); ++destination) {
					routes.push_back(routesTo(cut, static_cast<int>(destination)));
				}
				const std::vector<std::vector<int>> room = ownRoadRoom(args.network, cut.legs, routes, degrees, args.stops);
				for (size_t destination = 0; destination < room.size(); ++destination) {
					const int need = ownRoadNeed(destination < placements.size() ? placements[destination].tier : tier, args.stops);
					if (std::ranges::any_of(room[destination], [&](int held) { return held < need; })) {
						return false;
					}
				}
				return true;
			}

			// One draw a POI from the `types` fork, in placement order, used or not. A stronghold keeps its own; the
			// first ring's tier 1 POIs, quickest first, are typed to yield the cover resources before location types
			// them; every other POI by location.
			std::vector<std::string> typePois(std::vector<std::string>& failures) {
				foundation::Rng			 typing = args.stream.fork("types");
				std::vector<std::string> types;
				for (const Placement& placement : placements) {
					const double draw = typing.nextDouble();
					const Point	 at = candidates[static_cast<size_t>(placement.candidate)].at;
					types.push_back(placement.stronghold ? std::string(kStrongholdType) : typeAt(at, draw));
				}
				std::set<Resource>	needed(args.tuning.cover.begin(), args.tuning.cover.end());
				std::vector<size_t> first;
				for (size_t index = 0; index < placements.size(); ++index) {
					if (!placements[index].stronghold && placements[index].tier == 1) {
						first.push_back(index);
					}
				}
				std::ranges::stable_sort(first, [&](size_t a, size_t b) {
					return destinations[a].front().hours < destinations[b].front().hours;
				});
				for (const size_t index : first) {
					if (needed.empty()) {
						break;
					}
					types[index] = coverType(types[index], candidates[static_cast<size_t>(placements[index].candidate)].at, needed);
					const PoiType& type = args.tuning.types.find(types[index])->second;
					for (const auto& [name, resource] : kResourceNames) {
						if (type.yields[static_cast<size_t>(resource)] > 0) {
							needed.erase(resource);
						}
					}
				}
				if (!needed.empty()) {
					std::string missing;
					for (const auto& [name, resource] : kResourceNames) {
						if (needed.contains(resource)) {
							missing += (missing.empty() ? "" : ", ") + std::string(name);
						}
					}
					failures.push_back("the first ring's POIs yield no " + missing);
				}
				return types;
			}

			// The location's type, unless another yields strictly more of what's still needed; among those the one
			// yielding most, preferring one whose rule holds here, then the rules' order.
			[[nodiscard]] std::string coverType(const std::string& located, Point at, const std::set<Resource>& needed) const {
				const auto covers = [&](const std::string& name) {
					const PoiType& type = args.tuning.types.find(name)->second;
					return std::ranges::count_if(needed, [&](Resource resource) { return type.yields[static_cast<size_t>(resource)] > 0; });
				};
				std::string best = located;
				auto		bestCovers = covers(located);
				// The location's own rule holds here, so a tie never displaces it.
				bool bestHolds = true;
				for (const PlacementRule& rule : args.tuning.placement) {
					const bool holdsHere =
						std::ranges::any_of(rule.where, [&](const SiteCondition& condition) { return holds(condition, at); });
					for (const std::string& type : rule.types) {
						const auto count = covers(type);
						if (count > bestCovers || (count == bestCovers && count > 0 && holdsHere && !bestHolds)) {
							best = type;
							bestCovers = count;
							bestHolds = holdsHere;
						}
					}
				}
				return best;
			}

			// The first placement rule that holds at the site, one of its types picked by `draw`; the last always holds.
			[[nodiscard]] std::string typeAt(Point at, double draw) const {
				for (const PlacementRule& rule : args.tuning.placement) {
					if (std::ranges::any_of(rule.where, [&](const SiteCondition& condition) { return holds(condition, at); })) {
						return rule.types[static_cast<size_t>(std::floor(draw * static_cast<double>(rule.types.size())))];
					}
				}
				assert(false && "placePois: the last placement rule holds everywhere");
				return {};
			}

			[[nodiscard]] bool holds(const SiteCondition& condition, Point at) const {
				const PoiGround& ground = args.ground;
				return (!condition.ruinAtLeast || ground.ruin(at) >= *condition.ruinAtLeast) &&
					   (!condition.elevationBelow || ground.elevation(at) < *condition.elevationBelow) &&
					   (!condition.moistureAtLeast || ground.moisture(at) >= *condition.moistureAtLeast) &&
					   (!condition.biomes || std::ranges::find(*condition.biomes, ground.biome(at)) != condition.biomes->end()) &&
					   (!condition.highwayWithin || highways.within(at, *condition.highwayWithin));
			}

			[[nodiscard]] Destination arrivals(int candidate) const {
				const Candidate& site = candidates[static_cast<size_t>(candidate)];
				return arrivalsAt(args.network, args.tree, args.tree.meetingPoints[static_cast<size_t>(site.point)], site.along);
			}

			[[nodiscard]] double quickest(int candidate) const { return arrivals(candidate).front().hours; }
		};

	} // namespace

	PoiGround poiGround(const Ground& ground, const Places& places, double radius) {
		return {
			.radius = radius,
			.metroRadius = places.metroRadius(),
			.biome = [ground](Point at) { return ground.biome(at.x, at.y); },
			.elevation = [ground](Point at) { return ground.sample(at.x, at.y).elevation; },
			.moisture = [ground](Point at) { return ground.moisture(at.x, at.y); },
			.ruin = [&places](Point at) { return ruinAt(places, at.x, at.y); },
		};
	}

	Sectors::Sectors(double rotation, int count)
		: startDirection(unitVector(rotation)) {
		for (int sector = 1; sector < count; ++sector) {
			bounds.push_back(angle(unitVector(rotation + sector * 360.0 / count)));
		}
	}

	int Sectors::sectorOf(Point point) const {
		const double at = angle(point);
		int			 sector = 0;
		while (std::cmp_less(sector, bounds.size()) && bounds[static_cast<size_t>(sector)] <= at) {
			sector += 1;
		}
		return sector;
	}

	double Sectors::angle(Point point) const {
		const double along = startDirection.x * point.x + startDirection.y * point.y;
		const double across = startDirection.x * point.y - startDirection.y * point.x;
		if (across >= 0) {
			return along >= 0 ? across / (along + across) : 1 - along / (across - along);
		}
		return along < 0 ? 2 - across / (-along - across) : 3 + along / (along - across);
	}

	PoiLayer placePois(const PoiArgs& args) {
		return PoiPlacer(args).place();
	}

} // namespace rules::map
