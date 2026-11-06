#pragma once

#include "scenes/GameScene.h"
#include "scenes/map/Planning.h"

#include <optional>
#include <string>

namespace game {

	class MapView;
	class RouteCard;

	struct RunRouteArgs {
		// The destination, by its POI.
		int poi{0};
	};

	// The run route (Game Flow 3.4; area-map-route-pick.md, The run route screen), a step under the area map, pushed over
	// it so Back finds the area map as it was: the map cropped to the destination's routes, banded, the picked one wide
	// with its stops; the destination's box, a card per route, its stops in order, the time it'd be home against dark, and
	// Load out the crew, which goes to load out on the picked route. The quickest route the stores can fuel is picked as
	// it opens.
	class RunRouteScene final : public GameScene<RunRouteArgs> {
	  public:
		explicit RunRouteScene(RunRouteArgs args);

		const char* name() const override { return "run_route"; }
		std::string exportState() const override;

	  protected:
		const ui::Theme& sceneTheme() const override;
		void			 enter() override;

	  private:
		void build();
		void pickRoute(int index);
		void fillStops();
		void fillFoot();
		// Why the crew can't load out on the picked route, or none.
		[[nodiscard]] std::optional<std::string>	loadOutBlocker() const;
		[[nodiscard]] const rules::map::RouteOffer& pickedOffer() const;

		int								poi;
		Planning						planned;
		const Destination*				destination = nullptr;
		int								picked = 0;
		ui::Ref<MapView>				map;
		std::vector<ui::Ref<RouteCard>> cards;
		ui::Ref<ui::Component>			stopsBox;
		ui::Ref<ui::Component>			stopsBody;
		ui::Ref<ui::Text>				homeLine;
		ui::Ref<ui::Component>			loadOut;
		ui::Ref<ui::Text>				loadOutReason;
	};

} // namespace game
