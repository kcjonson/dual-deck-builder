#pragma once

// The atlas cover on the main menu (UI Art Direction, Screens: Main menu): a worn relief map torn from the atlas, lying
// on the page at a slight turn with a drop shadow, the logo in a cartouche at its head ("A road atlas of the Halcyon
// region"), and the crew's two decks set down on its lower right. The map is a few cheap shapes in the area map's
// palette, a highway, back roads, a river and a lake, home's star and a hatched patch of contaminated ground, not a
// generated map. It fills its box; the torn sheet runs a little past it.

#include <ui/Component.h>

#include <vector>

namespace game {

	class MenuCover : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
		};

		explicit MenuCover(const Args& /*args*/) {}

		[[nodiscard]] const char* typeName() const override { return "MenuCover"; }
		[[nodiscard]] float		  inkExtent() const override;

	  protected:
		void onMount() override;
		void render() override;

	  private:
		// The cover's shapes mapped from its own space onto the box, again whenever the box's size changes.
		void place();

		Foundation::Vec2										   placedFor{-1.0F, -1.0F};
		std::vector<Foundation::Vec2>							   rim;
		std::vector<Foundation::Vec2>							   band; // the grime band: the rim's points, then their inner points
		std::vector<uint16_t>									   bandIndices;
		std::vector<Foundation::Color>							   bandColors;
		std::vector<std::vector<Foundation::Vec2>>				   relief;
		std::vector<std::vector<Foundation::Vec2>>				   contours;
		std::vector<Foundation::Vec2>							   toxic;
		std::vector<std::pair<Foundation::Vec2, Foundation::Vec2>> hatch;
		std::vector<Foundation::Vec2>							   lake;
		std::vector<Foundation::Vec2>							   river;
		std::vector<std::vector<Foundation::Vec2>>				   backRoads;
		std::vector<std::vector<Foundation::Vec2>>				   highways;
		Foundation::Vec2										   home{0.0F, 0.0F};
		Foundation::Vec2										   scaleAt{0.0F, 0.0F};
	};

} // namespace game
