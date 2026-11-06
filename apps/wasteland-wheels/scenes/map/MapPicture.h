#pragma once

// A made map's land, baked once for the session on a thread of its own and uploaded on the frame that first draws it
// after (area-map-atlas-style.md, The bake). The session's map holds it, so the area map and the run route draw the
// same texture and nothing bakes twice. Until the bake is in, the view draws its paper and everything live.

#include "scenes/map/LandBake.h"

#include <Texture.h>
#include <rules/map/AreaMapPipeline.h>

#include <atomic>
#include <chrono>
#include <optional>
#include <thread>

namespace game {

	class MapPicture {
	  public:
		// Starts the bake. The map outlives it, and needs its terrain, water, hazards, and places.
		explicit MapPicture(const rules::map::AreaMap& map);

		MapPicture(const MapPicture&) = delete;
		MapPicture& operator=(const MapPicture&) = delete;
		MapPicture(MapPicture&&) = delete;
		MapPicture& operator=(MapPicture&&) = delete;
		// Stops a bake still running at its next row, and waits for it.
		~MapPicture() = default;

		[[nodiscard]] bool baked() const { return done.load(std::memory_order_acquire); }
		// How long the bake took, once it's in.
		[[nodiscard]] std::chrono::milliseconds bakeTime() const { return took; }
		// The land's texture, uploaded on the first call once the bake is in; an invalid handle until then. On the frame.
		[[nodiscard]] Renderer::TextureHandle land();

	  private:
		rules::map::Ground				 ground;
		const rules::map::AreaMap&		 area;
		Texels							 texels;
		std::chrono::milliseconds		 took{0};
		std::atomic<bool>				 done{false};
		std::optional<Renderer::Texture> texture;
		// Last, so it starts once everything it writes to is made, and stops before any of it goes.
		std::jthread worker;
	};

} // namespace game
