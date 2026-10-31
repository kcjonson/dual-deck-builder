#pragma once

#include "MapLabels.h"
#include "Polyline.h"

#include <span>
#include <vector>

namespace rules::map {

	// A label's size as the view sets it: world units at the zoom it draws at, since the rules know no font.
	struct LabelSize {
		// Half its length along its baseline or its path, and half its height.
		double halfLength{0};
		double halfHeight{0};
		// How far a point label's box stands off its anchor: at 0 it's set on the anchor, and past 0 beside it, right,
		// left, above, or below, tried in that order.
		double offset{0};
	};

	struct LabelBox {
		double minX{0};
		double minY{0};
		double maxX{0};
		double maxY{0};
	};

	// Where a label was set: a point label's box, or the stretch of its path a line label is set along, which it takes
	// half its height either side of.
	struct PlacedLabel {
		// Its index among the labels laid out.
		int label{0};
		// A point label's box, or the box round a line label's stretch and its height.
		LabelBox		   box;
		std::vector<Point> path;
		double			   halfHeight{0};
	};

	struct LabelLayoutArgs {
		// Highest priority first, as mapLabels gives them.
		std::span<const MapLabel> labels;
		// One for each label.
		std::span<const LabelSize> sizes;
		// What the view keeps clear of labels, its markers.
		std::span<const LabelBox> blocked;
		// World units kept between any two.
		double pad{0};
	};

	// Whether two placed labels come within `pad` of each other.
	[[nodiscard]] bool labelsMeet(const PlacedLabel& a, const PlacedLabel& b, double pad);

	// Sets the labels in order, each in the first of its spots clear of everything set before it and of `blocked` by
	// `pad`, and drops one with no clear spot rather than overlap (Area Map Generation, 11. Dressing, Labels). A line
	// label is set along the middle of its path, and dropped where it's longer than the path.
	[[nodiscard]] std::vector<PlacedLabel> placeLabels(const LabelLayoutArgs& args);

} // namespace rules::map
