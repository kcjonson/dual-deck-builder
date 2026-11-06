#pragma once

// The atlas's gauges (UI Art Direction, Components). The scale bar is for stores and other countable supplies: segments
// in a 1.2 px ink frame, alternating ink and paper as a map's scale does, or, given a value, filled from the left as a
// count. The cased bar is for continuous values: a road drawn as the map draws one, the driver's colour on its casing,
// filled to the value over a paper track. Each is 8 or 12 px tall by default and as wide as its box. Decoration.

#include <ui/Component.h>

#include <cstdint>
#include <optional>

namespace game::atlas {

	// Ink fills in ink in an ink frame; Highway fills in Highway in a Casing frame, as the splash's loader does.
	enum class ScaleTone : uint8_t { Ink, Highway };

	class ScaleBar : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			int					 segments = 5;
			std::optional<float> value; // none: the map's scale; 0 to 1: that share of the segments filled
			ScaleTone			 tone = ScaleTone::Ink;
			float				 frame = 1.2F;
		};

		explicit ScaleBar(const Args& args);

		[[nodiscard]] int				   segments() const { return segmentCount; }
		[[nodiscard]] std::optional<float> value() const { return amount; }
		void							   setValue(std::optional<float> value);
		// Whether segment `index` is drawn in the fill rather than paper: every other one for a scale.
		[[nodiscard]] bool isFilled(int index) const;
		[[nodiscard]] int  filledCount() const;

		[[nodiscard]] const char* typeName() const override { return "ScaleBar"; }
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void										  render() override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::None; }
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;

	  private:
		int					 segmentCount;
		std::optional<float> amount;
		ScaleTone			 tone;
		float				 frameWidth;
	};

	class CasedBar : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			float value = 1.0F; // 0 to 1
			int	  seat = 0;		// driver A's Highway on Casing, or driver B's Route teal on its casing
		};

		explicit CasedBar(const Args& args);

		[[nodiscard]] float value() const { return amount; }
		void				setValue(float value);
		// The casing on each side, and the fill's width in the track, in px at the bar's laid-out size.
		[[nodiscard]] float casingWidth() const;
		[[nodiscard]] float fillWidth() const;

		[[nodiscard]] const char* typeName() const override { return "CasedBar"; }
		void					  describe(nlohmann::json& node) const override;

	  protected:
		void										  render() override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::None; }
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;

	  private:
		float amount;
		int	  seat;
	};

} // namespace game::atlas
