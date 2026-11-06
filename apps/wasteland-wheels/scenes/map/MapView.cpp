#include "scenes/map/MapView.h"

#include "Fonts.h"
#include "atlas/Ink.h"
#include "atlas/Tokens.h"
#include "scenes/map/LandBake.h"
#include "scenes/map/MapPicture.h"
#include "scenes/map/MapStyle.h"

#include <primitives/Primitives.h>
#include <rules/map/LabelLayout.h>
#include <rules/map/LandFog.h>
#include <rules/map/RouteLegs.h>
#include <ui/Context.h>

#include <glm/gtc/matrix_transform.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <map>
#include <numbers>

namespace game {

	namespace {

		namespace style = mapstyle;
		namespace Primitives = Renderer::Primitives;
		using rules::map::LegKnowledge;
		using rules::map::Point;
		using rules::map::RoadClass;

		constexpr float kPi = std::numbers::pi_v<float>;

		Foundation::Color mix(Foundation::Color from, Foundation::Color to, float amount) {
			return {
				from.r + (to.r - from.r) * amount,
				from.g + (to.g - from.g) * amount,
				from.b + (to.b - from.b) * amount,
				from.a + (to.a - from.a) * amount,
			};
		}

		double lengthOf(const std::vector<Point>& points) {
			double length = 0.0;
			for (size_t index = 1; index < points.size(); ++index) {
				length += std::hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
			}
			return length;
		}

		// The stretch of a polyline from `from` to `to` world units along it.
		std::vector<Point> slice(const std::vector<Point>& points, double from, double to) {
			std::vector<Point> out;
			double			   walked = 0.0;
			for (size_t index = 1; index < points.size(); ++index) {
				const Point& a = points[index - 1];
				const Point& b = points[index];
				const double step = std::hypot(b.x - a.x, b.y - a.y);
				if (step <= 0.0) {
					continue;
				}
				const double start = walked;
				const double end = walked + step;
				walked = end;
				if (end < from || start > to) {
					continue;
				}
				const auto at = [&](double along) {
					const double share = std::clamp((along - start) / step, 0.0, 1.0);
					return Point{a.x + (b.x - a.x) * share, a.y + (b.y - a.y) * share};
				};
				if (out.empty()) {
					out.push_back(at(std::max(from, start)));
				}
				out.push_back(at(std::min(to, end)));
			}
			return out;
		}

		Point pointAlong(const std::vector<Point>& points, double share) {
			const double			 length = lengthOf(points);
			const std::vector<Point> head = slice(points, 0.0, length * std::clamp(share, 0.0, 1.0));
			return head.empty() ? (points.empty() ? Point{} : points.front()) : head.back();
		}

		// A route's road as one polyline, from the compound out.
		std::vector<Point>
		routePoints(const rules::map::RoadNetwork& network, const rules::map::RouteLegs& legs, const std::vector<int>& route) {
			std::vector<Point> points;
			for (const int leg : route) {
				for (const Point& point : rules::map::legPoints(network, legs.legs.at(static_cast<size_t>(leg)))) {
					if (points.empty() || !(points.back() == point)) {
						points.push_back(point);
					}
				}
			}
			return points;
		}

		std::array<Foundation::Vec2, 10> starPoints(Foundation::Vec2 centre, float outer, float inner) {
			std::array<Foundation::Vec2, 10> points{};
			for (size_t index = 0; index < points.size(); ++index) {
				const float angle = -kPi / 2.0F + static_cast<float>(index) * kPi / 5.0F;
				const float reach = index % 2 == 0 ? outer : inner;
				points[index] = {centre.x + std::cos(angle) * reach, centre.y + std::sin(angle) * reach};
			}
			return points;
		}

	} // namespace

	MapView::MapView(const Args& args)
		: layers(args.layers),
		  area(args.area),
		  picture(args.picture),
		  planning(args.planning),
		  routesOf(args.routesOf),
		  picked(args.picked),
		  selected(args.selected),
		  onPick(args.onPick) {
		if (layers == nullptr || planning == nullptr) {
			throw std::invalid_argument("MapView: it needs the map's layers and the scene's planning");
		}
		radius = static_cast<double>(layers->params.radius);
	}

	void MapView::select(std::optional<int> poi) {
		if (poi == selected) {
			return;
		}
		selected = poi;
		if (scale > 0.0) {
			buildLabels();
		}
	}

	void MapView::pick(int route) {
		if (route == picked) {
			return;
		}
		picked = route;
		if (scale > 0.0) {
			buildBands();
		}
	}

	std::optional<Foundation::Vec2> MapView::markerAt(int poi) const {
		const auto found = std::ranges::find(markers, poi, &Marker::poi);
		return found == markers.end() ? std::nullopt : std::optional<Foundation::Vec2>(found->at);
	}

	void MapView::describe(nlohmann::json& node) const {
		node["selected"] = selected ? nlohmann::json(*selected) : nlohmann::json(nullptr);
		node["routesOf"] = routesOf ? nlohmann::json(*routesOf) : nlohmann::json(nullptr);
		node["picked"] = picked;
		node["markers"] = markers.size();
		node["labels"] = labels.size();
		node["land"] = picture != nullptr && picture->baked();
	}

	Foundation::Vec2 MapView::toBox(double x, double y) const {
		return {
			static_cast<float>(size.x * 0.5 + (x - centreX) * scale),
			static_cast<float>(size.y * 0.5 - (y - centreY) * scale),
		};
	}

	float MapView::roadScale() const {
		const float zoom = static_cast<float>(scale);
		return std::clamp(std::pow(zoom / style::kRoadZoomReference, style::kRoadZoomPower), style::kRoadZoomMin, style::kRoadZoomMax);
	}

	bool MapView::revealed(double x, double y) const {
		return rules::map::revealedAt(planning->knowledge.land, {x, y}, radius);
	}

	void MapView::frameIt() {
		double	   minX = std::numeric_limits<double>::infinity();
		double	   minY = minX;
		double	   maxX = -minX;
		double	   maxY = -minX;
		const auto take = [&](double x, double y) {
			minX = std::min(minX, x);
			minY = std::min(minY, y);
			maxX = std::max(maxX, x);
			maxY = std::max(maxY, y);
		};
		take(0.0, 0.0);
		double			   margin = radius * style::kFrameMargin;
		const Destination* destination = routesOf ? planning->find(*routesOf) : nullptr;
		if (destination != nullptr) {
			const Point& site = layers->pois.pois.at(static_cast<size_t>(destination->poi)).site.at;
			take(site.x, site.y);
			for (const rules::map::RouteOffer& offer : destination->routes) {
				for (const Point& point : routePoints(layers->network, layers->pois.legs, offer.route.legs)) {
					take(point.x, point.y);
				}
			}
			const double grow = style::kRouteFrameMin * 0.5;
			const double middleX = (minX + maxX) * 0.5;
			const double middleY = (minY + maxY) * 0.5;
			take(middleX - grow, middleY - grow);
			take(middleX + grow, middleY + grow);
			margin = std::max(maxX - minX, maxY - minY) * style::kFrameMargin;
		} else {
			const double cell = radius * 2.0 / rules::map::kFogCells;
			for (int row = 0; row < rules::map::kFogCells; ++row) {
				for (int column = 0; column < rules::map::kFogCells; ++column) {
					if (planning->knowledge.land.revealed({.column = column, .row = row})) {
						const Point centre = rules::map::fogCellCentre({.column = column, .row = row}, radius);
						take(centre.x - cell * 0.5, centre.y - cell * 0.5);
						take(centre.x + cell * 0.5, centre.y + cell * 0.5);
					}
				}
			}
			for (const Destination& found : planning->destinations) {
				const Point& site = layers->pois.pois.at(static_cast<size_t>(found.poi)).site.at;
				take(site.x, site.y);
			}
		}
		const double reach = radius * 1.05;
		frameMinX = std::max(-reach, minX - margin);
		frameMinY = std::max(-reach, minY - margin);
		frameMaxX = std::min(reach, maxX + margin);
		frameMaxY = std::min(reach, maxY + margin);
		centreX = (frameMinX + frameMaxX) * 0.5;
		centreY = (frameMinY + frameMaxY) * 0.5;
		scale = std::min(size.x / std::max(1.0, frameMaxX - frameMinX), size.y / std::max(1.0, frameMaxY - frameMinY));
	}

	void MapView::rebuild() {
		builtFor = size;
		frameIt();
		if (!fogTexture) {
			const Texels fog = bakeFog(planning->knowledge.land);
			fogTexture = Primitives::createTexture({
				.width = fog.size,
				.height = fog.size,
				.format = Renderer::TextureFormat::Rgba8,
				.linear = true,
				.pixels = fog.rgba.data(),
			});
		}
		buildRoads();
		buildBands();
		buildMarkers();
		buildLabels();
	}

	void MapView::buildRoads() {
		underFog.clear();
		roads.clear();
		overRoads.clear();
		const float widths = roadScale();
		const auto	inBox = [&](const std::vector<Point>& points) {
			 std::vector<Foundation::Vec2> out;
			 out.reserve(points.size());
			 for (const Point& point : points) {
				 out.push_back(toBox(point.x, point.y));
			 }
			 return out;
		};

		if (area != nullptr && area->water) {
			const Foundation::Color river = style::rgb(style::kRiver);
			for (const rules::map::River& stream : area->water->rivers()) {
				Stroke run;
				bool   runInside = true;
				for (const rules::map::RiverPoint& point : stream.line) {
					const double		   stepped = std::round(point.width / style::kRiverWidthStep) * style::kRiverWidthStep;
					const float			   width = std::max(style::kRiverMinPixels, static_cast<float>(stepped * scale));
					const bool			   inside = point.x * point.x + point.y * point.y <= radius * radius;
					const Foundation::Vec2 at = toBox(point.x, point.y);
					if (!run.points.empty() && (std::abs(width - run.width) > 0.01F || inside != runInside)) {
						const Foundation::Vec2 joint = run.points.back();
						underFog.push_back(std::move(run));
						run = Stroke{};
						run.points.push_back(joint);
					}
					run.width = width;
					runInside = inside;
					run.color = inside ? river : atlas::withAlpha(river, style::kRiverOutside);
					run.points.push_back(at);
				}
				if (run.points.size() >= 2) {
					underFog.push_back(std::move(run));
				}
			}
		}
		if (area != nullptr && area->dressing) {
			for (const rules::map::RailLine& rail : area->dressing->rails) {
				const std::vector<Foundation::Vec2> points = inBox(rail.points);
				underFog.push_back({.points = points, .width = style::kRailWidth, .color = style::rgb(style::kRail), .roundCaps = false});
				underFog.push_back({
					.points = points,
					.width = style::kRailTieWidth,
					.color = style::rgb(style::kPaper),
					.dash = Foundation::DashPattern{.dash = style::kRailDash, .gap = style::kRailDash},
					.roundCaps = false,
				});
			}
		}

		// Each stretch by the most known of the legs that drive it; -1 for one no leg drives.
		const rules::map::RoadNetwork&		network = layers->network;
		std::vector<int>					known(network.stretches.size(), -1);
		const std::vector<rules::map::Leg>& legs = layers->pois.legs.legs;
		const auto							legKnowledge = [&](size_t leg) {
			 return leg < planning->knowledge.legs.size() ? planning->knowledge.legs[leg] : LegKnowledge::Charted;
		};
		for (size_t leg = 0; leg < legs.size(); ++leg) {
			for (const rules::map::LegPiece& piece : legs[leg].pieces) {
				int& best = known.at(static_cast<size_t>(piece.stretch));
				best = std::max(best, static_cast<int>(legKnowledge(leg)));
			}
		}
		struct Drawn {
			std::vector<Foundation::Vec2> points;
			RoadClass					  roadClass;
			bool						  rumored;
		};
		std::vector<Drawn>	drawn;
		std::vector<size_t> drawnStretches;
		for (size_t index = 0; index < network.stretches.size(); ++index) {
			const rules::map::RoadStretch& stretch = network.stretches[index];
			const int					   knowledge = stretch.street ? static_cast<int>(LegKnowledge::Charted) : known[index];
			if (knowledge == static_cast<int>(LegKnowledge::Uncharted)) {
				continue;
			}
			if (knowledge >= 0) {
				drawn.push_back({inBox(stretch.points), stretch.roadClass, knowledge == static_cast<int>(LegKnowledge::Rumored)});
				drawnStretches.push_back(index);
				continue;
			}
			// A road no route drives shows where the land is revealed.
			std::vector<Point> run;
			bool			   whole = true;
			for (const Point& point : stretch.points) {
				if (revealed(point.x, point.y)) {
					run.push_back(point);
					continue;
				}
				whole = false;
				if (run.size() >= 2) {
					drawn.push_back({inBox(run), stretch.roadClass, false});
				}
				run.clear();
			}
			if (run.size() >= 2) {
				drawn.push_back({inBox(run), stretch.roadClass, false});
			}
			if (whole) {
				drawnStretches.push_back(index);
			}
		}
		const Foundation::Color			   paper = style::rgb(style::kPaper);
		constexpr std::array<RoadClass, 3> kUnderFirst{RoadClass::Trail, RoadClass::BackRoad, RoadClass::Highway};
		for (const bool casing : {true, false}) {
			for (const RoadClass roadClass : kUnderFirst) {
				const style::RoadStyle& look = style::kRoads.at(static_cast<size_t>(roadClass));
				if (casing && look.casing.a <= 0.0F) {
					continue;
				}
				for (const Drawn& road : drawn) {
					if (road.roadClass != roadClass) {
						continue;
					}
					Foundation::Color colour = casing ? look.casing : look.fill;
					if (road.rumored) {
						colour = mix(colour, paper, style::kRumoredFade);
					}
					Stroke stroke{.points = road.points, .width = (casing ? look.casingWidth : look.width) * widths, .color = colour};
					if (!casing && look.dash > 0.0F) {
						stroke.dash = Foundation::DashPattern{.dash = look.dash, .gap = look.gap};
						stroke.roundCaps = false;
					}
					roads.push_back(std::move(stroke));
				}
			}
		}

		// An uncharted leg off known road is a stub into the fog, fading.
		for (size_t leg = 0; leg < legs.size(); ++leg) {
			const int parent = legs[leg].parent;
			if (legKnowledge(leg) != LegKnowledge::Uncharted ||
				(parent >= 0 && legKnowledge(static_cast<size_t>(parent)) == LegKnowledge::Uncharted) || legs[leg].pieces.empty()) {
				continue;
			}
			const std::vector<Point> points = rules::map::legPoints(network, legs[leg]);
			const RoadClass			 roadClass = network.stretches.at(static_cast<size_t>(legs[leg].pieces.front().stretch)).roadClass;
			const style::RoadStyle&	 look = style::kRoads.at(static_cast<size_t>(roadClass));
			constexpr std::array<float, 4> kFade{0.9F, 0.65F, 0.4F, 0.18F};
			const double				   piece = style::kStubLength / static_cast<double>(kFade.size());
			for (size_t part = 0; part < kFade.size(); ++part) {
				const std::vector<Point> stub = slice(points, piece * static_cast<double>(part), piece * static_cast<double>(part + 1));
				if (stub.size() < 2) {
					break;
				}
				roads.push_back({
					.points = inBox(stub),
					.width = look.width * widths,
					.color = atlas::withAlpha(look.fill, kFade.at(part)),
					.dash = Foundation::DashPattern{.dash = style::kStubDash, .gap = style::kStubGap},
					.roundCaps = false,
				});
			}
		}

		// Collapsed spans: a highway either side of a gap, a red cross over it, where its middle is revealed.
		const style::RoadStyle& highway = style::kRoads.at(static_cast<size_t>(RoadClass::Highway));
		for (const rules::map::RoadStretch& span : network.broken) {
			const double length = lengthOf(span.points);
			const Point	 middle = pointAlong(span.points, 0.5);
			if (!revealed(middle.x, middle.y)) {
				continue;
			}
			const double gap = style::kBrokenGap * 0.5 / scale;
			for (const auto& [from, to] : {std::pair{0.0, length * 0.5 - gap}, std::pair{length * 0.5 + gap, length}}) {
				const std::vector<Point> part = slice(span.points, from, to);
				if (part.size() < 2) {
					continue;
				}
				overRoads.push_back(
					{.points = inBox(part), .width = highway.casingWidth * widths, .color = highway.casing, .roundCaps = false}
				);
				overRoads.push_back({.points = inBox(part), .width = highway.width * widths, .color = highway.fill, .roundCaps = false});
			}
			const Foundation::Vec2	at = toBox(middle.x, middle.y);
			const float				half = style::kBrokenCrossHalf;
			const Foundation::Color red = style::rgb(style::kBrokenCross);
			overRoads.push_back({.points = {{at.x - half, at.y - half}, {at.x + half, at.y + half}}, .width = 2.0F, .color = red});
			overRoads.push_back({.points = {{at.x - half, at.y + half}, {at.x + half, at.y - half}}, .width = 2.0F, .color = red});
		}

		if (scale < style::kDetailZoom) {
			return;
		}
		// Bridges: a parapet either side of each deck, just outside the road, flared at both ends.
		const Foundation::Color parapet = style::rgb(style::kBridge);
		for (const size_t index : drawnStretches) {
			const rules::map::RoadStretch& stretch = network.stretches[index];
			const style::RoadStyle&		   look = style::kRoads.at(static_cast<size_t>(stretch.roadClass));
			const float					   reach = std::max(look.casingWidth, look.width) * widths * 0.5F + style::kBridgeGap;
			for (const rules::map::RoadBridge& bridge : stretch.bridges) {
				const std::vector<Point> deck = slice(stretch.points, bridge.start, bridge.end);
				if (deck.size() < 2) {
					continue;
				}
				const Foundation::Vec2 start = toBox(deck.front().x, deck.front().y);
				const Foundation::Vec2 end = toBox(deck.back().x, deck.back().y);
				const float			   length = std::hypot(end.x - start.x, end.y - start.y);
				if (length <= 0.0F) {
					continue;
				}
				const Foundation::Vec2 along{(end.x - start.x) / length, (end.y - start.y) / length};
				const Foundation::Vec2 across{-along.y, along.x};
				const float			   flare = style::kBridgeFlare;
				for (const float side : {1.0F, -1.0F}) {
					const Foundation::Vec2 out{across.x * side, across.y * side};
					overRoads.push_back({
						.points =
							{
								{start.x - along.x * flare + out.x * (reach + flare), start.y - along.y * flare + out.y * (reach + flare)},
								{start.x + out.x * reach, start.y + out.y * reach},
								{end.x + out.x * reach, end.y + out.y * reach},
								{end.x + along.x * flare + out.x * (reach + flare), end.y + along.y * flare + out.y * (reach + flare)},
							},
						.width = 1.0F,
						.color = parapet,
						.roundCaps = false,
					});
				}
			}
		}
		const Foundation::Color ink = style::rgb(style::kInk);
		for (const rules::map::RoadPass& pass : network.passes) {
			if (!revealed(pass.x, pass.y)) {
				continue;
			}
			const Foundation::Vec2 at = toBox(pass.x, pass.y);
			overRoads.push_back({
				.points =
					{{at.x - style::kPassHalf, at.y + style::kPassRise * 0.5F},
					 {at.x, at.y - style::kPassRise * 0.5F},
					 {at.x + style::kPassHalf, at.y + style::kPassRise * 0.5F}},
				.width = 1.5F,
				.color = ink,
			});
		}
		if (area != nullptr && area->water) {
			for (const rules::map::Lake& lake : area->water->lakes()) {
				if (!lake.dam || !revealed(lake.dam->x, lake.dam->y)) {
					continue;
				}
				const Foundation::Vec2 at = toBox(lake.dam->x, lake.dam->y);
				const Foundation::Vec2 across{static_cast<float>(lake.dam->towardY), static_cast<float>(lake.dam->towardX)};
				const float			   half = style::kDamLength * 0.5F;
				overRoads.push_back({
					.points = {{at.x - across.x * half, at.y - across.y * half}, {at.x + across.x * half, at.y + across.y * half}},
					.width = style::kDamWidth,
					.color = style::rgb(style::kDam),
					.roundCaps = false,
				});
			}
		}
	}

	void MapView::buildBands() {
		bands.clear();
		stops.clear();
		const Destination* destination = routesOf ? planning->find(*routesOf) : nullptr;
		if (destination == nullptr || destination->routes.empty()) {
			return;
		}
		const float				widths = roadScale();
		const Foundation::Color highlighter = getContext()->getTheme().get(atlas::tokens::palette::highlighter);
		const Foundation::Color paper = style::rgb(style::kPaper);
		const auto				band = [&](const rules::map::RouteOffer& offer, float width, Foundation::Color colour) {
			 Stroke stroke{.width = width * widths, .color = colour};
			 for (const Point& point : routePoints(layers->network, layers->pois.legs, offer.route.legs)) {
				 stroke.points.push_back(toBox(point.x, point.y));
			 }
			 bands.push_back(std::move(stroke));
		};
		const int chosen = std::clamp(picked, 0, static_cast<int>(destination->routes.size()) - 1);
		for (size_t index = 0; index < destination->routes.size(); ++index) {
			if (static_cast<int>(index) != chosen) {
				band(destination->routes[index], style::kOtherBand, mix(highlighter, paper, style::kOtherBandFade));
			}
		}
		const rules::map::RouteOffer& offer = destination->routes.at(static_cast<size_t>(chosen));
		band(offer, style::kPickedBand, highlighter);
		for (const rules::map::KnownStop& stop : offer.outlook.stops) {
			const std::vector<Point> points =
				rules::map::legPoints(layers->network, layers->pois.legs.legs.at(static_cast<size_t>(stop.leg)));
			const Point at = pointAlong(points, stop.at);
			stops.push_back({
				.at = toBox(at.x, at.y),
				.fight = stop.type.has_value() && rules::map::isFight(*stop.type),
				.known = stop.type.has_value(),
			});
		}
	}

	void MapView::buildMarkers() {
		markers.clear();
		for (const Destination& destination : planning->destinations) {
			const Point& site = layers->pois.pois.at(static_cast<size_t>(destination.poi)).site.at;
			markers.push_back({
				.poi = destination.poi,
				.at = toBox(site.x, site.y),
				.glyph = destination.glyph,
				.stronghold = destination.stronghold,
				.cleared = destination.cleared,
				.night = !destination.homeByDark(),
				.fogged = !revealed(site.x, site.y),
			});
		}
	}

	void MapView::buildLabels() {
		labels.clear();
		using rules::map::LabelKind;
		using rules::map::MapLabel;
		const Foundation::Color paper = style::rgb(style::kPaper);
		const Foundation::Color fogDark = style::rgb(style::kFogDark);
		const Foundation::Color ink = style::rgb(style::kInk);

		// Home's label first, under its star.
		const Foundation::Vec2 home = toBox(0.0, 0.0);
		const float			   homeWidth = atlas::printedWidth("Home", fonts::kDisplayBold, style::kPoiLabel.size);
		const float			   homeTop = home.y + style::kHomeOuter + style::kLabelGap;
		labels.push_back({
			.text = "Home",
			.centre = {home.x, homeTop + style::kPoiLabel.size * 0.62F},
			.width = homeWidth,
			.size = style::kPoiLabel.size,
			.ink = ink,
			.halo = paper,
		});

		// What's kept clear: the markers, Home and its label, the picked route's stops.
		const auto worldBox = [&](Foundation::Vec2 at, float halfX, float halfY) {
			const double x = centreX + (at.x - size.x * 0.5) / scale;
			const double y = centreY - (at.y - size.y * 0.5) / scale;
			return rules::map::LabelBox{
				.minX = x - halfX / scale, .minY = y - halfY / scale, .maxX = x + halfX / scale, .maxY = y + halfY / scale
			};
		};
		std::vector<rules::map::LabelBox> blocked;
		blocked.push_back(worldBox(home, style::kHomeOuter + style::kHomeHalo, style::kHomeOuter + style::kHomeHalo));
		blocked.push_back(worldBox({home.x, homeTop + style::kPoiLabel.size * 0.62F}, homeWidth * 0.5F, style::kPoiLabel.size * 0.62F));
		for (const Marker& marker : markers) {
			const float reach = (marker.stronghold ? style::kStrongholdHalf + style::kStrongholdEdge : style::kMarkerRadius) + 1.0F;
			blocked.push_back(worldBox(marker.at, reach, reach));
		}
		for (const RouteStop& stop : stops) {
			blocked.push_back(worldBox(stop.at, style::kStopHalf + 1.0F, style::kStopHalf + 1.0F));
		}

		// The candidates: the dressing's where the map has one, else the POIs and the places'.
		std::vector<MapLabel> candidates;
		const auto			  found = [&](int poi) {
			   return planning->find(poi) != nullptr;
		};
		if (area != nullptr && area->dressing) {
			for (const MapLabel& label : area->dressing->labels) {
				const bool poi = label.kind == LabelKind::Poi || label.kind == LabelKind::Stronghold;
				if (poi ? found(label.ref) : revealed(label.at.x, label.at.y)) {
					candidates.push_back(label);
				}
			}
		} else {
			for (const Destination& destination : planning->destinations) {
				const Point& site = layers->pois.pois.at(static_cast<size_t>(destination.poi)).site.at;
				candidates.push_back({
					.kind = destination.stronghold ? LabelKind::Stronghold : LabelKind::Poi,
					.text = destination.name,
					.priority = destination.stronghold ? 95.0 : 90.0,
					.at = site,
					.path = {},
					.ref = destination.poi,
				});
			}
			for (const auto& [list, kind, priority] :
				 {std::tuple{&layers->places.towns(), LabelKind::Town, 80.0},
				  std::tuple{&layers->places.villages(), LabelKind::Village, 50.0}}) {
				for (const rules::map::Settlement& place : *list) {
					if (revealed(place.x, place.y)) {
						candidates.push_back(
							{.kind = kind, .text = place.name, .priority = priority, .at = {place.x, place.y}, .path = {}, .ref = place.id}
						);
					}
				}
			}
			std::ranges::stable_sort(candidates, std::greater<>{}, &MapLabel::priority);
		}
		// The chosen POI's label goes first, so it's set wherever there's room.
		if (selected) {
			const auto chosen = std::ranges::find_if(candidates, [&](const MapLabel& label) {
				return (label.kind == LabelKind::Poi || label.kind == LabelKind::Stronghold) && label.ref == *selected;
			});
			if (chosen != candidates.end()) {
				std::rotate(candidates.begin(), chosen, chosen + 1);
			}
		}

		std::map<int, double> placeRadius;
		for (const auto* list : {&layers->places.towns(), &layers->places.villages()}) {
			for (const rules::map::Settlement& place : *list) {
				placeRadius[place.id] = place.radius;
			}
		}
		struct Look {
			style::LabelStyle font;
			Foundation::Color ink;
			std::string		  text;
		};
		std::vector<Look>				   looks;
		std::vector<rules::map::LabelSize> sizes;
		for (const MapLabel& label : candidates) {
			Look  look{.font = style::kPoiLabel, .ink = ink, .text = label.text};
			float offset = style::kMarkerRadius + style::kLabelGap;
			switch (label.kind) {
				case LabelKind::Metro:
					look.font = style::kMetroLabel;
					offset = style::kHomeOuter + style::kLabelGap + style::kPoiLabel.size * style::kLineHeight;
					break;
				case LabelKind::Stronghold:
					look.ink = style::rgb(style::kStrongholdInk);
					offset = style::kStrongholdHalf + style::kLabelGap;
					break;
				case LabelKind::Poi: {
					const Destination* destination = planning->find(label.ref);
					if (destination != nullptr && destination->cleared) {
						look.ink = style::rgb(style::kSpent);
					}
					break;
				}
				case LabelKind::Town:
					look.font = style::kTownLabel;
					offset = std::min(10.0F, static_cast<float>(placeRadius[label.ref] * 0.5 * scale)) + style::kLabelGap * 0.5F;
					break;
				case LabelKind::Village:
					look.font = style::kVillageLabel;
					look.ink = style::rgb(style::kVillageInk);
					offset = std::min(5.0F, static_cast<float>(placeRadius[label.ref] * 0.5 * scale)) + style::kLabelGap * 0.5F;
					break;
				case LabelKind::Shield:
					offset = 0.0F;
					break;
				case LabelKind::Range:
					look.font = style::kFeatureLabel;
					look.font.capitals = true;
					look.ink = getContext()->getTheme().get(atlas::tokens::palette::inkDim);
					offset = 0.0F;
					break;
				case LabelKind::Reservoir:
				case LabelKind::Lake:
				case LabelKind::River:
					look.font = style::kFeatureLabel;
					look.ink = style::rgb(style::kWaterInk);
					offset = 0.0F;
					break;
				case LabelKind::Pass:
					look.font = style::kVillageLabel;
					look.ink = style::rgb(style::kVillageInk);
					offset = style::kPassHalf + style::kLabelGap;
					break;
			}
			if (look.font.capitals) {
				std::ranges::transform(look.text, look.text.begin(), [](unsigned char letter) {
					return static_cast<char>(std::toupper(letter));
				});
			}
			const Renderer::FontFamily face = look.font.body ? fonts::kBody : fonts::kDisplayBold;
			float width = atlas::printedWidth(look.text, face, look.font.size, look.font.letterSpacing * look.font.size);
			float height = look.font.size * style::kLineHeight;
			if (label.kind == LabelKind::Shield) {
				width = std::max(width + 6.0F, style::kShieldHalf * 2.0F);
				height = style::kShieldHalf * 2.0F;
			}
			sizes.push_back({.halfLength = width * 0.5 / scale, .halfHeight = height * 0.5 / scale, .offset = offset / scale});
			looks.push_back(std::move(look));
		}
		const std::vector<rules::map::PlacedLabel> placed = rules::map::placeLabels({
			.labels = candidates,
			.sizes = sizes,
			.blocked = blocked,
			.pad = style::kLabelPad / scale,
		});
		for (const rules::map::PlacedLabel& at : placed) {
			const MapLabel& label = candidates.at(static_cast<size_t>(at.label));
			const Look&		look = looks.at(static_cast<size_t>(at.label));
			Label			drawn{
						  .text = look.text,
						  .width = static_cast<float>(sizes[static_cast<size_t>(at.label)].halfLength * 2.0 * scale),
						  .size = look.font.size,
						  .letterSpacing = look.font.letterSpacing * look.font.size,
						  .body = look.font.body,
						  .shield = label.kind == LabelKind::Shield,
						  .ink = look.ink,
						  .halo = paper,
			  };
			if (at.path.size() >= 2) {
				const Foundation::Vec2 from = toBox(at.path.front().x, at.path.front().y);
				const Foundation::Vec2 to = toBox(at.path.back().x, at.path.back().y);
				const Point			   middle = pointAlong(at.path, 0.5);
				drawn.centre = toBox(middle.x, middle.y);
				drawn.angle = std::atan2(to.y - from.y, to.x - from.x);
				if (drawn.angle > kPi / 2.0F) {
					drawn.angle -= kPi;
				} else if (drawn.angle < -kPi / 2.0F) {
					drawn.angle += kPi;
				}
			} else {
				drawn.centre = toBox((at.box.minX + at.box.maxX) * 0.5, (at.box.minY + at.box.maxY) * 0.5);
			}
			const bool poi = label.kind == LabelKind::Poi || label.kind == LabelKind::Stronghold;
			if (poi && !revealed(label.at.x, label.at.y)) {
				drawn.ink = label.kind == LabelKind::Stronghold ? drawn.ink : paper;
				drawn.halo = fogDark;
			}
			labels.push_back(std::move(drawn));
		}
	}

	void MapView::render() {
		if (size.x <= 1.0F || size.y <= 1.0F) {
			return;
		}
		if (size != builtFor || scale <= 0.0) {
			rebuild();
		}
		const int32_t			key = drawKey();
		const ui::Theme&		theme = getContext()->getTheme();
		const Foundation::Color ink = theme.get(atlas::tokens::palette::ink);
		const Foundation::Rect	box{0.0F, 0.0F, size.x, size.y};
		Primitives::drawRect({.bounds = box, .style = {.fill = style::rgb(style::kPaper)}, .key = key});
		Primitives::pushClip(box);
		const Foundation::Vec2 topLeft = toBox(-radius, radius);
		const Foundation::Vec2 bottomRight = toBox(radius, -radius);
		const Foundation::Rect disc{topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y};
		if (picture != nullptr) {
			if (const Renderer::TextureHandle land = picture->land(); land.isValid()) {
				Primitives::drawImage({.texture = land, .bounds = disc, .id = "map_land", .key = key});
			}
		}
		drawStrokes(underFog, key);
		if (fogTexture && fogTexture->isValid()) {
			Primitives::drawImage({.texture = fogTexture->handle(), .bounds = disc, .id = "map_fog", .key = key});
		}
		drawStrokes(bands, key);
		drawStrokes(roads, key);
		drawStrokes(overRoads, key);
		for (const RouteStop& stop : stops) {
			const float half = style::kStopHalf;
			if (stop.fight) {
				atlas::drawDiamond(stop.at, half * 2.0F + 2.0F, style::rgb(style::kPaper), key);
				atlas::drawDiamond(stop.at, half * 2.0F, ink, key);
			} else if (stop.known) {
				Primitives::drawRect({
					.bounds = {stop.at.x - half, stop.at.y - half, half * 2.0F, half * 2.0F},
					.style = {.fill = Foundation::Color::white(), .border = Foundation::BorderStyle{.color = ink, .width = 1.5F}},
					.key = key,
				});
			} else {
				Primitives::drawCircle({
					.center = stop.at,
					.radius = half,
					.style = {.fill = Foundation::Color::white(), .border = Foundation::BorderStyle{.color = ink, .width = 1.5F}},
					.key = key,
				});
			}
		}
		drawMarkers(key);
		drawHome(key);
		drawSelection(key);
		drawLabels(key);
		Primitives::popClip();
		// The plate's frame: a 1.6 px ink rule with a 0.6 px rule 4 px outside it.
		Primitives::drawRect({
			.bounds = box,
			.style = {.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F), .border = Foundation::BorderStyle{.color = ink, .width = 1.6F}},
			.key = key,
		});
		Primitives::drawRect({
			.bounds = {-4.0F, -4.0F, size.x + 8.0F, size.y + 8.0F},
			.style = {.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F), .border = Foundation::BorderStyle{.color = ink, .width = 0.6F}},
			.key = key,
		});
	}

	void MapView::drawStrokes(const std::vector<Stroke>& strokes, int32_t key) const {
		for (const Stroke& stroke : strokes) {
			if (stroke.points.size() < 2) {
				continue;
			}
			Primitives::drawPolyline({
				.points = stroke.points,
				.width = stroke.width,
				.color = stroke.color,
				.cap = stroke.roundCaps ? Primitives::LineCap::Round : Primitives::LineCap::Butt,
				.join = Primitives::LineJoin::Round,
				.dash = stroke.dash,
				.key = key,
			});
		}
	}

	void MapView::drawMarkers(int32_t key) const {
		const ui::Theme&		theme = getContext()->getTheme();
		const Foundation::Color ink = theme.get(atlas::tokens::palette::ink);
		const Foundation::Color paper = style::rgb(style::kPaper);
		const Foundation::Color spent = style::rgb(style::kSpent);
		const Foundation::Color clear{0.0F, 0.0F, 0.0F, 0.0F};
		for (const Marker& marker : markers) {
			if (marker.night) {
				Primitives::drawCircle({
					.center = marker.at,
					.radius = style::kMarkerRadius + style::kNightGap + style::kNightWidth * 0.5F,
					.style =
						{.fill = clear, .border = Foundation::BorderStyle{.color = style::rgb(style::kNight), .width = style::kNightWidth}},
					.key = key,
				});
			}
			if (marker.stronghold) {
				atlas::drawDiamond(marker.at, (style::kStrongholdHalf + style::kStrongholdEdge) * 2.0F, paper, key);
				atlas::drawDiamond(marker.at, style::kStrongholdHalf * 2.0F, theme.get(atlas::tokens::palette::stronghold), key);
				continue;
			}
			if (!marker.cleared) {
				atlas::drawCircled(marker.at, style::kMarkerRadius, marker.glyph, ink, key);
				continue;
			}
			Primitives::drawCircle({
				.center = marker.at,
				.radius = style::kMarkerRadius,
				.style = {.fill = spent, .border = Foundation::BorderStyle{.color = spent, .width = 1.5F}},
				.key = key,
			});
			atlas::print({
				.text = marker.glyph,
				.position = {marker.at.x - style::kMarkerRadius, marker.at.y - style::kMarkerRadius * 1.15F * 0.62F},
				.face = fonts::kDisplayBold,
				.size = style::kMarkerRadius * 1.15F,
				.color = paper,
				.align = Foundation::HorizontalAlign::Center,
				.boxWidth = style::kMarkerRadius * 2.0F,
				.key = key,
			});
			const float strike = style::kMarkerRadius * style::kStrikeShare;
			Primitives::drawLine({
				.start = {marker.at.x - strike, marker.at.y + strike},
				.end = {marker.at.x + strike, marker.at.y - strike},
				.style = {.color = ink, .width = 1.5F},
				.key = key,
			});
		}
	}

	void MapView::drawHome(int32_t key) const {
		const Foundation::Vec2				   home = toBox(0.0, 0.0);
		const std::array<Foundation::Vec2, 10> halo =
			starPoints(home, style::kHomeOuter + style::kHomeHalo, style::kHomeInner + style::kHomeHalo * 0.55F);
		const std::array<Foundation::Vec2, 10> star = starPoints(home, style::kHomeOuter, style::kHomeInner);
		Primitives::drawPolygon({.vertices = halo, .style = {.fill = style::rgb(style::kPaper)}, .key = key});
		Primitives::drawPolygon(
			{.vertices = star, .style = {.fill = getContext()->getTheme().get(atlas::tokens::palette::ink)}, .key = key}
		);
	}

	// The grease pencil's loop round the chosen marker, a little off round, its wobble from the POI.
	void MapView::drawSelection(int32_t key) const {
		if (!selected) {
			return;
		}
		const std::optional<Foundation::Vec2> at = markerAt(*selected);
		if (!at) {
			return;
		}
		const auto					  seed = static_cast<float>(*selected);
		const float					  phase2 = std::fmod(seed * 2.399F, 2.0F * kPi);
		const float					  phase3 = std::fmod(seed * 1.618F + 1.0F, 2.0F * kPi);
		const float					  start = std::fmod(seed * 0.7F, 2.0F * kPi);
		std::vector<Foundation::Vec2> loop;
		constexpr int				  kSteps = 40;
		for (int step = 0; step <= kSteps; ++step) {
			// A little past a whole turn, as a hand closes a loop.
			const float angle = start + (2.0F * kPi + 0.45F) * static_cast<float>(step) / kSteps;
			const float reach =
				style::kLoopRadius * (1.0F + 0.07F * std::sin(2.0F * angle + phase2) + 0.04F * std::sin(3.0F * angle + phase3)) +
				1.5F * static_cast<float>(step) / kSteps;
			loop.push_back({at->x + std::cos(angle) * reach, at->y + std::sin(angle) * reach});
		}
		Primitives::drawPolyline({
			.points = loop,
			.width = style::kLoopWidth,
			.color = getContext()->getTheme().get(atlas::tokens::palette::grease),
			.cap = Primitives::LineCap::Round,
			.join = Primitives::LineJoin::Round,
			.key = key,
		});
	}

	void MapView::drawLabels(int32_t key) const {
		const Foundation::Color ink = getContext()->getTheme().get(atlas::tokens::palette::ink);
		for (const Label& label : labels) {
			const float top = -label.size * 0.62F;
			if (label.angle != 0.0F) {
				Primitives::PushTransform(
					glm::rotate(
						glm::translate(glm::mat4(1.0F), glm::vec3(label.centre.x, label.centre.y, 0.0F)),
						label.angle,
						glm::vec3(0.0F, 0.0F, 1.0F)
					)
				);
			} else {
				Primitives::PushTransform(glm::translate(glm::mat4(1.0F), glm::vec3(label.centre.x, label.centre.y, 0.0F)));
			}
			if (label.shield) {
				const float							  half = label.width * 0.5F;
				const float							  tall = style::kShieldHalf;
				const std::array<Foundation::Vec2, 5> shield{{
					{-half, -tall},
					{half, -tall},
					{half, tall * 0.25F},
					{0.0F, tall},
					{-half, tall * 0.25F},
				}};
				Primitives::drawPolygon({
					.vertices = shield,
					.style = {.fill = Foundation::Color::white(), .border = Foundation::LineStyle{.color = ink, .width = 1.2F}},
					.key = key,
				});
				atlas::print({
					.text = label.text,
					.position = {-half, -tall * 0.25F + top * 0.8F},
					.face = fonts::kDisplayBold,
					.size = label.size * 0.8F,
					.color = ink,
					.align = Foundation::HorizontalAlign::Center,
					.boxWidth = label.width,
					.key = key,
				});
			} else {
				atlas::print({
					.text = label.text,
					.position = {-label.width * 0.5F, top},
					.face = label.body ? fonts::kBody : fonts::kDisplayBold,
					.size = label.size,
					.color = label.ink,
					.letterSpacing = label.letterSpacing,
					.align = Foundation::HorizontalAlign::Center,
					.boxWidth = label.width,
					.halo = atlas::paperHalo(label.halo),
					.key = key,
				});
			}
			Primitives::PopTransform();
		}
	}

	void MapView::handlePointer(ui::PointerEvent& event) {
		if (event.type != ui::PointerEvent::Type::Click) {
			return;
		}
		std::optional<int> hit;
		float			   nearest = style::kPickRadius;
		for (const Marker& marker : markers) {
			const float distance = std::hypot(marker.at.x - event.local.x, marker.at.y - event.local.y);
			if (distance <= nearest) {
				nearest = distance;
				hit = marker.poi;
			}
		}
		event.consume();
		if (onPick) {
			onPick(hit);
		}
	}

} // namespace game
