#include "scenes/compound/CompoundPlate.h"

#include "Fonts.h"
#include "atlas/Ink.h"
#include "atlas/Tokens.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>

#include <nlohmann/json.hpp>

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <cmath>
#include <numbers>
#include <string>

namespace game {

	namespace {

		using Foundation::Color;
		using Foundation::Rect;
		using Foundation::Vec2;
		namespace palette = atlas::tokens::palette;
		namespace Primitives = Renderer::Primitives;

		constexpr Vec2	kPlate{920.0F, 760.0F};
		constexpr float kPi = std::numbers::pi_v<float>;

		constexpr Color colour(uint32_t rgb, float alpha = 1.0F) {
			return {
				static_cast<float>((rgb >> 16U) & 255U) / 255.0F,
				static_cast<float>((rgb >> 8U) & 255U) / 255.0F,
				static_cast<float>(rgb & 255U) / 255.0F,
				alpha,
			};
		}

		// The plate's own colours: dirt, scrap and tin are art, not print, so they live here rather than in the theme, as
		// the area map's do.
		namespace art {
			constexpr Color				   kDirt = colour(0xC2AE88);
			constexpr Color				   kDirtDark = colour(0x7A6244, 0.09F);
			constexpr Color				   kDirtLight = colour(0xE8DCBC, 0.13F);
			constexpr Color				   kRuts = colour(0x8C7655, 0.5F);
			constexpr Color				   kFenceUnder = colour(0x2A2521);
			constexpr std::array<Color, 4> kScrap{colour(0x6E6A61), colour(0x8E5B3A), colour(0x5C6B5E), colour(0x7D7A70)};
			constexpr Color				   kPost = colour(0x1F1B18);
			constexpr Color				   kGateLeaf = colour(0x4A4540);
			constexpr Color				   kAsphalt = colour(0x7A766F);
			constexpr Color				   kTin = colour(0x9EA19B);
			constexpr Color				   kTinLight = colour(0xB8BAB3);
			constexpr Color				   kTinDark = colour(0x80837E);
			constexpr Color				   kRust = colour(0x8E5B3A);
			constexpr Color				   kRustLight = colour(0xA66C45);
			constexpr Color				   kRustDark = colour(0x734630);
			constexpr Color				   kRoofEdge = colour(0x4A4C48);
			constexpr Color				   kRidge = colour(0x6E716C);
			constexpr Color				   kShadow = colour(0x000000, 0.35F);
			constexpr Color				   kGlass = colour(0x5E7F8C, 0.8F);
			constexpr Color				   kCrate = colour(0x5B4A36);
			constexpr Color				   kCrateEdge = colour(0x3A3024);
			constexpr Color				   kTyre = colour(0x2D2B29);
			constexpr Color				   kTyreRim = colour(0x4A4743);
			constexpr Color				   kWreck = colour(0x6E6A61);
			constexpr Color				   kWreckEdge = colour(0x3A3530);
			constexpr Color				   kString = colour(0xF4EEDD);
			constexpr Color				   kTank = colour(0x6C8A93);
			constexpr Color				   kTankRim = colour(0x45585E);
			constexpr Color				   kRigBody = colour(0x7A4A2E);
			constexpr Color				   kRigEdge = colour(0x3A2418);
			constexpr Color				   kRigCab = colour(0x4A2D1E);
			constexpr Color				   kRigBed = colour(0x5E3A26);
			constexpr Color				   kBikeBody = colour(0x2E5E5B);
			constexpr Color				   kBikeEdge = colour(0x183634);
		} // namespace art

		struct BuildingArt {
			Building		 building;
			std::string_view id;
			std::string_view name;
			std::string_view description;
			Rect			 plot;
		};

		// The canvas's plots, in the campaign's order.
		constexpr std::array<BuildingArt, 6> kArt{{
			{Building::Bunkhouse,
			 "bunkhouse",
			 "Bunkhouse",
			 "Drivers, settlers, and the Crew screen, where default decks are built.",
			 {120.0F, 126.0F, 270.0F, 140.0F}},
			{Building::RadioMast,
			 "radio_mast",
			 "Radio mast",
			 "Rumors: new POIs, and roads into the fog.",
			 {480.0F, 120.0F, 110.0F, 110.0F}},
			{Building::Infirmary,
			 "infirmary",
			 "Infirmary",
			 "Injured drivers heal over days; meds speed it up.",
			 {470.0F, 280.0F, 190.0F, 110.0F}},
			{Building::MapRoom, "map_room", "Map room", "The area map, to plan a supply run.", {120.0F, 320.0F, 160.0F, 110.0F}},
			{Building::Garage, "garage", "Garage", "Cards, mods, and escort repair and hire.", {110.0F, 480.0F, 250.0F, 150.0F}},
			{Building::Stores, "stores", "Stores", "The resource ledger and its forecast.", {430.0F, 560.0F, 200.0F, 110.0F}},
		}};

		const BuildingArt& artOf(Building building) {
			return kArt.at(static_cast<size_t>(building));
		}

		Rect inset(const Rect& rect, float by) {
			return {rect.x + by, rect.y + by, rect.width - 2.0F * by, rect.height - 2.0F * by};
		}

		void fill(const Rect& rect, Color color, int32_t key) {
			Primitives::drawRect({.bounds = rect, .style = {.fill = color}, .key = key});
		}

		void framed(const Rect& rect, Color color, Color edge, float width, int32_t key, float radius = 0.0F) {
			Primitives::drawRect({
				.bounds = rect,
				.style = {.fill = color, .border = Foundation::BorderStyle{.color = edge, .width = width, .cornerRadius = radius}},
				.key = key,
			});
		}

		std::vector<Vec2> cubic(Vec2 from, Vec2 c1, Vec2 c2, Vec2 to, int steps) {
			std::vector<Vec2> points;
			for (int step = 0; step <= steps; ++step) {
				const float t = static_cast<float>(step) / static_cast<float>(steps);
				const float u = 1.0F - t;
				points.push_back(from * (u * u * u) + c1 * (3.0F * u * u * t) + c2 * (3.0F * u * t * t) + to * (t * t * t));
			}
			return points;
		}

		void polyline(const std::vector<Vec2>& points, float width, Color color, int32_t key) {
			Primitives::drawPolyline(
				{.points = points,
				 .width = width,
				 .color = color,
				 .cap = Primitives::LineCap::Butt,
				 .join = Primitives::LineJoin::Round,
				 .key = key}
			);
		}

		// Dashes along a polyline, `on` then `off`, from its start.
		void dashAlong(const std::vector<Vec2>& points, float on, float off, float width, Color color, int32_t key) {
			float phase = 0.0F; // how far into the current on-off period
			for (size_t index = 1; index < points.size(); ++index) {
				const Vec2	from = points[index - 1];
				const Vec2	along = points[index] - from;
				const float length = std::sqrt(along.x * along.x + along.y * along.y);
				float		at = 0.0F;
				while (at < length) {
					const float left = (phase < on ? on : on + off) - phase;
					const float step = std::min(left, length - at);
					if (phase < on) {
						Primitives::drawLine({
							.start = from + along * (at / length),
							.end = from + along * ((at + step) / length),
							.style = {.color = color, .width = width},
							.key = key,
						});
					}
					at += step;
					phase = std::fmod(phase + step, on + off);
				}
			}
		}

		// Packed dirt's mottling: small ragged patches, darker and lighter, scattered once by a fixed seed.
		struct DirtPatches {
			std::vector<Vec2>	  dark;
			std::vector<Vec2>	  light;
			std::vector<uint16_t> darkIndices;
			std::vector<uint16_t> lightIndices;
		};

		const DirtPatches& dirtPatches() {
			static const DirtPatches kPatches = [] {
				DirtPatches patches;
				uint32_t	state = 0x2f6b1dU;
				const auto	next = [&state] {
					 state = state * 1664525U + 1013904223U;
					 return static_cast<float>(state) / 4294967296.0F;
				};
				for (int index = 0; index < 260; ++index) {
					const Vec2			   centre{next() * kPlate.x, next() * kPlate.y};
					const float			   radius = next() < 0.85F ? 3.0F + next() * 9.0F : 12.0F + next() * 14.0F;
					const float			   stretch = 0.55F + next() * 0.9F;
					const float			   turn = next() * kPi;
					const int			   sides = 6 + static_cast<int>(next() * 4.0F);
					const bool			   light = next() < 0.45F;
					std::vector<Vec2>&	   vertices = light ? patches.light : patches.dark;
					std::vector<uint16_t>& indices = light ? patches.lightIndices : patches.darkIndices;
					const auto			   first = static_cast<uint16_t>(vertices.size());
					vertices.push_back(centre);
					for (int side = 0; side < sides; ++side) {
						const float angle = static_cast<float>(side) / static_cast<float>(sides) * 2.0F * kPi;
						const float reach = radius * (0.55F + next() * 0.6F);
						const float along = std::cos(angle) * reach * stretch;
						const float across = std::sin(angle) * reach;
						vertices.push_back({
							std::clamp(centre.x + along * std::cos(turn) - across * std::sin(turn), 0.0F, kPlate.x),
							std::clamp(centre.y + along * std::sin(turn) + across * std::cos(turn), 0.0F, kPlate.y),
						});
					}
					for (int side = 0; side < sides; ++side) {
						indices.push_back(first);
						indices.push_back(static_cast<uint16_t>(first + 1 + side));
						indices.push_back(static_cast<uint16_t>(first + 1 + (side + 1) % sides));
					}
				}
				return patches;
			}();
			return kPatches;
		}

		void drawDirt(int32_t key) {
			const DirtPatches& patches = dirtPatches();
			Primitives::drawTriangles({
				.vertices = patches.dark.data(),
				.indices = patches.darkIndices.data(),
				.vertexCount = patches.dark.size(),
				.indexCount = patches.darkIndices.size(),
				.color = art::kDirtDark,
				.key = key,
			});
			Primitives::drawTriangles({
				.vertices = patches.light.data(),
				.indices = patches.lightIndices.data(),
				.vertexCount = patches.light.size(),
				.indexCount = patches.lightIndices.size(),
				.color = art::kDirtLight,
				.key = key,
			});
		}

		// The road out of the gate, on to `east`, the plate box's east edge in the canvas's units, which is past the canvas
		// when the box is wider than the yard.
		void drawRoad(float east, Color casing, Color highway, int32_t key) {
			static const std::vector<Vec2> kCurve = cubic({700.0F, 410.0F}, {780.0F, 404.0F}, {860.0F, 396.0F}, {930.0F, 390.0F}, 12);
			static const std::vector<Vec2> kCentreCurve = cubic({720.0F, 409.0F}, {790.0F, 403.0F}, {860.0F, 396.0F}, {930.0F, 390.0F}, 12);
			std::vector<Vec2>			   road = kCurve;
			std::vector<Vec2>			   centre = kCentreCurve;
			if (east > road.back().x) {
				road.push_back({east + 30.0F, 390.0F - (east + 30.0F - 930.0F) * 0.08F});
				centre.push_back(road.back());
			}
			static const std::array<std::vector<Vec2>, 2> kRuts{
				[] {
					std::vector<Vec2>		rut = cubic({690.0F, 400.0F}, {600.0F, 400.0F}, {520.0F, 420.0F}, {470.0F, 470.0F}, 10);
					const std::vector<Vec2> on = cubic({470.0F, 470.0F}, {430.0F, 510.0F}, {380.0F, 520.0F}, {300.0F, 520.0F}, 10);
					rut.insert(rut.end(), on.begin() + 1, on.end());
					return rut;
				}(),
				[] {
					std::vector<Vec2>		rut = cubic({690.0F, 422.0F}, {600.0F, 422.0F}, {530.0F, 440.0F}, {486.0F, 484.0F}, 10);
					const std::vector<Vec2> on = cubic({486.0F, 484.0F}, {446.0F, 524.0F}, {390.0F, 540.0F}, {300.0F, 540.0F}, 10);
					rut.insert(rut.end(), on.begin() + 1, on.end());
					return rut;
				}(),
			};
			polyline(road, 46.0F, casing, key);
			polyline(road, 38.0F, art::kAsphalt, key);
			dashAlong(centre, 18.0F, 16.0F, 3.0F, atlas::withAlpha(highway, 0.8F), key);
			for (const std::vector<Vec2>& rut : kRuts) {
				polyline(rut, 7.0F, art::kRuts, key);
			}
		}

		void drawFence(int32_t key) {
			struct Run {
				Vec2   from;
				Vec2   to;
				size_t scrap;
			};
			static constexpr std::array<Run, 14> kRuns{{
				{{60, 70}, {240, 70}, 0},
				{{240, 70}, {380, 70}, 1},
				{{380, 70}, {560, 70}, 2},
				{{560, 70}, {700, 70}, 3},
				{{700, 70}, {700, 200}, 1},
				{{700, 200}, {700, 360}, 0},
				{{700, 460}, {700, 600}, 2},
				{{700, 600}, {700, 700}, 1},
				{{60, 700}, {260, 700}, 3},
				{{260, 700}, {480, 700}, 1},
				{{480, 700}, {700, 700}, 0},
				{{60, 70}, {60, 300}, 2},
				{{60, 300}, {60, 520}, 3},
				{{60, 520}, {60, 700}, 1},
			}};
			polyline({{60.0F, 70.0F}, {700.0F, 70.0F}, {700.0F, 360.0F}}, 12.0F, art::kFenceUnder, key);
			polyline({{700.0F, 460.0F}, {700.0F, 700.0F}, {60.0F, 700.0F}}, 12.0F, art::kFenceUnder, key);
			polyline({{60.0F, 70.0F}, {60.0F, 700.0F}}, 12.0F, art::kFenceUnder, key);
			for (const Run& run : kRuns) {
				Primitives::drawLine(
					{.start = run.from, .end = run.to, .style = {.color = art::kScrap.at(run.scrap), .width = 8.0F}, .key = key}
				);
			}
			for (float x = 60.0F; x <= 700.0F; x += 80.0F) {
				fill({x - 4.0F, 66.0F, 8.0F, 8.0F}, art::kPost, key);
				fill({x - 4.0F, 696.0F, 8.0F, 8.0F}, art::kPost, key);
			}
			for (float y = 150.0F; y < 700.0F; y += 80.0F) {
				fill({56.0F, y - 4.0F, 8.0F, 8.0F}, art::kPost, key);
				if (y < 350.0F || y > 470.0F) {
					fill({696.0F, y - 4.0F, 8.0F, 8.0F}, art::kPost, key);
				}
			}
			fill({694.0F, 350.0F, 14.0F, 14.0F}, art::kPost, key);
			fill({694.0F, 456.0F, 14.0F, 14.0F}, art::kPost, key);
			Primitives::drawLine(
				{.start = {701.0F, 364.0F}, .end = {742.0F, 380.0F}, .style = {.color = art::kGateLeaf, .width = 5.0F}, .key = key}
			);
		}

		// A corrugated roof: its ribs as stripes, a light one and a dark one every 8 units.
		void drawRoof(const Rect& roof, Color base, Color light, Color dark, int32_t key, bool shadow) {
			Primitives::drawRect({
				.bounds = roof,
				.style =
					{.fill = base,
					 .border =
						 Foundation::BorderStyle{.color = art::kRoofEdge, .width = 2.0F, .position = Foundation::BorderPosition::Inside},
					 .boxShadow = shadow
									  ? std::optional(Foundation::BoxShadow{.color = art::kShadow, .blur = 8.0F, .offset = {12.0F, 12.0F}})
									  : std::nullopt},
				.key = key,
			});
			const float right = roof.x + roof.width;
			for (float x = roof.x + 2.0F; x < right - 2.0F; x += 8.0F) {
				fill({x, roof.y + 2.0F, std::min(3.0F, right - 2.0F - x), roof.height - 4.0F}, light, key);
				if (x + 6.0F < right - 2.0F) {
					fill({x + 6.0F, roof.y + 2.0F, std::min(2.0F, right - 2.0F - x - 6.0F), roof.height - 4.0F}, dark, key);
				}
			}
		}

		void drawBuilt(Building building, int32_t key) {
			const Rect& plot = artOf(building).plot;
			const Rect	roof = building == Building::Bunkhouse ? plot : inset(plot, 8.0F);
			const bool	rusty = building == Building::Stores;
			drawRoof(
				roof,
				rusty ? art::kRust : art::kTin,
				rusty ? art::kRustLight : art::kTinLight,
				rusty ? art::kRustDark : art::kTinDark,
				key,
				true
			);
			fill({roof.x, roof.y + roof.height * 0.5F - 1.5F, roof.width, 3.0F}, art::kRidge, key);
			const Vec2 centre{roof.x + roof.width * 0.5F, roof.y + roof.height * 0.5F};
			switch (building) {
				case Building::Bunkhouse:
					drawRoof({300.0F, 140.0F, 56.0F, 40.0F}, art::kRust, art::kRustLight, art::kRustDark, key, false);
					fill({160.0F, 210.0F, 34.0F, 34.0F}, art::kGlass, key);
					fill({400.0F, 190.0F, 18.0F, 18.0F}, art::kCrate, key);
					fill({402.0F, 214.0F, 18.0F, 18.0F}, art::kCrate, key);
					Primitives::drawCircle(
						{.center = {432.0F, 140.0F},
						 .radius = 11.0F,
						 .style = {.fill = art::kTyre, .border = Foundation::BorderStyle{.color = art::kTyreRim, .width = 5.0F}},
						 .key = key}
					);
					break;
				case Building::RadioMast:
					for (const Vec2 corner : {Vec2{-1.0F, -1.0F}, Vec2{1.0F, -1.0F}, Vec2{1.0F, 1.0F}, Vec2{-1.0F, 1.0F}}) {
						const Vec2 end{centre.x + corner.x * (roof.width * 0.5F - 6.0F), centre.y + corner.y * (roof.height * 0.5F - 6.0F)};
						Primitives::drawLine({.start = centre, .end = end, .style = {.color = art::kRoofEdge, .width = 1.5F}, .key = key});
					}
					fill({centre.x - 7.0F, centre.y - 7.0F, 14.0F, 14.0F}, art::kPost, key);
					break;
				case Building::Infirmary:
					fill({centre.x - 18.0F, centre.y - 6.0F, 36.0F, 12.0F}, colour(0xF4EEDD), key);
					fill({centre.x - 6.0F, centre.y - 18.0F, 12.0F, 36.0F}, colour(0xF4EEDD), key);
					fill({centre.x - 14.0F, centre.y - 3.0F, 28.0F, 6.0F}, colour(0xA3221B), key);
					fill({centre.x - 3.0F, centre.y - 14.0F, 6.0F, 28.0F}, colour(0xA3221B), key);
					break;
				case Building::MapRoom:
					fill({roof.x + 16.0F, roof.y + roof.height - 44.0F, 30.0F, 30.0F}, art::kGlass, key);
					break;
				case Building::Garage:
					drawRoof(
						{roof.x + roof.width - 70.0F, roof.y + 12.0F, 52.0F, 36.0F}, art::kRust, art::kRustLight, art::kRustDark, key, false
					);
					fill({roof.x + 30.0F, roof.y + roof.height - 10.0F, roof.width - 60.0F, 10.0F}, art::kPost, key);
					break;
				case Building::Stores:
					fill({centre.x - 20.0F, roof.y + roof.height - 8.0F, 40.0F, 8.0F}, art::kPost, key);
					break;
			}
		}

		// An unbuilt plot: the rust hatch, string on stakes round it, and whatever scrap lies on it.
		void drawPlot(Building building, Color hatch, int32_t key) {
			const Rect& plot = artOf(building).plot;
			Primitives::pushClip(plot);
			const float step = 11.0F * std::numbers::sqrt2_v<float>;
			for (float along = 0.0F; along < plot.width + plot.height; along += step) {
				Primitives::drawLine({
					.start = {plot.x + along, plot.y},
					.end = {plot.x + along - plot.height, plot.y + plot.height},
					.style = {.color = atlas::withAlpha(hatch, 0.55F), .width = 2.0F},
					.key = key,
				});
			}
			Primitives::popClip();
			atlas::drawDashedRect(inset(plot, -0.8F), art::kString, 1.6F, {.dash = 6.0F, .gap = 4.0F}, key);
			for (const Vec2 corner :
				 {Vec2{plot.x, plot.y},
				  Vec2{plot.x + plot.width, plot.y},
				  Vec2{plot.x + plot.width, plot.y + plot.height},
				  Vec2{plot.x, plot.y + plot.height}}) {
				fill({corner.x - 2.5F, corner.y - 2.5F, 5.0F, 5.0F}, art::kCrateEdge, key);
			}
			switch (building) {
				case Building::RadioMast: {
					static constexpr std::array<Vec2, 6> kWreck{{{520, 160}, {534, 170}, {544, 164}, {556, 176}, {538, 186}, {522, 178}}};
					Primitives::drawPolygon(
						{.vertices = kWreck,
						 .style = {.fill = art::kWreck, .border = Foundation::LineStyle{.color = art::kWreckEdge, .width = 1.5F}},
						 .key = key}
					);
					break;
				}
				case Building::Garage:
					for (const Vec2 at : {Vec2{180.0F, 560.0F}, Vec2{200.0F, 575.0F}}) {
						Primitives::drawCircle(
							{.center = at,
							 .radius = 12.0F,
							 .style = {.fill = art::kTyre, .border = Foundation::BorderStyle{.color = art::kTyreRim, .width = 5.0F}},
							 .key = key}
						);
					}
					break;
				case Building::Stores:
					framed({560.0F, 600.0F, 26.0F, 26.0F}, colour(0x6B5A40), art::kCrateEdge, 1.5F, key);
					framed({590.0F, 612.0F, 22.0F, 22.0F}, colour(0x6B5A40), art::kCrateEdge, 1.5F, key);
					break;
				default:
					break;
			}
		}

		void drawYardThings(Color highway, Color teal, int32_t key) {
			Primitives::drawCircle({.center = {372.0F, 440.0F}, .radius = 40.0F, .style = {.fill = colour(0x000000, 0.22F)}, .key = key});
			Primitives::drawCircle(
				{.center = {364.0F, 432.0F},
				 .radius = 40.0F,
				 .style = {.fill = art::kTank, .border = Foundation::BorderStyle{.color = art::kTankRim, .width = 5.0F}},
				 .key = key}
			);
			Primitives::drawCircle({.center = {364.0F, 432.0F}, .radius = 10.0F, .style = {.fill = art::kTankRim}, .key = key});

			const auto parked = [key](Vec2 at, float degrees, auto&& draw) {
				glm::mat4 place = glm::translate(glm::mat4(1.0F), glm::vec3(at.x, at.y, 0.0F));
				place = glm::rotate(place, degrees * kPi / 180.0F, glm::vec3(0.0F, 0.0F, 1.0F));
				Primitives::PushTransform(place);
				draw(key);
				Primitives::PopTransform();
			};
			parked({618.0F, 452.0F}, -8.0F, [highway](int32_t at) {
				fill({4.0F, 6.0F, 70.0F, 34.0F}, colour(0x000000, 0.25F), at);
				framed({0.0F, 0.0F, 70.0F, 34.0F}, art::kRigBody, art::kRigEdge, 2.0F, at, 4.0F);
				fill({46.0F, 4.0F, 20.0F, 26.0F}, art::kRigCab, at);
				fill({8.0F, 6.0F, 32.0F, 22.0F}, art::kRigBed, at);
				Primitives::drawLine({.start = {70.0F, 4.0F}, .end = {76.0F, 4.0F}, .style = {.color = highway, .width = 3.0F}, .key = at});
				Primitives::drawLine(
					{.start = {70.0F, 30.0F}, .end = {76.0F, 30.0F}, .style = {.color = highway, .width = 3.0F}, .key = at}
				);
			});
			parked({626.0F, 500.0F}, -4.0F, [teal](int32_t at) {
				fill({2.0F, 4.0F, 38.0F, 12.0F}, colour(0x000000, 0.22F), at);
				framed({0.0F, 2.0F, 38.0F, 10.0F}, art::kBikeBody, art::kBikeEdge, 2.0F, at, 5.0F);
				Primitives::drawLine({.start = {38.0F, 2.0F}, .end = {44.0F, 0.0F}, .style = {.color = teal, .width = 2.0F}, .key = at});
				Primitives::drawLine({.start = {38.0F, 12.0F}, .end = {44.0F, 14.0F}, .style = {.color = teal, .width = 2.0F}, .key = at});
			});
		}

		// The grease pencil's loop round a plot: an ellipse a little past it, wobbling by the seed, its end running on past
		// its start as a hand's does.
		void drawLoop(const Rect& plot, uint32_t seed, Color grease, int32_t key) {
			const auto unit = [&seed] {
				seed = seed * 1664525U + 1013904223U;
				return static_cast<float>(seed) / 4294967296.0F;
			};
			const Vec2		  centre{plot.x + plot.width * 0.5F, plot.y + plot.height * 0.5F};
			const float		  across = plot.width * 0.5F + 24.0F;
			const float		  down = plot.height * 0.5F + 22.0F;
			const float		  start = kPi * (0.9F + unit() * 0.3F);
			const float		  phaseA = unit() * 2.0F * kPi;
			const float		  phaseB = unit() * 2.0F * kPi;
			const float		  sweep = 2.0F * kPi + 0.55F;
			std::vector<Vec2> points;
			constexpr int	  kSteps = 72;
			for (int step = 0; step <= kSteps; ++step) {
				const float travelled = sweep * static_cast<float>(step) / static_cast<float>(kSteps);
				const float angle = start + travelled;
				const float wobble = 1.0F + 0.035F * std::sin(3.0F * angle + phaseA) + 0.02F * std::sin(5.0F * angle + phaseB);
				const float drift = 1.0F - 0.06F * travelled / sweep;
				points.push_back(
					{centre.x + std::cos(angle) * across * wobble * drift, centre.y + std::sin(angle) * down * wobble * drift}
				);
			}
			Primitives::drawPolyline(
				{.points = points,
				 .width = 5.0F,
				 .color = grease,
				 .cap = Primitives::LineCap::Round,
				 .join = Primitives::LineJoin::Round,
				 .id = "loop",
				 .key = key}
			);
		}

		// One building on the plate as a hit target over its plot: a press chooses it. Hover outlines it in ink and focus
		// visible rings it; the choice itself is the loop and the building's box, so the mark is never the only signal.
		class BuildingSpot : public ui::Control {
		  public:
			struct Args {
				UI_COMMON_ARGS
				Building					  building = Building::Bunkhouse;
				std::function<void(Building)> onChoose;
			};

			explicit BuildingSpot(const Args& args)
				: building(args.building),
				  onChoose(args.onChoose) {}

			[[nodiscard]] const char* typeName() const override { return "BuildingSpot"; }
			[[nodiscard]] float		  inkExtent() const override { return 5.0F; }
			void					  describe(nlohmann::json& node) const override {
				 ui::Control::describe(node);
				 node["building"] = std::string(artOf(building).id);
			}

		  protected:
			void render() override {
				const Color ink = getContext()->getTheme().get(palette::ink);
				if (isHovered() && isEnabledInTree()) {
					Primitives::drawRect({
						.bounds = {0.0F, 0.0F, size.x, size.y},
						.style =
							{.fill = Color(0.0F, 0.0F, 0.0F, 0.0F),
							 .border =
								 Foundation::BorderStyle{.color = ink, .width = 1.6F, .position = Foundation::BorderPosition::Inside}},
						.key = drawKey(),
					});
				}
				if (isFocusVisible()) {
					Primitives::drawRect({
						.bounds = {-5.0F, -5.0F, size.x + 10.0F, size.y + 10.0F},
						.style =
							{.fill = Color(0.0F, 0.0F, 0.0F, 0.0F),
							 .border =
								 Foundation::BorderStyle{.color = ink, .width = 2.0F, .position = Foundation::BorderPosition::Inside}},
						.key = drawKey(),
					});
				}
			}

			void activate() override {
				if (onChoose) {
					onChoose(building);
				}
			}

		  private:
			Building					  building;
			std::function<void(Building)> onChoose;
		};

	} // namespace

	std::string_view buildingName(Building building) {
		return artOf(building).name;
	}

	std::string_view buildingDescription(Building building) {
		return artOf(building).description;
	}

	int buildingNumber(Building building) {
		return static_cast<int>(building) + 1;
	}

	std::string plotId(Building building) {
		return "plot_" + std::string(artOf(building).id);
	}

	CompoundPlate::CompoundPlate(const Args& args)
		: built(args.built),
		  selected(args.selected),
		  seed(args.seed),
		  onChoose(args.onChoose) {}

	CompoundPlate::Fit CompoundPlate::fitIn(Foundation::Vec2 box) {
		const float scale = std::max(0.0F, std::min(box.x / kPlate.x, box.y / kPlate.y));
		return {.scale = scale, .origin = (box - kPlate * scale) * 0.5F};
	}

	void CompoundPlate::describe(nlohmann::json& node) const {
		nlohmann::json shown = nlohmann::json::array();
		for (const Building building : built) {
			shown.push_back(std::string(artOf(building).id));
		}
		node["built"] = shown;
		node["selected"] = std::string(artOf(selected).id);
	}

	void CompoundPlate::onMount() {
		setFocusGroup(ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Both, .wrap = true});
		for (const Building building : kBuildings) {
			spots.push_back(addChild<BuildingSpot>({.id = plotId(building), .building = building, .onChoose = onChoose}));
		}
		setOnLayout([this](ui::Component& /*plate*/) { place(); });
	}

	void CompoundPlate::place() {
		const Fit fit = fitIn(size);
		for (size_t index = 0; index < spots.size(); ++index) {
			if (ui::Control* spot = spots[index].get()) {
				const Rect& plot = kArt.at(index).plot;
				spot->setPosition(fit.origin + Vec2{plot.x, plot.y} * fit.scale);
				spot->setSize(Vec2{plot.width, plot.height} * fit.scale);
			}
		}
	}

	void CompoundPlate::render() {
		const ui::Theme& theme = getContext()->getTheme();
		const int32_t	 key = drawKey();
		const Color		 ink = theme.get(palette::ink);
		const Color		 paper = theme.get(palette::paper);
		const Fit		 fit = fitIn(size);
		const Rect		 box{0.0F, 0.0F, size.x, size.y};

		Primitives::pushClip(box);
		fill(box, art::kDirt, key);
		glm::mat4 plate = glm::translate(glm::mat4(1.0F), glm::vec3(fit.origin.x, fit.origin.y, 0.0F));
		plate = glm::scale(plate, glm::vec3(fit.scale, fit.scale, 1.0F));
		Primitives::PushTransform(plate);
		drawDirt(key);
		drawRoad((size.x - fit.origin.x) / std::max(fit.scale, 1e-3F), theme.get(palette::casing), theme.get(palette::highway), key);
		drawFence(key);
		for (const Building building : kBuildings) {
			if (std::ranges::find(built, building) != built.end()) {
				drawBuilt(building, key);
			} else {
				drawPlot(building, theme.get(palette::rustHatch), key);
			}
		}
		drawYardThings(theme.get(palette::highway), theme.get(palette::routeTeal), key);
		drawLoop(
			artOf(selected).plot, seed ^ static_cast<uint32_t>(buildingNumber(selected)) * 0x9e3779b1U, theme.get(palette::grease), key
		);
		fill({30.0F, 744.0F, 36.0F, 7.0F}, ink, key);
		framed({66.0F, 744.0F, 36.0F, 7.0F}, paper, ink, 1.0F, key);
		fill({102.0F, 744.0F, 36.0F, 7.0F}, ink, key);
		static constexpr std::array<Vec2, 4> kNorth{{{880.0F, 26.0F}, {888.0F, 56.0F}, {880.0F, 50.0F}, {872.0F, 56.0F}}};
		Primitives::drawPolygon(
			{.vertices = kNorth, .style = {.fill = ink, .border = Foundation::LineStyle{.color = paper, .width = 1.4F}}, .key = key}
		);
		Primitives::PopTransform();

		// The labels print at the plate's scale down to three quarters, then stay put, so they read at 1280 by 800.
		const float labelScale = std::clamp(fit.scale, 0.75F, 1.0F);
		const auto	at = [&fit](float x, float y) {
			 return fit.origin + Vec2{x, y} * fit.scale;
		};
		for (const Building building : kBuildings) {
			const BuildingArt& shown = artOf(building);
			const bool		   standing = std::ranges::find(built, building) != built.end();
			const Vec2		   circle = at(shown.plot.x + 20.0F, shown.plot.y + 20.0F);
			const float		   radius = 16.0F * labelScale;
			atlas::drawCircled(circle, radius, std::to_string(buildingNumber(building)), ink, key);
			const float nameSize = (standing ? 28.0F : 22.0F) * labelScale;
			const Vec2	name{circle.x + radius + 6.0F * labelScale, circle.y - nameSize * 0.62F};
			atlas::print(
				{.text = std::string(shown.name), .position = name, .face = fonts::kDisplayBold, .size = nameSize, .color = ink, .key = key}
			);
			const std::string state = standing ? "BUILT" : "not built";
			const float		  stateSize = std::max(11.0F, 13.0F * labelScale);
			const Vec2		  statePosition{name.x, name.y + nameSize * 1.28F};
			const float		  stateWidth = atlas::printedWidth(state, fonts::kMono, stateSize);
			fill(
				{statePosition.x - 3.0F, statePosition.y - 1.0F, stateWidth + 6.0F, stateSize * 1.3F}, atlas::withAlpha(paper, 0.92F), key
			);
			atlas::print({.text = state, .position = statePosition, .face = fonts::kMono, .size = stateSize, .color = ink, .key = key});
		}
		const Vec2 gate = at(752.0F, 352.0F);
		atlas::print(
			{.text = "Gate",
			 .position = {gate.x, gate.y - 20.0F * labelScale},
			 .face = fonts::kDisplayBold,
			 .size = 20.0F * labelScale,
			 .color = ink,
			 .key = key}
		);
		const Vec2		  road = at(752.0F, 428.0F);
		const float		  roadSize = std::max(11.0F, 13.0F * labelScale);
		const std::string roadLabel = "to the area map";
		fill(
			{road.x - 3.0F, road.y - 1.0F, atlas::printedWidth(roadLabel, fonts::kMono, roadSize) + 6.0F, roadSize * 1.3F},
			atlas::withAlpha(paper, 0.92F),
			key
		);
		atlas::print({.text = roadLabel, .position = road, .face = fonts::kMono, .size = roadSize, .color = ink, .key = key});
		Primitives::popClip();

		// The plate's frame: a 1.6 px rule on its edge and a 0.6 px rule 4 px outside it.
		Primitives::drawRect({
			.bounds = box,
			.style =
				{.fill = Color(0.0F, 0.0F, 0.0F, 0.0F),
				 .border = Foundation::BorderStyle{.color = ink, .width = 1.6F, .position = Foundation::BorderPosition::Inside}},
			.key = key,
		});
		Primitives::drawRect({
			.bounds = {-4.6F, -4.6F, size.x + 9.2F, size.y + 9.2F},
			.style =
				{.fill = Color(0.0F, 0.0F, 0.0F, 0.0F),
				 .border = Foundation::BorderStyle{.color = ink, .width = 0.6F, .position = Foundation::BorderPosition::Inside}},
			.key = key,
		});
	}

} // namespace game
