#pragma once

// The closed atlas on the splash's table (UI Art Direction, Screens: Launch splash): the W2 cover sheet with its
// neatline, the spine's shadow down the left, and the page edges stepping out along the right and bottom (art/cover-spine
// and art/cover-edges), the logo between "A road atlas of the Halcyon region" and "fourth edition, revised after", and
// the sheet's drop shadow. As wide as its box, the mock's 820 by 560 cover in proportion; the page edges run past it.

#include <ui/Component.h>

#include <optional>

namespace game {

	class ClosedAtlas : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
		};

		explicit ClosedAtlas(const Args& /*args*/) {}

		// The cover's height at `width`.
		[[nodiscard]] static float heightFor(float width);

		[[nodiscard]] const char* typeName() const override { return "ClosedAtlas"; }
		[[nodiscard]] float		  inkExtent() const override;

	  protected:
		void										  onMount() override;
		void										  render() override;
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;
	};

} // namespace game
