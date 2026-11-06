#include "scenes/map/LandBake.h"

#include "scenes/map/MapStyle.h"

#include <rules/map/LandGrid.h>
#include <rules/map/StreetGrids.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <numbers>
#include <span>
#include <unordered_map>

namespace game {

	namespace {

		namespace style = mapstyle;
		using rules::map::Point;

		constexpr double kTexelWorldUnits = 2.5;
		constexpr int	 kMinBakeSize = 256;
		constexpr int	 kMaxBakeSize = 1024;
		constexpr double kColourWorldUnits = 16;
		constexpr int	 kCliffStep = 2;

		struct Ink {
			double red{0};
			double green{0};
			double blue{0};

			void mix(const style::Rgb8& colour, double amount) {
				red += (colour[0] - red) * amount;
				green += (colour[1] - green) * amount;
				blue += (colour[2] - blue) * amount;
			}
		};

		double clamp01(double value) {
			return value <= 0.0 ? 0.0 : (value >= 1.0 ? 1.0 : value);
		}

		double smooth(double value) {
			const double clamped = clamp01(value);
			return clamped * clamped * (3.0 - 2.0 * clamped);
		}

		double bilinear(double topLeft, double topRight, double bottomLeft, double bottomRight, double fx, double fy) {
			const double top = topLeft + (topRight - topLeft) * fx;
			const double bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
			return top + (bottom - top) * fy;
		}

		double catmullRom(double before, double from, double to, double after, double t) {
			return from +
				   0.5 * t * (to - before + t * (2.0 * before - 5.0 * from + 4.0 * to - after + t * (3.0 * (from - to) + after - before)));
		}

		// Whether `along` world units round a circle falls on a dash of `dash` units, the gaps as long.
		bool dashOn(double along, double dash) {
			double phase = std::fmod(along / dash, 2.0);
			if (phase < 0.0) {
				phase += 2.0;
			}
			return phase < 1.0;
		}

		// How much of a texel at `along` lies on a line `width` wide every `spacing`, anti-aliased over the texel.
		double gridLine(double along, double spacing, double width, double texel) {
			double into = std::fmod(along, spacing);
			if (into < 0.0) {
				into += spacing;
			}
			const double distance = into < spacing / 2.0 ? into : spacing - into;
			return clamp01((width / 2.0 - distance) / texel + 0.5);
		}

		// Nodes along each side of a lattice every `step` texels: one past the last texel, so each texel has four round it.
		int latticeNodes(int size, int step) {
			return (size - 1 + step - 1) / step + 2;
		}

		style::Rgb8 landColour(double elevation, double moisture, double contamination) {
			const double	   wetness = clamp01(moisture);
			const style::Rgb8& from = wetness < 0.5 ? style::kLandDry : style::kLandMiddling;
			const style::Rgb8& to = wetness < 0.5 ? style::kLandMiddling : style::kLandWet;
			const double	   along = wetness < 0.5 ? wetness * 2.0 : wetness * 2.0 - 1.0;
			const double	   height = clamp01((elevation - style::kHighFrom) / (style::kHighTo - style::kHighFrom));
			const double	   tint = clamp01(contamination) * style::kToxicWeight;
			style::Rgb8		   out{};
			for (size_t channel = 0; channel < 3; ++channel) {
				double value = from[channel] + (to[channel] - from[channel]) * along;
				value += (style::kLandHigh[channel] - value) * height;
				out[channel] = static_cast<float>(value + (style::kLandToxic[channel] - value) * tint);
			}
			return out;
		}

		// A 32-bit hash of a world position rounded to the unit, so a place's edge and turn are the same every bake.
		uint32_t positionHash(double x, double y) {
			uint32_t hash = static_cast<uint32_t>(static_cast<int32_t>(std::lround(x))) * 0x27d4eb2dU ^
							static_cast<uint32_t>(static_cast<int32_t>(std::lround(y))) * 0x165667b1U;
			hash = (hash ^ (hash >> 15U)) * 0x85ebca6bU;
			hash = (hash ^ (hash >> 13U)) * 0xc2b2ae35U;
			return hash ^ (hash >> 16U);
		}

		// Each node of a square lattice set to `pick` of itself and its eight neighbours, held at the edges.
		template <typename Pick>
		std::vector<float> spread(const std::vector<float>& values, int nodes, Pick pick) {
			std::vector<float> across(values.size());
			std::vector<float> out(values.size());
			for (int row = 0; row < nodes; ++row) {
				for (int column = 0; column < nodes; ++column) {
					const size_t at = static_cast<size_t>(row * nodes + column);
					across[at] = pick(values[at], pick(values[column > 0 ? at - 1 : at], values[column < nodes - 1 ? at + 1 : at]));
				}
			}
			const auto stride = static_cast<size_t>(nodes);
			for (int row = 0; row < nodes; ++row) {
				for (int column = 0; column < nodes; ++column) {
					const size_t at = static_cast<size_t>(row * nodes + column);
					out[at] = pick(across[at], pick(across[row > 0 ? at - stride : at], across[row < nodes - 1 ? at + stride : at]));
				}
			}
			return out;
		}

		// A ruin's built-up land and the dressing's blocks on it.
		struct Patch {
			double x{0};
			double y{0};
			double radius{0};
			// The farthest its ragged edge reaches, plus a texel.
			double reach{0};
			double phase3{0};
			double phase5{0};
			// Its districts, indices into the dressing's.
			std::vector<size_t> districts;
		};

		// A district's blocks by their place on its grid: 1 standing, 2 rubble.
		struct BlockGrid {
			Point								 corner;
			double								 ux{1};
			double								 uy{0};
			double								 spacing{1};
			std::unordered_map<int64_t, uint8_t> blocks;
		};

		int64_t blockKey(int64_t column, int64_t row) {
			return (column << 32U) ^ (row & 0xffffffffLL);
		}

		class LandBaker {
		  public:
			explicit LandBaker(const LandBakeArgs& args)
				: ground(args.ground),
				  terrain(args.ground.terrain()),
				  size(args.size),
				  radius(static_cast<double>(args.ground.terrain().radius())),
				  texel(radius * 2.0 / args.size),
				  step(std::max(1, static_cast<int>(std::lround(kColourWorldUnits / texel)))),
				  nodes(latticeNodes(args.size, step)),
				  lakeGrid(args.ground.terrain().surface().grid),
				  lakeDepth(args.ground.water().lakeDepth()) {
				texels.size = size;
				texels.rgba.assign(static_cast<size_t>(size) * static_cast<size_t>(size) * 4U, 0);
				outerSquared = (radius + texel) * (radius + texel);
				innerSquared = radius > texel ? (radius - texel) * (radius - texel) : 0.0;
				const double rimInner =
					std::max(0.0, std::min(radius * (1.0 - style::kRimFade), radius - texel * (style::kRimLineInset + 1.0)));
				rimSquared = rimInner * rimInner;
				colourLattice();
				shadeLattice();
				cliffLattice();
				patches(args);
			}

			Texels bake(const LandBakeArgs& args) {
				for (int row = 0; row < size; ++row) {
					if (args.stop.stop_requested()) {
						return {};
					}
					bakeRow(row, args.dressing);
				}
				if (args.dressing != nullptr) {
					stipple(args.dressing->stipple);
				}
				return std::move(texels);
			}

		  private:
			// Per colour node: the land's red, green, blue, its relief, and its contamination.
			static constexpr size_t kChannels = 5;

			double worldX(double column) const { return -radius + (column + 0.5) * texel; }
			double worldY(double row) const { return radius - (row + 0.5) * texel; }

			void colourLattice() {
				colours.assign(static_cast<size_t>(nodes) * static_cast<size_t>(nodes) * kChannels, 0.0F);
				const double reach = radius + texel * (step * 1.5 + 1.0);
				for (int row = 0; row < nodes; ++row) {
					const double y = worldY(row * step);
					for (int column = 0; column < nodes; ++column) {
						const double x = worldX(column * step);
						if (x * x + y * y > reach * reach) {
							continue;
						}
						const rules::map::GroundSample sample = ground.sample(x, y);
						const style::Rgb8 colour = landColour(sample.elevation, sample.fields.moisture, sample.fields.contamination);
						const size_t	  at = static_cast<size_t>(row * nodes + column) * kChannels;
						colours[at] = colour[0];
						colours[at + 1] = colour[1];
						colours[at + 2] = colour[2];
						const style::HillShade& shade = style::kHillShade;
						colours[at + 3] = static_cast<float>(
							shade.low + (shade.high - shade.low) * smooth((sample.elevation - shade.from) / (shade.to - shade.from))
						);
						colours[at + 4] = static_cast<float>(sample.fields.contamination);
					}
				}
			}

			void shadeLattice() {
				shadeStep = std::max(1, static_cast<int>(std::ceil(lakeGrid.cellSize / 2.0 / texel)));
				shadeNodes = latticeNodes(size, shadeStep);
				shades.assign(static_cast<size_t>(shadeNodes) * static_cast<size_t>(shadeNodes), 0.0F);
				shadeRow.assign(static_cast<size_t>(shadeNodes), 0.0F);
				const double reach = radius + texel * (shadeStep * 2.5 + 1.0);
				for (int row = 0; row < shadeNodes; ++row) {
					const double y = worldY(row * shadeStep);
					for (int column = 0; column < shadeNodes; ++column) {
						const double x = worldX(column * shadeStep);
						if (x * x + y * y > reach * reach) {
							continue;
						}
						const rules::map::LandSample land = terrain.sample(x, y);
						// Light from the north-west, y north: ground rising to the east and the south faces it.
						const double lit = std::tanh((land.slopeX - land.slopeY) * style::kHillShade.gain);
						shades[static_cast<size_t>(row * shadeNodes + column)] =
							static_cast<float>(lit > 0.0 ? lit * style::kHillShade.light : lit);
					}
				}
			}

			void cliffLattice() {
				cliffNodes = latticeNodes(size, kCliffStep);
				std::vector<float> depths(static_cast<size_t>(cliffNodes) * static_cast<size_t>(cliffNodes), -1.0F);
				const double	   reach = radius + texel * (kCliffStep * 2.5 + 1.0);
				for (int row = 0; row < cliffNodes; ++row) {
					const double y = worldY(row * kCliffStep);
					for (int column = 0; column < cliffNodes; ++column) {
						const double x = worldX(column * kCliffStep);
						if (x * x + y * y > reach * reach) {
							continue;
						}
						depths[static_cast<size_t>(row * cliffNodes + column)] =
							static_cast<float>(std::max(-1.0, terrain.fields().cliffDepth(x, y)));
					}
				}
				const auto most = [](float a, float b) {
					return std::max(a, b);
				};
				const auto least = [](float a, float b) {
					return std::min(a, b);
				};
				cliffs = spread(spread(depths, cliffNodes, most), cliffNodes, least);
			}

			void patches(const LandBakeArgs& args) {
				for (const rules::map::Ruin& ruin : rules::map::ruinsOf(args.places)) {
					const uint32_t hash = positionHash(ruin.at.x, ruin.at.y);
					Patch		   patch{
								 .x = ruin.at.x,
								 .y = ruin.at.y,
								 .radius = ruin.radius,
								 .reach = ruin.radius * (1.0 + style::kRagged) + texel,
								 .phase3 = static_cast<double>((hash >> 16U) & 0xffU) / 40.0,
								 .phase5 = static_cast<double>((hash >> 24U) & 0xffU) / 40.0,
					 };
					if (args.dressing != nullptr) {
						for (size_t index = 0; index < args.dressing->districts.size(); ++index) {
							if (args.dressing->districts[index].place == ruin.place) {
								patch.districts.push_back(index);
							}
						}
					}
					patchList.push_back(std::move(patch));
				}
				if (args.dressing == nullptr) {
					return;
				}
				for (const rules::map::StreetDistrict& district : args.dressing->districts) {
					BlockGrid grid{
						.corner = district.corner, .ux = district.ux, .uy = district.uy, .spacing = district.spacing, .blocks = {}
					};
					const auto place = [&](const std::vector<Point>& points, uint8_t state) {
						for (const Point& block : points) {
							const double dx = block.x - grid.corner.x;
							const double dy = block.y - grid.corner.y;
							const auto	 column = static_cast<int64_t>(std::floor((dx * grid.ux + dy * grid.uy) / grid.spacing));
							const auto	 row = static_cast<int64_t>(std::floor((dy * grid.ux - dx * grid.uy) / grid.spacing));
							grid.blocks[blockKey(column, row)] = state;
						}
					};
					place(district.blocks, 1);
					place(district.rubble, 2);
					blockGrids.push_back(std::move(grid));
				}
			}

			void bakeRow(int row, const rules::map::Dressing* dressing) {
				const double y = worldY(row);
				const int	 latticeRow = std::min(nodes - 2, row / step);
				const double fy = static_cast<double>(row) / step - latticeRow;
				lightsAt(row);
				rowPatches.clear();
				for (const Patch& patch : patchList) {
					if (std::abs(y - patch.y) < patch.reach) {
						rowPatches.push_back(&patch);
					}
				}
				rowHotspots.clear();
				for (const rules::map::Hotspot& hotspot : ground.hotspots()) {
					if (std::abs(y - hotspot.y) < hotspot.plumeRadius + texel) {
						rowHotspots.push_back(&hotspot);
					}
				}
				rowHatches.clear();
				if (dressing != nullptr) {
					for (const rules::map::HatchRegion& region : dressing->hatches) {
						if (std::abs(y - region.at.y) < region.outer + texel) {
							rowHatches.push_back(&region);
						}
					}
				}
				const double halfChord = std::sqrt(std::max(0.0, outerSquared - y * y));
				const int	 first = std::max(0, static_cast<int>(std::floor((radius - halfChord) / texel - 0.5)));
				const int	 last = std::min(size - 1, static_cast<int>(std::ceil((radius + halfChord) / texel - 0.5)));
				const auto	 stride = static_cast<size_t>(nodes) * kChannels;
				for (int column = first; column <= last; ++column) {
					const double x = worldX(column);
					const double distanceSquared = x * x + y * y;
					if (distanceSquared >= outerSquared) {
						continue;
					}
					const double coverage =
						distanceSquared <= innerSquared ? 1.0 : clamp01((radius - std::sqrt(distanceSquared)) / texel + 0.5);
					if (coverage <= 0.0) {
						continue;
					}
					const int	 latticeColumn = std::min(nodes - 2, column / step);
					const double fx = static_cast<double>(column) / step - latticeColumn;
					const size_t at =
						(static_cast<size_t>(latticeRow) * static_cast<size_t>(nodes) + static_cast<size_t>(latticeColumn)) * kChannels;
					const size_t below = at + stride;
					const auto	 node = [&](size_t channel) {
						  return bilinear(
							  colours[at + channel],
							  colours[at + kChannels + channel],
							  colours[below + channel],
							  colours[below + kChannels + channel],
							  fx,
							  fy
						  );
					};
					const double shade = 1.0 + node(3) * cubicRow(static_cast<double>(column) / shadeStep);
					Ink			 ink{.red = node(0) * shade, .green = node(1) * shade, .blue = node(2) * shade};

					const double contamination = node(4);
					if (contamination > style::kToxicHatch.from) {
						hatch(ink, x, y, contamination);
					}
					if (!rowHatches.empty()) {
						plumeHatches(ink, x, y);
					}
					if (!rowPatches.empty()) {
						builtUp(ink, x, y);
					}
					if (lakeAt(x, y) > 0.0) {
						const bool shore = lakeAt(x - texel, y) <= 0.0 || lakeAt(x + texel, y) <= 0.0 || lakeAt(x, y - texel) <= 0.0 ||
										   lakeAt(x, y + texel) <= 0.0;
						const style::Rgb8& colour = shore ? style::kShore : style::kLake;
						ink = {.red = colour[0], .green = colour[1], .blue = colour[2]};
					} else if (const double cliff = cliffAt(column, row); cliff > 0.0) {
						ink.mix(style::kCliff, std::min(cliff, 1.0) * style::kCliffWeight);
					}
					if (!rowHotspots.empty()) {
						hotspots(ink, x, y);
					}
					if (distanceSquared > rimSquared) {
						rim(ink, x, y, std::sqrt(distanceSquared));
					}
					const size_t out = (static_cast<size_t>(row) * static_cast<size_t>(size) + static_cast<size_t>(column)) * 4U;
					texels.rgba[out] = static_cast<uint8_t>(std::min(255.0, ink.red) * coverage + 0.5);
					texels.rgba[out + 1] = static_cast<uint8_t>(std::min(255.0, ink.green) * coverage + 0.5);
					texels.rgba[out + 2] = static_cast<uint8_t>(std::min(255.0, ink.blue) * coverage + 0.5);
					texels.rgba[out + 3] = static_cast<uint8_t>(255.0 * coverage + 0.5);
				}
			}

			// Texel row `row`'s shade at each shade lattice column, read down the columns bicubic.
			void lightsAt(int row) {
				const double along = static_cast<double>(row) / shadeStep;
				const int	 node = std::min(shadeNodes - 2, static_cast<int>(along));
				const double fraction = along - node;
				const auto	 index = [&](int at, int column) {
					  return static_cast<size_t>(at * shadeNodes + column);
				};
				const int above = std::max(0, node - 1);
				const int further = std::min(shadeNodes - 1, node + 2);
				for (int column = 0; column < shadeNodes; ++column) {
					shadeRow[static_cast<size_t>(column)] = static_cast<float>(catmullRom(
						shades[index(above, column)],
						shades[index(node, column)],
						shades[index(node + 1, column)],
						shades[index(further, column)],
						fraction
					));
				}
			}

			double cubicRow(double along) const {
				const int  last = shadeNodes - 1;
				const int  node = std::min(last - 1, static_cast<int>(along));
				const auto value = [&](int at) {
					return static_cast<double>(shadeRow[static_cast<size_t>(std::clamp(at, 0, last))]);
				};
				return catmullRom(value(node - 1), value(node), value(node + 1), value(node + 2), along - node);
			}

			double cliffAt(int column, int row) const {
				const int	 latticeRow = std::min(cliffNodes - 2, row / kCliffStep);
				const int	 latticeColumn = std::min(cliffNodes - 2, column / kCliffStep);
				const size_t node = static_cast<size_t>(latticeRow * cliffNodes + latticeColumn);
				const auto	 stride = static_cast<size_t>(cliffNodes);
				const double topLeft = cliffs[node];
				const double topRight = cliffs[node + 1];
				const double bottomLeft = cliffs[node + stride];
				const double bottomRight = cliffs[node + stride + 1];
				if (topLeft < 0.0 && topRight < 0.0 && bottomLeft < 0.0 && bottomRight < 0.0) {
					return 0.0;
				}
				const double depth = bilinear(
					topLeft,
					topRight,
					bottomLeft,
					bottomRight,
					static_cast<double>(column) / kCliffStep - latticeColumn,
					static_cast<double>(row) / kCliffStep - latticeRow
				);
				// The change in depth across a texel, so the edge ramps over one.
				const double acrossX = (topRight - topLeft + bottomRight - bottomLeft) * 0.5 / kCliffStep;
				const double acrossY = (bottomLeft - topLeft + bottomRight - topRight) * 0.5 / kCliffStep;
				const double change = std::sqrt(acrossX * acrossX + acrossY * acrossY);
				if (!(change > 0.0)) {
					return depth >= 0.0 ? 1.0 : 0.0;
				}
				return clamp01(depth / change + 0.5);
			}

			// A lake's level less the land, read bilinear between cell centres: above 0 on its water.
			double lakeAt(double x, double y) const {
				const double column = (x + lakeGrid.halfExtent) / lakeGrid.cellSize - 0.5;
				const double row = (y + lakeGrid.halfExtent) / lakeGrid.cellSize - 0.5;
				const int	 left = std::clamp(static_cast<int>(std::floor(column)), 0, lakeGrid.size - 2);
				const int	 bottom = std::clamp(static_cast<int>(std::floor(row)), 0, lakeGrid.size - 2);
				const double fx = std::clamp(column - left, 0.0, 1.0);
				const double fy = std::clamp(row - bottom, 0.0, 1.0);
				const auto	 cell = [&](int c, int r) {
					  return lakeDepth[static_cast<size_t>(r * lakeGrid.size + c)];
				};
				return bilinear(cell(left, bottom), cell(left + 1, bottom), cell(left, bottom + 1), cell(left + 1, bottom + 1), fx, fy);
			}

			void hatch(Ink& ink, double x, double y, double contamination) const {
				const style::Hatch& hatching = style::kToxicHatch;
				const double		strength = smooth((contamination - hatching.from) / (hatching.to - hatching.from)) * hatching.weight;
				const double		line = gridLine((x + y) * std::numbers::sqrt2 / 2.0, hatching.spacing, hatching.width, texel);
				if (line > 0.0) {
					ink.mix(hatching.colour, line * strength);
				}
			}

			// The dressing's plumes: lines along each region's direction, strongest at the crater's rim, gone at its edge.
			void plumeHatches(Ink& ink, double x, double y) const {
				for (const rules::map::HatchRegion* region : rowHatches) {
					const double dx = x - region->at.x;
					const double dy = y - region->at.y;
					const double squared = dx * dx + dy * dy;
					if (squared >= region->outer * region->outer || squared <= region->inner * region->inner) {
						continue;
					}
					const double distance = std::sqrt(squared);
					const double strength = 1.0 - smooth((distance - region->inner) / (region->outer - region->inner));
					const double line = gridLine(dy * region->ux - dx * region->uy, region->spacing, style::kPlumeHatchWidth, texel);
					if (line > 0.0) {
						ink.mix(style::kPlumeHatch, line * strength * style::kPlumeHatchWeight);
					}
				}
			}

			void builtUp(Ink& ink, double x, double y) const {
				for (const Patch* patch : rowPatches) {
					const double dx = x - patch->x;
					const double dy = y - patch->y;
					const double squared = dx * dx + dy * dy;
					if (squared >= patch->reach * patch->reach) {
						continue;
					}
					const double distance = std::sqrt(squared);
					const double angle = std::atan2(dy, dx);
					const double wave = 0.6 * std::sin(3.0 * angle + patch->phase3) + 0.4 * std::sin(5.0 * angle + patch->phase5);
					const double edge = patch->radius * (1.0 + style::kRagged * wave);
					const double inside = (edge - distance) / texel + 0.5;
					const double cover = clamp01(inside);
					if (cover > 0.0) {
						ink.mix(style::kBuiltUp, cover);
					}
					for (const size_t district : patch->districts) {
						if (blocks(ink, blockGrids[district], x, y)) {
							break;
						}
					}
					return;
				}
			}

			// The district's block under (x, y), inset so the streets show between blocks; whether one was there.
			bool blocks(Ink& ink, const BlockGrid& grid, double x, double y) const {
				const double dx = x - grid.corner.x;
				const double dy = y - grid.corner.y;
				const double u = (dx * grid.ux + dy * grid.uy) / grid.spacing;
				const double v = (dy * grid.ux - dx * grid.uy) / grid.spacing;
				const double column = std::floor(u);
				const double row = std::floor(v);
				const auto	 found = grid.blocks.find(blockKey(static_cast<int64_t>(column), static_cast<int64_t>(row)));
				if (found == grid.blocks.end()) {
					return false;
				}
				// How far inside the block's inset square, in texels, the nearer edge first.
				const double inset = style::kStreetShare;
				const double toEdge = std::min({u - column - inset, column + 1.0 - inset - u, v - row - inset, row + 1.0 - inset - v});
				const double cover = clamp01(toEdge * grid.spacing / texel + 0.5);
				if (cover > 0.0) {
					ink.mix(style::kBlock, cover * (found->second == 1 ? 1.0 : style::kRubbleWeight));
				}
				return true;
			}

			void hotspots(Ink& ink, double x, double y) const {
				for (const rules::map::Hotspot* hotspot : rowHotspots) {
					const double dx = x - hotspot->x;
					const double dy = y - hotspot->y;
					const double squared = dx * dx + dy * dy;
					const double plumeOuter = hotspot->plumeRadius + texel;
					if (squared >= plumeOuter * plumeOuter) {
						continue;
					}
					const double crater = hotspot->craterRadius;
					const double plumeInner = hotspot->plumeRadius - texel;
					if (squared > plumeInner * plumeInner) {
						const double distance = std::sqrt(squared);
						const double onRing = 1.0 - std::abs(distance - hotspot->plumeRadius) / (texel * style::kPlumeRingHalfWidth);
						if (onRing > 0.0 && dashOn(std::atan2(dy, dx) * hotspot->plumeRadius, style::kPlumeRingDash)) {
							ink.mix(style::kPlumeRing, onRing * style::kPlumeRingWeight);
						}
						continue;
					}
					const double craterOuter = crater + texel;
					if (squared >= craterOuter * craterOuter) {
						continue;
					}
					const double distance = std::sqrt(squared);
					const double inside = std::min(1.0, (crater - distance) / texel + 0.5);
					if (inside <= 0.0) {
						continue;
					}
					const double	   share = distance / crater;
					const style::Rgb8& colour = share > 1.0 - style::kCraterRimShare ? style::kCraterRim
												: share < style::kCraterCoreShare	 ? style::kCraterCore
																					 : style::kCraterFloor;
					ink.mix(colour, inside);
				}
			}

			void rim(Ink& ink, double x, double y, double distance) const {
				const double into = (distance - radius * (1.0 - style::kRimFade)) / (radius * style::kRimFade);
				if (into > 0.0) {
					ink.mix(style::kPaper, smooth(into) * style::kRimFadeWeight);
				}
				const double onLine = 1.0 - std::abs(distance - (radius - texel * style::kRimLineInset)) / texel;
				if (onLine > 0.0 && dashOn(std::atan2(y, x) * radius, style::kRimDash)) {
					ink.mix(style::kRimLine, onLine * style::kRimLineWeight);
				}
			}

			// A dot to a texel over what's baked, inside the disc.
			void stipple(std::span<const Point> dots) {
				for (const Point& dot : dots) {
					const int column = static_cast<int>(std::floor((dot.x + radius) / texel));
					const int row = static_cast<int>(std::floor((radius - dot.y) / texel));
					if (column < 0 || row < 0 || column >= size || row >= size) {
						continue;
					}
					const size_t out = (static_cast<size_t>(row) * static_cast<size_t>(size) + static_cast<size_t>(column)) * 4U;
					const double alpha = texels.rgba[out + 3] / 255.0;
					if (alpha <= 0.0) {
						continue;
					}
					for (size_t channel = 0; channel < 3; ++channel) {
						const double value = texels.rgba[out + channel];
						texels.rgba[out + channel] =
							static_cast<uint8_t>(value + (style::kStipple[channel] * alpha - value) * style::kStippleWeight + 0.5);
					}
				}
			}

			const rules::map::Ground&  ground;
			const rules::map::Terrain& terrain;
			int						   size;
			double					   radius;
			double					   texel;
			int						   step;
			int						   nodes;
			rules::map::LandGrid	   lakeGrid;
			std::span<const double>	   lakeDepth;
			double					   outerSquared{0};
			double					   innerSquared{0};
			double					   rimSquared{0};
			std::vector<float>		   colours;
			int						   shadeStep{1};
			int						   shadeNodes{0};
			std::vector<float>		   shades;
			std::vector<float>		   shadeRow;
			int						   cliffNodes{0};
			std::vector<float>		   cliffs;
			std::vector<Patch>		   patchList;
			std::vector<BlockGrid>	   blockGrids;
			// What reaches the row being baked.
			std::vector<const Patch*>					rowPatches;
			std::vector<const rules::map::Hotspot*>		rowHotspots;
			std::vector<const rules::map::HatchRegion*> rowHatches;
			Texels										texels;
		};

	} // namespace

	int landBakeSize(int radius) {
		const int size = static_cast<int>(std::ceil(radius * 2.0 / kTexelWorldUnits));
		return std::clamp(size, kMinBakeSize, kMaxBakeSize);
	}

	Texels bakeLand(const LandBakeArgs& args) {
		if (args.size < 2) {
			throw std::invalid_argument("bakeLand: a bake is 2 texels a side or more");
		}
		LandBaker baker(args);
		return baker.bake(args);
	}

	Texels bakeFog(const rules::map::LandFog& fog) {
		using rules::map::kFogCells;
		const int size = kFogCells * style::kFogTexelsPerCell;
		Texels	  texels{.size = size, .rgba = std::vector<uint8_t>(static_cast<size_t>(size) * static_cast<size_t>(size) * 4U, 0)};
		// 1 where a cell is hidden, by row from the north.
		const auto hidden = [&](int column, int northRow) {
			const int clampedColumn = std::clamp(column, 0, kFogCells - 1);
			const int row = kFogCells - 1 - std::clamp(northRow, 0, kFogCells - 1);
			return fog.revealed({.column = clampedColumn, .row = row}) ? 0.0 : 1.0;
		};
		const double half = size / 2.0;
		for (int row = 0; row < size; ++row) {
			const double cellRow = (row + 0.5) / style::kFogTexelsPerCell - 0.5;
			const int	 top = static_cast<int>(std::floor(cellRow));
			const double fy = cellRow - top;
			for (int column = 0; column < size; ++column) {
				const double cellColumn = (column + 0.5) / style::kFogTexelsPerCell - 0.5;
				const int	 left = static_cast<int>(std::floor(cellColumn));
				const double fx = cellColumn - left;
				const double wash =
					smooth(bilinear(hidden(left, top), hidden(left + 1, top), hidden(left, top + 1), hidden(left + 1, top + 1), fx, fy));
				const double dx = column + 0.5 - half;
				const double dy = row + 0.5 - half;
				const double disc = clamp01(half - std::sqrt(dx * dx + dy * dy) + 0.5);
				const double alpha = wash * disc * style::kFogAlpha;
				const size_t out = (static_cast<size_t>(row) * static_cast<size_t>(size) + static_cast<size_t>(column)) * 4U;
				for (size_t channel = 0; channel < 3; ++channel) {
					texels.rgba[out + channel] = static_cast<uint8_t>(style::kFogDark[channel] * alpha + 0.5);
				}
				texels.rgba[out + 3] = static_cast<uint8_t>(255.0 * alpha + 0.5);
			}
		}
		return texels;
	}

} // namespace game
