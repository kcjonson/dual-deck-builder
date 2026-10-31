#include <rules/map/Dressing.h>
#include <rules/map/LabelLayout.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <algorithm>
#include <cmath>
#include <set>
#include <span>
#include <utility>
#include <vector>

// The dressing over the slow lane's shared maps, each layer built once a run.
namespace {

	using namespace rules::map;

	class EveryDressing : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(
		Dressing,
		EveryDressing,
		::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::badlands())
	);

	// Whether `point` lies inside the block square round `centre`, not on its edge: a road may end on a block's corner.
	bool insideBlock(const StreetDistrict& district, Point centre, Point point) {
		const double dx = point.x - centre.x;
		const double dy = point.y - centre.y;
		const double along = dx * district.ux + dy * district.uy;
		const double across = -dx * district.uy + dy * district.ux;
		return std::abs(along) < district.spacing / 2 - 1e-6 && std::abs(across) < district.spacing / 2 - 1e-6;
	}

	// Rim to rim, off lakes, craters, and cliffs, on a deck wherever it's over river water, sampled every half unit.
	void expectLaidWell(const Ground& ground, const RailLine& rail, int radius) {
		ASSERT_GE(rail.points.size(), 2U);
		EXPECT_NEAR(std::hypot(rail.points.front().x, rail.points.front().y), radius, 1e-6);
		EXPECT_NEAR(std::hypot(rail.points.back().x, rail.points.back().y), radius, 1e-6);
		EXPECT_NEAR(rail.length, polylineLength(rail.points), 1e-9);
		EXPECT_GT(rail.length, radius);
		for (const Point at : rail.points) {
			EXPECT_LE(std::hypot(at.x, at.y), radius + 1e-6);
		}
		for (size_t deck = 0; deck < rail.bridges.size(); ++deck) {
			EXPECT_LE(rail.bridges[deck].end - rail.bridges[deck].start, 30 + 1e-9);
			if (deck > 0) {
				EXPECT_GT(rail.bridges[deck].start, rail.bridges[deck - 1].end + 2);
			}
		}
		for (double along = 0; along <= rail.length; along += 0.5) {
			const Point	   at = pointAlong(rail.points, along);
			const Obstacle obstacle = ground.obstacle(at.x, at.y);
			ASSERT_TRUE(obstacle == Obstacle::None || obstacle == Obstacle::River)
				<< "a rail on a lake, crater, or cliff at " << at.x << ", " << at.y;
			if (ground.waterAt(at.x, at.y) == WaterKind::River && !ground.bridged(at.x, at.y)) {
				const bool decked = std::ranges::any_of(rail.bridges, [&](const RoadBridge& deck) {
					return along >= deck.start - 0.5 && along <= deck.end + 0.5;
				});
				ASSERT_TRUE(decked) << "a rail in river water off its decks at " << at.x << ", " << at.y;
			}
		}
	}

	TEST_P(EveryDressing, LaysItsRailsRimToRimOffLakesCratersAndCliffsBridgingTheRiversTheyCross) {
		const MapParams& params = *GetParam();
		const Dressing&	 dressing = fixtures::dressingFor(params);
		ASSERT_EQ(dressing.rails.size(), static_cast<size_t>(params.railLines));
		for (const RailLine& rail : dressing.rails) {
			expectLaidWell(fixtures::groundFor(params), rail, params.radius);
		}
	}

	TEST(Dressing, KeepsLaterRailsFromRunningBesideEarlierOnesForLong) {
		const MapParams&			params = fixtures::mixed();
		const Ground&				ground = fixtures::groundFor(params);
		const std::vector<RailLine> rails = railLines({.ground = ground, .count = 3, .stream = foundation::Rng(8)});
		ASSERT_GE(rails.size(), 2U);
		for (size_t later = 1; later < rails.size(); ++later) {
			expectLaidWell(ground, rails[later], params.radius);
			double beside = 0;
			for (double along = 0; along <= rails[later].length; along += 10) {
				const Point at = pointAlong(rails[later].points, along);
				const auto	near = [&](const RailLine& earlier) {
					 for (size_t point = 1; point < earlier.points.size(); ++point) {
						 if (pointSegmentDistanceSquared(at, earlier.points[point - 1], earlier.points[point]) <= 30 * 30) {
							 return true;
						 }
					 }
					 return false;
				};
				beside += std::any_of(rails.begin(), rails.begin() + static_cast<std::ptrdiff_t>(later), near) ? 10 : 0;
			}
			EXPECT_LE(beside, 300) << "rail " << later;
		}
		EXPECT_TRUE(railLines({.ground = ground, .count = 0, .stream = foundation::Rng(8)}).empty());
	}

	TEST_P(EveryDressing, LaysEveryGridInsideItsRuinOffWaterCratersAndCliffsAndClearOfEveryRoadSpanAndRail) {
		const MapParams&					params = *GetParam();
		const Dressing&						dressing = fixtures::dressingFor(params);
		const Ground&						ground = fixtures::groundFor(params);
		const RoadNetwork&					network = fixtures::roadsFor(params).network();
		const std::vector<Ruin>				ruins = ruinsOf(fixtures::placesFor(params));
		std::vector<std::span<const Point>> lines;
		for (const std::vector<RoadStretch>* stretches : {&network.stretches, &network.broken}) {
			for (const RoadStretch& stretch : *stretches) {
				lines.emplace_back(stretch.points);
			}
		}
		for (const RailLine& rail : dressing.rails) {
			lines.emplace_back(rail.points);
		}
		ASSERT_FALSE(dressing.districts.empty());
		EXPECT_EQ(dressing.districts.front().kind, DistrictKind::Metro);
		for (const StreetDistrict& district : dressing.districts) {
			const auto ruin = std::ranges::find(ruins, district.place, &Ruin::place);
			ASSERT_NE(ruin, ruins.end());
			const double						reach = 1.15 * ruin->radius + district.spacing;
			std::vector<std::span<const Point>> near;
			for (const std::span<const Point> line : lines) {
				if (std::ranges::any_of(line, [&](Point at) { return std::hypot(at.x - ruin->at.x, at.y - ruin->at.y) < reach + 150; })) {
					near.push_back(line);
				}
			}
			for (const std::vector<Point>* blocks : {&district.blocks, &district.rubble}) {
				for (const Point centre : *blocks) {
					ASSERT_LE(std::hypot(centre.x - ruin->at.x, centre.y - ruin->at.y), 1.15 * ruin->radius + 1e-9);
					for (const auto& [a, b] : {std::pair{0, 0}, std::pair{-1, -1}, std::pair{1, -1}, std::pair{1, 1}, std::pair{-1, 1}}) {
						const double half = district.spacing / 2;
						const Point	 at{
							 .x = centre.x + (district.ux * a - district.uy * b) * half,
							 .y = centre.y + (district.uy * a + district.ux * b) * half,
						 };
						ASSERT_EQ(ground.obstacle(at.x, at.y), Obstacle::None);
						ASSERT_EQ(ground.waterAt(at.x, at.y), WaterKind::None);
					}
					for (const std::span<const Point> line : near) {
						for (size_t point = 1; point < line.size(); ++point) {
							const double length = std::hypot(line[point].x - line[point - 1].x, line[point].y - line[point - 1].y);
							for (double along = 0; along <= length; along += 0.5) {
								const double share = length > 0 ? along / length : 0;
								const Point	 on{
									 .x = line[point - 1].x + (line[point].x - line[point - 1].x) * share,
									 .y = line[point - 1].y + (line[point].y - line[point - 1].y) * share,
								 };
								ASSERT_FALSE(insideBlock(district, centre, on)) << "a block stands on a line at " << on.x << ", " << on.y;
							}
						}
					}
				}
			}
		}
	}

	TEST_P(EveryDressing, OffersALabelForEveryPlacePoiAndHighwayAndSetsThemWithNoTwoOverlapping) {
		const MapParams&   params = *GetParam();
		const Dressing&	   dressing = fixtures::dressingFor(params);
		const Places&	   places = fixtures::placesFor(params);
		const PoiLayer&	   pois = fixtures::poisFor(params);
		const RoadNetwork& network = fixtures::roadsFor(params).network();
		const auto		   labelled = [&](LabelKind kind, int ref) {
			return std::ranges::count_if(dressing.labels, [&](const MapLabel& label) { return label.kind == kind && label.ref == ref; });
		};
		ASSERT_FALSE(dressing.labels.empty());
		EXPECT_EQ(dressing.labels.front().kind, LabelKind::Metro);
		EXPECT_EQ(dressing.labels.front().text, [&] {
			std::string upper = dressing.names.metro;
			std::ranges::transform(upper, upper.begin(), [](unsigned char letter) { return static_cast<char>(std::toupper(letter)); });
			return upper;
		}());
		for (size_t index = 1; index < dressing.labels.size(); ++index) {
			EXPECT_GE(dressing.labels[index - 1].priority, dressing.labels[index].priority);
		}
		for (const Settlement& town : places.towns()) {
			EXPECT_EQ(labelled(LabelKind::Town, town.id), 1) << town.name;
		}
		for (const Settlement& village : places.villages()) {
			EXPECT_EQ(labelled(LabelKind::Village, village.id), 1) << village.name;
		}
		for (size_t poi = 0; poi < pois.pois.size(); ++poi) {
			const LabelKind kind = pois.pois[poi].type == kStrongholdType ? LabelKind::Stronghold : LabelKind::Poi;
			EXPECT_EQ(labelled(kind, static_cast<int>(poi)), 1) << "poi " << poi;
		}
		for (size_t highway = 0; highway < network.routeNumbers.size(); ++highway) {
			const bool outside = std::ranges::any_of(network.stretches, [&](const RoadStretch& stretch) {
				return stretch.highway == static_cast<int>(highway) && !stretch.street;
			});
			if (outside) {
				EXPECT_GE(labelled(LabelKind::Shield, static_cast<int>(highway)), 1) << "highway " << highway;
			}
		}
		for (const MapLabel& label : dressing.labels) {
			if (label.kind == LabelKind::Shield) {
				EXPECT_EQ(label.text, std::to_string(network.routeNumbers[static_cast<size_t>(label.ref)]));
			}
			EXPECT_LE(std::hypot(label.at.x, label.at.y), params.radius + 1e-9) << label.text;
		}
		// Set at a size a screen might use, a few units a letter, no two meet.
		std::vector<LabelSize> sizes;
		for (const MapLabel& label : dressing.labels) {
			sizes.push_back(
				{.halfLength = 2.2 * static_cast<double>(label.text.size()), .halfHeight = 3, .offset = label.path.empty() ? 3.0 : 0.0}
			);
		}
		const std::vector<PlacedLabel> placed = placeLabels({.labels = dressing.labels, .sizes = sizes, .blocked = {}, .pad = 1});
		ASSERT_FALSE(placed.empty());
		EXPECT_EQ(placed.front().label, 0);
		for (size_t a = 0; a < placed.size(); ++a) {
			for (size_t b = a + 1; b < placed.size(); ++b) {
				if (placed[a].path.empty() && placed[b].path.empty()) {
					const LabelBox& first = placed[a].box;
					const LabelBox& second = placed[b].box;
					const bool apart = first.maxX + 1 <= second.minX || second.maxX + 1 <= first.minX || first.maxY + 1 <= second.minY ||
									   second.maxY + 1 <= first.minY;
					EXPECT_TRUE(apart) << dressing.labels[static_cast<size_t>(placed[a].label)].text << " and "
									   << dressing.labels[static_cast<size_t>(placed[b].label)].text;
				} else {
					EXPECT_FALSE(labelsMeet(placed[a], placed[b], 1));
				}
			}
		}
	}

	TEST(Dressing, MakesTheSameDressingFromItsStreamNamesAlikeAtAnyAmountAndLabelsOnlyWhatPlayUsesAtNone) {
		const MapParams& params = fixtures::mixed();
		const Dressing&	 dressing = fixtures::dressingFor(params);
		const Dressing	 again = fixtures::dressingOver(params, params);
		ASSERT_EQ(again.districts.size(), dressing.districts.size());
		for (size_t index = 0; index < dressing.districts.size(); ++index) {
			EXPECT_EQ(again.districts[index].blocks, dressing.districts[index].blocks);
			EXPECT_EQ(again.districts[index].rubble, dressing.districts[index].rubble);
		}
		ASSERT_EQ(again.rails.size(), dressing.rails.size());
		EXPECT_EQ(again.rails.front().points, dressing.rails.front().points);
		EXPECT_EQ(again.stipple, dressing.stipple);
		EXPECT_EQ(again.labels.size(), dressing.labels.size());

		const Dressing none = fixtures::dressingOver(params, fixtures::with(params, &MapParams::dressing, 0));
		const Dressing full = fixtures::dressingOver(params, fixtures::with(params, &MapParams::dressing, 1));
		for (const Dressing* other : {&none, &full}) {
			EXPECT_EQ(other->names.metro, dressing.names.metro);
			ASSERT_EQ(other->names.rivers.size(), dressing.names.rivers.size());
			for (size_t index = 0; index < dressing.names.rivers.size(); ++index) {
				EXPECT_EQ(other->names.rivers[index].name, dressing.names.rivers[index].name);
			}
			EXPECT_EQ(other->names.passes, dressing.names.passes);
		}
		EXPECT_TRUE(none.districts.empty());
		EXPECT_TRUE(none.rails.empty());
		EXPECT_TRUE(none.hatches.empty());
		EXPECT_TRUE(none.stipple.empty());
		const std::set<LabelKind> play{
			LabelKind::Metro, LabelKind::Stronghold, LabelKind::Poi, LabelKind::Town, LabelKind::Shield, LabelKind::Village
		};
		size_t played = 0;
		for (const MapLabel& label : dressing.labels) {
			played += play.contains(label.kind) ? 1 : 0;
		}
		EXPECT_EQ(none.labels.size(), played);
		EXPECT_TRUE(std::ranges::all_of(none.labels, [&](const MapLabel& label) { return play.contains(label.kind); }));
		// More of the land's features are labelled as it rises, and the grids keep to streetGrids above the default.
		EXPECT_GT(full.labels.size(), dressing.labels.size());
		EXPECT_GT(full.stipple.size(), dressing.stipple.size());
		EXPECT_EQ(full.districts.size(), dressing.districts.size());
	}

} // namespace
