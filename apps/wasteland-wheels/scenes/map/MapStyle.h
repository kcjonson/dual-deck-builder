#pragma once

// How the area map is drawn (area-map-atlas-style.md, its visual calls): the land bake's palette and the live layers'
// colours and sizes, in one place. Bake colours are 0 to 255 a channel; live sizes are screen px at any zoom.

#include <graphics/Color.h>

#include <array>

namespace game::mapstyle {

	using Rgb8 = std::array<float, 3>;

	[[nodiscard]] constexpr Foundation::Color rgb(Rgb8 colour, float alpha = 1.0F) {
		return {colour[0] / 255.0F, colour[1] / 255.0F, colour[2] / 255.0F, alpha};
	}

	// The atlas's paper: the view's ground past the disc, what the land fades to at the rim, and the labels' halo.
	inline constexpr Rgb8 kPaper{244, 241, 233};
	inline constexpr Rgb8 kInk{44, 41, 37};
	// The fog's dark, which a label found in it is haloed in too.
	inline constexpr Rgb8 kFogDark{36, 39, 46};

	// The land: buff, pale khaki, and sage by moisture, warming to grey-brown in high country, tinted rust by contamination.
	inline constexpr Rgb8	kLandDry{235, 229, 207};
	inline constexpr Rgb8	kLandMiddling{229, 228, 209};
	inline constexpr Rgb8	kLandWet{214, 221, 199};
	inline constexpr Rgb8	kLandHigh{212, 204, 188};
	inline constexpr double kHighFrom = 0.15;
	inline constexpr double kHighTo = 0.6;
	inline constexpr Rgb8	kLandToxic{226, 202, 172};
	inline constexpr double kToxicWeight = 0.35;

	// Hill shade, lit from the north-west: tanh(slope * gain), relief `low` on flat country to `high` in the ranges
	// (elevation `from` to `to`), the lit side at `light` of the shadow side.
	struct HillShade {
		double gain = 140;
		double low = 0.16;
		double high = 0.4;
		double from = 0.08;
		double to = 0.45;
		double light = 0.4;
	};
	inline constexpr HillShade kHillShade{};

	inline constexpr Rgb8	kCliff{128, 116, 102};
	inline constexpr double kCliffWeight = 0.32;
	inline constexpr Rgb8	kLake{176, 205, 226};
	inline constexpr Rgb8	kShore{112, 152, 192};

	// Craters: a dark rim `rim` of the radius wide, a lighter floor, a dark core `core` across; each plume's edge a dashed
	// rust ring, `dash` world units of dash and gap.
	inline constexpr Rgb8	kCraterRim{112, 106, 98};
	inline constexpr Rgb8	kCraterFloor{168, 162, 150};
	inline constexpr Rgb8	kCraterCore{118, 110, 100};
	inline constexpr double kCraterRimShare = 0.16;
	inline constexpr double kCraterCoreShare = 0.32;
	inline constexpr Rgb8	kPlumeRing{186, 120, 96};
	inline constexpr double kPlumeRingWeight = 0.7;
	inline constexpr double kPlumeRingDash = 9;
	inline constexpr double kPlumeRingHalfWidth = 0.75; // texels

	// The land's own contamination hatched: rust lines `spacing` world units apart, `width` wide, from none at `from` to
	// `weight` at `to`.
	struct Hatch {
		Rgb8   colour{186, 122, 78};
		double spacing = 12;
		double width = 1.4;
		double from = 0.4;
		double to = 0.95;
		double weight = 0.28;
	};
	inline constexpr Hatch kToxicHatch{};
	// The dressing's crater plumes hatched: its own spacing and direction, from `weight` at the rim to none at the edge.
	inline constexpr Rgb8	kPlumeHatch{176, 104, 70};
	inline constexpr double kPlumeHatchWidth = 1.2;
	inline constexpr double kPlumeHatchWeight = 0.34;

	// Mire's stipple, a dot to a texel at this weight.
	inline constexpr Rgb8	kStipple{92, 110, 88};
	inline constexpr double kStippleWeight = 0.55;

	// Built-up land: a pale brick fill inside a ragged edge round each ruin (`ragged` of its radius in and out); the
	// dressing's blocks on it, standing ones darker, rubble halfway, each inset from its square by `street` of its side
	// either way so the streets show between.
	inline constexpr Rgb8	kBuiltUp{229, 212, 204};
	inline constexpr Rgb8	kBlock{206, 182, 172};
	inline constexpr double kRubbleWeight = 0.45;
	inline constexpr double kRagged = 0.18;
	inline constexpr double kStreetShare = 0.17;

	// The rim: the land fades toward paper over its last `fade` of the radius, up to `fadeWeight`, and a dashed grey line,
	// `dash` world units of dash and gap, `lineInset` texels inside the edge.
	inline constexpr double kRimFade = 0.025;
	inline constexpr double kRimFadeWeight = 0.45;
	inline constexpr Rgb8	kRimLine{150, 146, 136};
	inline constexpr double kRimLineWeight = 0.85;
	inline constexpr double kRimDash = 12;
	inline constexpr double kRimLineInset = 1.5;

	// The land fog: a dark wash over hidden land, the terrain faint beneath it.
	inline constexpr float kFogAlpha = 0.82F;
	inline constexpr int   kFogTexelsPerCell = 4;

	// Rivers: their world width, never under `minPixels`, rounded to `widthStep` world units so a river draws as a few
	// runs of one width each; faint past the rim.
	inline constexpr Rgb8  kRiver{122, 166, 203};
	inline constexpr float kRiverOutside = 0.45F;
	inline constexpr float kRiverMinPixels = 1.0F;
	inline constexpr float kRiverWidthStep = 0.75F;

	// Rail lines: an ink line with paper dashes along it.
	inline constexpr Rgb8  kRail{70, 64, 56};
	inline constexpr float kRailWidth = 2.4F;
	inline constexpr float kRailTieWidth = 1.0F;
	inline constexpr float kRailDash = 5.0F;

	struct RoadStyle {
		Foundation::Color fill;
		float			  width = 1.0F;
		Foundation::Color casing; // alpha 0: none
		float			  casingWidth = 0.0F;
		float			  dash = 0.0F; // 0: solid
		float			  gap = 0.0F;
	};

	// By RoadClass: highways an orange-red fill in a dark casing, back roads thin grey on a pale edge, trails dashed.
	inline constexpr std::array<RoadStyle, 3> kRoads{{
		{.fill = rgb({216, 96, 54}), .width = 2.4F, .casing = rgb({104, 44, 30}), .casingWidth = 4.2F},
		{.fill = rgb({118, 114, 106}), .width = 1.1F, .casing = rgb({251, 249, 242}), .casingWidth = 2.7F},
		{.fill = rgb({128, 116, 100}), .width = 1.1F, .dash = 4.0F, .gap = 3.0F},
	}};

	// Roads thicken gently with zoom: by (zoom / reference)^power, held to [min, max].
	inline constexpr float kRoadZoomReference = 0.5F;
	inline constexpr float kRoadZoomPower = 0.4F;
	inline constexpr float kRoadZoomMin = 0.8F;
	inline constexpr float kRoadZoomMax = 1.8F;

	// A rumored road: its fill and casing mixed this far toward paper, opaque.
	inline constexpr float kRumoredFade = 0.5F;
	// An uncharted stub: dashes in its class's fill from where it leaves known road, fading out over `length` world units.
	inline constexpr double kStubLength = 140;
	inline constexpr float	kStubDash = 7.0F;
	inline constexpr float	kStubGap = 5.0F;

	// Bridges and passes from this zoom in, screen px a world unit.
	inline constexpr float kDetailZoom = 0.3F;
	inline constexpr Rgb8  kBridge{70, 64, 56};
	inline constexpr float kBridgeGap = 1.0F;
	inline constexpr float kBridgeFlare = 2.5F;
	inline constexpr float kBrokenGap = 9.0F;
	inline constexpr Rgb8  kBrokenCross{186, 38, 28};
	inline constexpr float kBrokenCrossHalf = 4.0F;
	inline constexpr float kPassHalf = 4.0F;
	inline constexpr float kPassRise = 3.5F;
	inline constexpr Rgb8  kDam{62, 66, 74};
	inline constexpr float kDamLength = 9.0F;
	inline constexpr float kDamWidth = 2.5F;

	// Home: a five-pointed star in ink on a paper halo.
	inline constexpr float kHomeOuter = 8.0F;
	inline constexpr float kHomeInner = 3.3F;
	inline constexpr float kHomeHalo = 2.7F;

	// POIs as circled letters, strongholds as red diamonds on a paper edge.
	inline constexpr float kMarkerRadius = 7.0F;
	inline constexpr Rgb8  kSpent{153, 148, 138};
	inline constexpr float kStrikeShare = 0.72F;
	inline constexpr float kStrongholdHalf = 7.5F;
	inline constexpr float kStrongholdEdge = 2.25F;
	inline constexpr float kPickRadius = 14.0F;
	inline constexpr Rgb8  kNight{38, 46, 92};
	inline constexpr float kNightWidth = 2.5F;
	inline constexpr float kNightGap = 1.5F;
	// The grease-pencil loop round the chosen marker.
	inline constexpr float kLoopRadius = 13.0F;
	inline constexpr float kLoopWidth = 2.2F;

	// A POI's routes on the run route view, as highlighter bands under the roads: the picked one wide, the others a
	// paler swipe a little narrower. Opaque, so the joints don't bead.
	inline constexpr float kPickedBand = 12.0F;
	inline constexpr float kOtherBand = 9.0F;
	inline constexpr float kOtherBandFade = 0.55F; // toward paper
	inline constexpr float kStopHalf = 4.5F;

	struct LabelStyle {
		float size = 13.0F;
		float letterSpacing = 0.0F; // em
		bool  capitals = false;
		bool  body = false; // the body face, else display bold
	};
	inline constexpr LabelStyle kMetroLabel{.size = 17.0F, .letterSpacing = 0.16F, .capitals = true};
	inline constexpr LabelStyle kTownLabel{.size = 14.0F};
	inline constexpr LabelStyle kVillageLabel{.size = 10.5F, .body = true};
	inline constexpr LabelStyle kPoiLabel{.size = 13.0F};
	inline constexpr LabelStyle kFeatureLabel{.size = 12.0F, .letterSpacing = 0.08F, .body = true};
	inline constexpr Rgb8		kVillageInk{82, 77, 70};
	inline constexpr Rgb8		kWaterInk{62, 111, 152};
	inline constexpr Rgb8		kStrongholdInk{140, 32, 26};
	// Between a symbol's edge and its label, and kept clear round each label's box, screen px; a box is this share of
	// the size tall.
	inline constexpr float kLabelGap = 4.0F;
	inline constexpr float kLabelPad = 1.5F;
	inline constexpr float kLineHeight = 1.25F;
	inline constexpr float kShieldHalf = 7.5F;

	// The run route's frame takes in at least this many world units each way; the area map's at least this share of the
	// radius round what's revealed.
	inline constexpr double kRouteFrameMin = 800;
	inline constexpr double kFrameMargin = 0.06;

} // namespace game::mapstyle
