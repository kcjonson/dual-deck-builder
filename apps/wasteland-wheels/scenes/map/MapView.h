#pragma once

// The area map drawn as a page of a road atlas (area-map-atlas-style.md; Area Map Generation, Rendering), framed as a
// plate: the land the session baked, then live over it rivers, rails, the fog of what's known, the routes' bands, the
// roads by what's known of them with their bridges, broken spans and passes, the POIs found and the strongholds, Home,
// and the labels, set by the rules' placeLabels. The area map fits it to what's been revealed; the run route to a
// destination's routes, the picked one banded wide with its stops.
//
// Everything in world units is turned into the box's px once a size, and the labels set once a size and a choice, so a
// frame only issues draws from what's kept. A click on a marker picks its POI; a click anywhere else picks none.

#include "scenes/map/Planning.h"

#include <graphics/Color.h>
#include <graphics/PrimitiveStyles.h>
#include <math/Types.h>
#include <rules/campaign/CampaignMap.h>
#include <rules/map/AreaMapPipeline.h>
#include <ui/Component.h>

#include <Texture.h>

#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace game {

	class MapPicture;

	class MapView : public ui::Component {
	  public:
		struct Args {
			UI_COMMON_ARGS
			// What it draws: the layers every session has, the whole map where the session made one, its baked land,
			// and what the scene planned from them. Each outlives the view.
			const rules::campaign::MapLayers* layers = nullptr;
			const rules::map::AreaMap*		  area = nullptr;
			MapPicture*						  picture = nullptr;
			const Planning*					  planning = nullptr;
			// Fitted to this destination's routes and banding them, the picked one wide; the revealed map when none.
			std::optional<int> routesOf;
			int				   picked = 0;
			std::optional<int> selected;
			// A click on a found POI's marker, or none off every marker.
			std::function<void(std::optional<int>)> onPick;
		};

		explicit MapView(const Args& args);

		void select(std::optional<int> poi);
		void pick(int route);

		// Where a POI's marker is, in the view's box, once it's been laid out; none for one it doesn't draw.
		[[nodiscard]] std::optional<Foundation::Vec2> markerAt(int poi) const;

		[[nodiscard]] const char* typeName() const override { return "MapView"; }
		// The plate's outer rule, 4 px outside the box.
		[[nodiscard]] float inkExtent() const override { return 5.0F; }
		[[nodiscard]] bool	handlesPointer() const override { return true; }
		void				describe(nlohmann::json& node) const override;

	  protected:
		void							render() override;
		void							handlePointer(ui::PointerEvent& event) override;
		[[nodiscard]] ui::PointerEvents defaultPointerEvents() const override { return ui::PointerEvents::Auto; }

	  private:
		struct Stroke {
			std::vector<Foundation::Vec2>		   points;
			float								   width = 1.0F;
			Foundation::Color					   color;
			std::optional<Foundation::DashPattern> dash;
			bool								   roundCaps = true;
		};

		struct Marker {
			int				 poi{0};
			Foundation::Vec2 at;
			std::string		 glyph;
			bool			 stronghold{false};
			bool			 cleared{false};
			bool			 night{false};
			// Found in land not revealed.
			bool fogged{false};
		};

		struct Label {
			std::string		  text;
			Foundation::Vec2  centre;
			float			  width{0};
			float			  angle{0}; // radians, screen space
			float			  size{13};
			float			  letterSpacing{0}; // px
			bool			  body{false};
			bool			  shield{false};
			Foundation::Color ink;
			Foundation::Color halo;
		};

		struct RouteStop {
			Foundation::Vec2 at;
			bool			 fight{false};
			bool			 known{true};
		};

		// World units to the box: the frame's centre at the box's, y up the world and down the box.
		[[nodiscard]] Foundation::Vec2 toBox(double x, double y) const;
		void						   frameIt();
		void						   rebuild();
		void						   buildRoads();
		void						   buildBands();
		void						   buildMarkers();
		void						   buildLabels();
		[[nodiscard]] float			   roadScale() const;
		[[nodiscard]] bool			   revealed(double x, double y) const;
		void						   drawStrokes(const std::vector<Stroke>& strokes, int32_t key) const;
		void						   drawMarkers(int32_t key) const;
		void						   drawLabels(int32_t key) const;
		void						   drawHome(int32_t key) const;
		void						   drawSelection(int32_t key) const;

		const rules::campaign::MapLayers*		layers;
		const rules::map::AreaMap*				area;
		MapPicture*								picture;
		const Planning*							planning;
		std::optional<int>						routesOf;
		int										picked;
		std::optional<int>						selected;
		std::function<void(std::optional<int>)> onPick;

		double							 radius{0};
		std::optional<Renderer::Texture> fogTexture;
		// The frame in world units, and the box it was laid into.
		double			 frameMinX{0};
		double			 frameMinY{0};
		double			 frameMaxX{0};
		double			 frameMaxY{0};
		double			 centreX{0};
		double			 centreY{0};
		double			 scale{0};
		Foundation::Vec2 builtFor{0.0F, 0.0F};
		// Drawn under the fog, then over it.
		std::vector<Stroke>	   underFog;
		std::vector<Stroke>	   bands;
		std::vector<Stroke>	   roads;
		std::vector<Stroke>	   overRoads;
		std::vector<Marker>	   markers;
		std::vector<RouteStop> stops;
		std::vector<Label>	   labels;
	};

} // namespace game
