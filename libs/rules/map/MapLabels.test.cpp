#include <rules/core/ContentError.h>
#include <rules/map/FeatureNames.h>
#include <rules/map/LabelLayout.h>
#include <rules/map/MapLabels.h>
#include <rules/map/MapTesting.h>

#include <gtest/gtest.h>

#include <cmath>
#include <filesystem>
#include <fstream>
#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace {

	using namespace rules::map;
	namespace fs = std::filesystem;

	TEST(FeatureNames, ReadsThePoolStrictlyNamingTheFile) {
		const FeatureNamePool& pool = fixtures::content().featureNames;
		EXPECT_EQ(pool.roots.size(), 40U);
		EXPECT_EQ(pool.patterns[static_cast<size_t>(FeatureKind::Lake)], "Lake {root}");
		const fs::path folder = fs::temp_directory_path() / "ddb-feature-names";
		fs::remove_all(folder);
		fs::create_directories(folder);
		const auto errorFrom = [&](std::string_view patterns, std::string_view roots = R"(["Mercer"])") {
			const fs::path file = folder / "feature-names.json";
			std::ofstream(file, std::ios::binary) << R"({"roots": )" << roots << R"(, "patterns": {)" << patterns << "}}";
			try {
				(void)readFeatureNames(file);
			} catch (const rules::ContentError& error) {
				return std::string(error.what());
			}
			return std::string();
		};
		const std::string every =
			R"("river": "{root} River", "creek": "{root} Creek", "lake": "Lake {root}", "reservoir": "{root} Reservoir", )"
			R"("mountains": "{root} Mountains", "hills": "{root} Hills", "pass": "{root} Pass")";
		EXPECT_EQ(errorFrom(every), "");
		EXPECT_NE(errorFrom(every, R"(["Mercer", "Mercer"])").find("lists \"Mercer\" twice"), std::string::npos);
		EXPECT_NE(errorFrom(every, "[]").find("roots must list at least one root"), std::string::npos);
		EXPECT_NE(errorFrom(R"("river": "{root} River")").find("creek is required"), std::string::npos);
		EXPECT_NE(
			errorFrom(std::string(every).replace(every.find("Lake {root}"), 11, "Lake")).find("must hold {root} once"), std::string::npos
		);
		EXPECT_NE(errorFrom(every + R"(, "canal": "{root} Canal")").find("fields nothing reads: canal"), std::string::npos);
		EXPECT_NE(
			errorFrom(std::string(every).replace(every.find("{root} Hills"), 12, "{root} Hills {root}")).find("must hold {root} once"),
			std::string::npos
		);
		fs::remove_all(folder);
	}

	TEST(FeatureNames, HandsOutEveryRootOnceThenComesRoundAgainNumbered) {
		FeatureNamePool pool = fixtures::content().featureNames;
		pool.roots = {"Mercer", "Tull"};
		FeatureNamer		  namer(pool, foundation::Rng(3));
		std::set<std::string> first{namer.next(FeatureKind::River), namer.next(FeatureKind::River)};
		EXPECT_EQ(first, (std::set<std::string>{"Mercer River", "Tull River"}));
		const std::string again = namer.next(FeatureKind::Lake);
		EXPECT_TRUE(again == "Lake Mercer 2" || again == "Lake Tull 2") << again;
	}

	class EveryMapNames : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(
		MapLabels,
		EveryMapNames,
		::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::badlands())
	);

	MapNames namesFor(const MapParams& params, uint32_t seed) {
		return nameMap({
			.terrain = fixtures::terrainFor(params),
			.water = fixtures::waterFor(params),
			.places = fixtures::placesFor(params),
			.passes = {},
			.placeNames = fixtures::placeNames(),
			.featureNames = fixtures::content().featureNames,
			.stream = foundation::Rng(seed),
		});
	}

	TEST_P(EveryMapNames, NamesTheMetroAsNoTownOrVillageIsAndEveryFeatureBigEnoughOnceTheSameEveryTime) {
		const MapParams&	  params = *GetParam();
		const Places&		  places = fixtures::placesFor(params);
		const Water&		  water = fixtures::waterFor(params);
		const MapNames		  names = namesFor(params, 11);
		std::set<std::string> taken;
		for (const std::vector<Settlement>* settlements : {&places.towns(), &places.villages()}) {
			for (const Settlement& settlement : *settlements) {
				taken.insert(settlement.name);
				for (const std::string& start : fixtures::placeNames().starts) {
					if (settlement.name.starts_with(start)) {
						EXPECT_FALSE(names.metro.starts_with(start)) << names.metro << " starts as " << settlement.name << " does";
					}
				}
			}
		}
		EXPECT_FALSE(names.metro.empty());
		EXPECT_FALSE(taken.contains(names.metro));
		std::set<std::string> features;
		const double		  radius = params.radius;
		for (const NamedRiver& river : names.rivers) {
			const River& line = water.rivers()[static_cast<size_t>(river.river)];
			EXPECT_GE(line.area, 4 * water.threshold());
			EXPECT_TRUE(river.name.ends_with(line.area >= 25 * water.threshold() ? " River" : " Creek")) << river.name;
			EXPECT_GE(polylineLength(river.course), 120);
			for (const Point at : river.course) {
				EXPECT_LE(std::hypot(at.x, at.y), 0.92 * radius + 1e-9);
			}
			EXPECT_TRUE(features.insert(river.name).second) << river.name;
		}
		for (const NamedLake& lake : names.lakes) {
			const Lake& held = water.lakes()[static_cast<size_t>(lake.lake)];
			EXPECT_GE(held.cells, 3);
			EXPECT_TRUE(lake.name.starts_with("Lake ") == (held.kind == LakeKind::Natural)) << lake.name;
			EXPECT_EQ(fixtures::groundFor(params).waterAt(lake.at.x, lake.at.y), WaterKind::Lake) << lake.name;
			EXPECT_TRUE(features.insert(lake.name).second) << lake.name;
		}
		for (size_t index = 0; index < names.ranges.size(); ++index) {
			const NamedRange& range = names.ranges[index];
			EXPECT_GE(range.cells, 30);
			if (index > 0) {
				EXPECT_LE(range.cells, names.ranges[index - 1].cells);
			}
			EXPECT_NEAR(std::hypot(range.axis.x, range.axis.y), 1, 1e-9);
			EXPECT_TRUE(range.axis.x > 0 || (range.axis.x == 0 && range.axis.y > 0)) << range.name;
			EXPECT_TRUE(range.name.ends_with(range.mountains ? " Mountains" : " Hills")) << range.name;
			EXPECT_TRUE(features.insert(range.name).second) << range.name;
		}
		const MapNames again = namesFor(params, 11);
		EXPECT_EQ(again.metro, names.metro);
		ASSERT_EQ(again.ranges.size(), names.ranges.size());
		for (size_t index = 0; index < names.ranges.size(); ++index) {
			EXPECT_EQ(again.ranges[index].name, names.ranges[index].name);
		}
	}

	TEST(MapNames, FindsMountainsInTheBadlandsAndAMetroAsNoPlaceIsOnASmallPool) {
		const MapNames names = namesFor(fixtures::badlands(), 5);
		ASSERT_FALSE(names.ranges.empty());
		EXPECT_TRUE(names.ranges.front().mountains);
		PlaceNamePool				   tiny{.starts = {"Ash", "Elk"}, .endings = {"ford"}};
		const std::vector<std::string> taken{"Ashford"};
		EXPECT_EQ(PlaceNamer(tiny, foundation::Rng(1), taken).next(), "Elkford");
	}

	MapLabel pointLabel(std::string text, Point at, LabelKind kind = LabelKind::Town) {
		return {
			.kind = kind, .text = std::move(text), .priority = kLabelPriority[static_cast<size_t>(kind)], .at = at, .path = {}, .ref = 0
		};
	}

	TEST(LabelLayout, SetsEachLabelInItsFirstClearSpotHighestFirstAndDropsOneWithNone) {
		// Five towns on one anchor take its right, left, top, and bottom in turn, and the fifth is dropped; a river's
		// label is set along its path's middle, and drops the village on its water; a town walled in by a marker is
		// dropped.
		std::vector<MapLabel> labels;
		for (const std::string_view name : {"Elkford", "Ashton", "Coldfield", "Irondale", "Redwood"}) {
			labels.push_back(pointLabel(std::string(name), {.x = 0, .y = 0}));
		}
		labels.push_back({
			.kind = LabelKind::River,
			.text = "Mercer River",
			.priority = 55,
			.at = {.x = 0, .y = 100},
			.path = {{.x = -100, .y = 100}, {.x = 100, .y = 100}},
			.ref = 0,
		});
		labels.push_back(pointLabel("Underwater", {.x = 0, .y = 103}, LabelKind::Village));
		labels.push_back(pointLabel("Walled", {.x = 200, .y = 0}, LabelKind::Village));
		const LabelSize				   town{.halfLength = 10, .halfHeight = 3, .offset = 5};
		const LabelSize				   village{.halfLength = 10, .halfHeight = 3, .offset = 0};
		const LabelSize				   river{.halfLength = 30, .halfHeight = 3, .offset = 0};
		const std::vector<LabelSize>   sizes{town, town, town, town, town, river, village, town};
		const std::vector<LabelBox>	   markers{{.minX = 180, .minY = -20, .maxX = 220, .maxY = 20}};
		const std::vector<PlacedLabel> placed = placeLabels({.labels = labels, .sizes = sizes, .blocked = markers, .pad = 1});
		ASSERT_EQ(placed.size(), 5U);
		EXPECT_EQ(placed[0].label, 0);
		EXPECT_DOUBLE_EQ(placed[0].box.minX, 5);
		EXPECT_EQ(placed[1].label, 1);
		EXPECT_DOUBLE_EQ(placed[1].box.maxX, -5);
		EXPECT_EQ(placed[2].label, 2);
		EXPECT_DOUBLE_EQ(placed[2].box.minY, 5);
		EXPECT_EQ(placed[3].label, 3);
		EXPECT_DOUBLE_EQ(placed[3].box.maxY, -5);
		EXPECT_EQ(placed[4].label, 5);
		ASSERT_EQ(placed[4].path.size(), 2U);
		EXPECT_DOUBLE_EQ(placed[4].path.front().x, -30);
		EXPECT_DOUBLE_EQ(placed[4].path.back().x, 30);
		for (size_t a = 0; a < placed.size(); ++a) {
			for (size_t b = a + 1; b < placed.size(); ++b) {
				EXPECT_FALSE(labelsMeet(placed[a], placed[b], 1)) << a << " and " << b;
			}
		}
		// Set along its path, a label longer than the path is dropped, and the village it covered is set instead.
		std::vector<LabelSize> longer = sizes;
		longer[5].halfLength = 150;
		const std::vector<PlacedLabel> without = placeLabels({.labels = labels, .sizes = longer, .blocked = markers, .pad = 1});
		ASSERT_EQ(without.size(), 5U);
		EXPECT_EQ(without[4].label, 6);
	}

} // namespace
