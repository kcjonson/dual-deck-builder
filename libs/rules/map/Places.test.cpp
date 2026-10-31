#include <rules/core/ContentError.h>
#include <rules/map/Ground.h>
#include <rules/map/MapTesting.h>
#include <rules/map/Places.h>

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

	Places placesWith(const MapParams& land, const MapParams& params) {
		return {
			params,
			fixtures::terrainFor(land),
			fixtures::waterFor(land),
			fixtures::hazardsFor(land),
			fixtures::placeNames(),
			fixtures::placesStream(land),
		};
	}

	double arc(double from, double to) {
		const double turned = std::fmod(to - from, 360);
		return turned < 0 ? turned + 360 : turned;
	}

	class EveryPlaces : public ::testing::TestWithParam<const MapParams*> {};

	INSTANTIATE_TEST_SUITE_P(
		Places,
		EveryPlaces,
		::testing::Values(&fixtures::mixed(), &fixtures::floodlands(), &fixtures::basin(), &fixtures::badlands())
	);

	TEST_P(EveryPlaces, SettlesTheTownsAndVillagesAskedForSpacedOnTheBestGroundOffCratersAndLakes) {
		const MapParams& params = *GetParam();
		const Places&	 places = fixtures::placesFor(params);
		const Terrain&	 terrain = fixtures::terrainFor(params);
		EXPECT_EQ(places.metroRadius(), terrain.start().metro);
		ASSERT_EQ(places.towns().size(), static_cast<size_t>(params.towns));
		ASSERT_EQ(places.villages().size(), static_cast<size_t>(params.villages));
		std::vector<const Settlement*> all;
		for (const Settlement& town : places.towns()) {
			all.push_back(&town);
		}
		for (const Settlement& village : places.villages()) {
			all.push_back(&village);
		}
		for (size_t index = 0; index < all.size(); ++index) {
			const Settlement& place = *all[index];
			const bool		  town = place.kind == SettlementKind::Town;
			const double	  away = std::hypot(place.x, place.y);
			EXPECT_GE(away - place.radius, terrain.start().blend);
			EXPECT_LE(away + place.radius, 0.92 * params.radius);
			EXPECT_GE(place.radius, town ? 20 : 8);
			EXPECT_LE(place.radius, std::max(town ? 20.0 : 8.0, terrain.start().metro * (town ? 0.4 : 0.14)));
			for (const Hotspot& site : fixtures::hazardsFor(params).hotspots()) {
				EXPECT_GE(std::hypot(place.x - site.x, place.y - site.y), site.craterRadius + place.radius + 20);
			}
			for (size_t other = 0; other < index; ++other) {
				const double spacing = (town ? 0.25 : 0.1) * params.radius;
				EXPECT_GE(std::hypot(place.x - all[other]->x, place.y - all[other]->y), spacing - 1e-9);
			}
			if (index > 0 && all[index - 1]->kind == place.kind) {
				EXPECT_LE(place.suitability, all[index - 1]->suitability) << "best ground first";
			}
		}
	}

	TEST_P(EveryPlaces, StandsEveryPlaceOnGroundARoadFromTheMetroSurelyReachesClearOfWater) {
		const MapParams& params = *GetParam();
		const Places&	 places = fixtures::placesFor(params);
		const Ground	 ground(fixtures::terrainFor(params), fixtures::waterFor(params), fixtures::hazardsFor(params));
		EXPECT_TRUE(checkPlaces(places, ground.terrain(), ground.water(), fixtures::hazardsFor(params)).empty());
		std::vector<std::pair<double, double>> standing;
		for (const Settlement& town : places.towns()) {
			standing.emplace_back(town.x, town.y);
		}
		for (const Settlement& village : places.villages()) {
			standing.emplace_back(village.x, village.y);
		}
		for (const Crossroads& crossroads : places.crossroads()) {
			standing.emplace_back(crossroads.x, crossroads.y);
		}
		for (const auto& [x, y] : standing) {
			EXPECT_EQ(ground.obstacle(x, y), Obstacle::None);
			EXPECT_FALSE(ground.rivers().near(x, y, 4)) << "a place stands by a river's water";
			EXPECT_FALSE(ground.terrain().fields().rough(x, y));
			EXPECT_LT(ground.terrain().mountains(x, y), 0.5 + 1e-9);
		}
		for (const Exit& exit : places.exits()) {
			EXPECT_EQ(ground.obstacle(exit.x, exit.y), Obstacle::None);
			EXPECT_FALSE(ground.rivers().near(exit.x, exit.y, 4));
		}
	}

	TEST_P(EveryPlaces, LeavesByHighwaysAtTheRimTheSeparationApartWithBackRoadsBetween) {
		const MapParams&	params = *GetParam();
		const Places&		places = fixtures::placesFor(params);
		const double		cell = fixtures::terrainFor(params).surface().grid.cellSize;
		std::vector<double> highways;
		std::vector<double> backRoads;
		for (const Exit& exit : places.exits()) {
			const double away = std::hypot(exit.x, exit.y);
			EXPECT_LE(away, params.radius - 1.5 * cell + 1e-9);
			EXPECT_GE(away, params.radius - 7.5 * cell - 1e-9);
			(exit.highway ? highways : backRoads).push_back(exit.bearing);
		}
		ASSERT_EQ(highways.size(), static_cast<size_t>(params.highways));
		for (size_t index = 0; index < highways.size(); ++index) {
			EXPECT_GE(arc(highways[index], highways[(index + 1) % highways.size()]), params.highwaySeparation - 1e-9);
		}
		for (const double back : backRoads) {
			for (const double highway : highways) {
				EXPECT_GE(std::min(arc(back, highway), arc(highway, back)), 12 - 1e-9);
			}
		}
	}

	TEST_P(EveryPlaces, NumbersThePlacesInOrderAndNamesNoTwoAlike) {
		const Places&		  places = fixtures::placesFor(*GetParam());
		int					  id = 1;
		std::set<std::string> names;
		for (const Settlement& town : places.towns()) {
			EXPECT_EQ(town.id, id++);
			EXPECT_TRUE(names.insert(town.name).second) << town.name;
		}
		for (const Settlement& village : places.villages()) {
			EXPECT_EQ(village.id, id++);
			EXPECT_TRUE(names.insert(village.name).second) << village.name;
		}
		for (const Crossroads& crossroads : places.crossroads()) {
			EXPECT_EQ(crossroads.id, id++);
		}
		for (const Exit& exit : places.exits()) {
			EXPECT_EQ(exit.id, id++);
		}
	}

	TEST(Places, SpacesCrossroadsByRoadDensityAndKeepsThemOffTheOtherPlaces) {
		const MapParams& land = fixtures::mixed();
		const Places	 sparse = placesWith(land, fixtures::with(land, &MapParams::roadDensity, 0));
		const Places	 dense = placesWith(land, fixtures::with(land, &MapParams::roadDensity, 1));
		EXPECT_GT(dense.crossroads().size(), 2 * sparse.crossroads().size());
		const auto& crossroads = dense.crossroads();
		for (size_t index = 0; index < crossroads.size(); ++index) {
			for (size_t other = 0; other < index; ++other) {
				EXPECT_GE(std::hypot(crossroads[index].x - crossroads[other].x, crossroads[index].y - crossroads[other].y), 70 - 1e-9);
			}
			for (const Settlement& town : dense.towns()) {
				EXPECT_GE(std::hypot(crossroads[index].x - town.x, crossroads[index].y - town.y), 0.75 * 70 - 1e-9);
			}
		}
	}

	TEST(Places, MovesNoTownOrExitWhenMoreVillagesAreAskedFor) {
		const MapParams& land = fixtures::mixed();
		MapParams		 more = land;
		more.villages = 30;
		const Places& base = fixtures::placesFor(land);
		const Places  crowded = placesWith(land, more);
		EXPECT_GT(crowded.villages().size(), base.villages().size());
		ASSERT_EQ(crowded.towns().size(), base.towns().size());
		for (size_t index = 0; index < base.towns().size(); ++index) {
			EXPECT_EQ(crowded.towns()[index].x, base.towns()[index].x);
			EXPECT_EQ(crowded.towns()[index].name, base.towns()[index].name);
		}
		ASSERT_EQ(crowded.exits().size(), base.exits().size());
		for (size_t index = 0; index < base.exits().size(); ++index) {
			EXPECT_EQ(crowded.exits()[index].bearing, base.exits()[index].bearing);
		}
	}

	TEST(PlaceNames, HandsOutNamesNoTwoAlikeNoFirstPartTwiceWhileOneIsLeftThenNumbered) {
		const PlaceNamePool& pool = fixtures::placeNames();
		EXPECT_EQ(pool.starts.size(), 35U);
		EXPECT_EQ(pool.endings.size(), 22U);
		PlaceNamer			  namer(pool, foundation::Rng(5));
		std::set<std::string> names;
		std::set<std::string> starts;
		for (size_t index = 0; index < pool.starts.size(); ++index) {
			const std::string name = namer.next();
			EXPECT_TRUE(names.insert(name).second);
			for (const std::string& start : pool.starts) {
				if (name.starts_with(start)) {
					starts.insert(start);
				}
			}
		}
		EXPECT_EQ(starts.size(), pool.starts.size());
		const PlaceNamePool tiny{.starts = {"Ash"}, .endings = {"ford"}};
		PlaceNamer			numbered(tiny, foundation::Rng(5));
		EXPECT_EQ(numbered.next(), "Ashford");
		EXPECT_EQ(numbered.next(), "Ashford 2");
		EXPECT_EQ(numbered.next(), "Ashford 3");
	}

	TEST(PlaceNames, ReadsThePoolStrictlyNamingTheFile) {
		const fs::path folder = fs::temp_directory_path() / "ddb-place-names";
		fs::remove_all(folder);
		fs::create_directories(folder);
		const auto errorFrom = [&](std::string_view text) {
			const fs::path file = folder / "place-names.json";
			std::ofstream(file, std::ios::binary) << text;
			try {
				(void)readPlaceNames(file);
			} catch (const rules::ContentError& error) {
				return std::string(error.what());
			}
			return std::string();
		};
		EXPECT_NE(errorFrom(R"({"starts": ["Ash"]})").find("endings is required"), std::string::npos);
		EXPECT_NE(errorFrom(R"({"starts": [], "endings": ["ford"]})").find("starts must list at least one word"), std::string::npos);
		EXPECT_NE(errorFrom(R"({"starts": ["Ash", "Ash"], "endings": ["ford"]})").find("lists \"Ash\" twice"), std::string::npos);
		EXPECT_NE(
			errorFrom(R"({"starts": ["Ash"], "endings": ["ford"], "rivers": []})").find("fields nothing reads: rivers"), std::string::npos
		);
		fs::remove_all(folder);
	}

} // namespace
