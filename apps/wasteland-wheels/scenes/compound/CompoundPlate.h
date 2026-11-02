#pragma once

// The compound plate (UI Art Direction, Components, Plates, and open question 2): the yard from above, drawn as vector
// from the buildings the campaign holds, so a building appears the day it's built. Packed dirt, the scrap fence with the
// gate on the east and the road leaving it, the water tank, the rig and the bike, and each building: a corrugated roof
// with its shadow to the south-east when it stands, string over the rust hatch when it doesn't. Each is labelled as the
// map labels its places, a circled number and its name with its state beneath, and is a hit target over its plot; the
// chosen one carries the grease-pencil loop. Geometry is the canvas mock's 920 by 760 plate, fitted whole and centred.

#include <rules/campaign/Campaign.h>

#include <ui/components/Control.h>

#include <array>
#include <cstdint>
#include <functional>
#include <optional>
#include <string_view>
#include <vector>

namespace game {

	using rules::campaign::Building;

	inline constexpr std::array<Building, 6> kBuildings{
		Building::Bunkhouse,
		Building::RadioMast,
		Building::Infirmary,
		Building::MapRoom,
		Building::Garage,
		Building::Stores,
	};

	// What the compound calls a building and says it's for (Compound and Supply Runs, Buildings).
	[[nodiscard]] std::string_view buildingName(Building building);
	[[nodiscard]] std::string_view buildingDescription(Building building);
	// Its number on the plate and in its box, 1 to 6 in the campaign's order.
	[[nodiscard]] int buildingNumber(Building building);
	// Its id in the ui: "plot_bunkhouse".
	[[nodiscard]] std::string plotId(Building building);

	class CompoundPlate : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			std::vector<Building>		  built;
			Building					  selected = Building::Bunkhouse;
			uint32_t					  seed = 0; // the campaign's, for the loop's wobble with the building
			std::function<void(Building)> onChoose;
		};

		explicit CompoundPlate(const Args& args);

		[[nodiscard]] const char* typeName() const override { return "CompoundPlate"; }
		// The frame's outer rule, 4 px outside the box.
		[[nodiscard]] float inkExtent() const override { return 5.0F; }
		void				describe(nlohmann::json& node) const override;

		// Where the canvas's plate lands in the box: its scale and its top left.
		struct Fit {
			float			 scale = 1.0F;
			Foundation::Vec2 origin{0.0F, 0.0F};
		};
		[[nodiscard]] static Fit fitIn(Foundation::Vec2 box);

	  protected:
		void onMount() override;
		void render() override;

	  private:
		void place();

		std::vector<Building>			  built;
		Building						  selected;
		uint32_t						  seed;
		std::function<void(Building)>	  onChoose;
		std::vector<ui::Ref<ui::Control>> spots;
	};

} // namespace game
