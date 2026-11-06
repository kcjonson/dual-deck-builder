#include "scenes/map/MapPicture.h"

#include <primitives/Primitives.h>
#include <utils/Log.h>

#include <stdexcept>

namespace game {

	namespace {

		rules::map::Ground groundOf(const rules::map::AreaMap& map) {
			if (!map.terrain || !map.water || !map.hazards || !map.places) {
				throw std::invalid_argument("MapPicture: the map has no land to bake");
			}
			return {*map.terrain, *map.water, *map.hazards};
		}

	} // namespace

	MapPicture::MapPicture(const rules::map::AreaMap& map)
		: ground(groundOf(map)),
		  area(map),
		  worker([this](std::stop_token stop) {
			  const auto started = std::chrono::steady_clock::now();
			  texels = bakeLand({
				  .ground = ground,
				  .places = *area.places,
				  .dressing = area.dressing ? &*area.dressing : nullptr,
				  .size = landBakeSize(ground.terrain().radius()),
				  .stop = stop,
			  });
			  took = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started);
			  done.store(true, std::memory_order_release);
		  }) {}

	Renderer::TextureHandle MapPicture::land() {
		if (texture) {
			return texture->handle();
		}
		if (!baked() || texels.size == 0) {
			return {};
		}
		texture = Renderer::Primitives::createTexture({
			.width = texels.size,
			.height = texels.size,
			.format = Renderer::TextureFormat::Rgba8,
			.linear = true,
			.pixels = texels.rgba.data(),
		});
		if (!texture->isValid()) {
			LOG_ERROR(Game, "The area map's land texture couldn't be made");
		}
		LOG_INFO(Game, "The area map's land baked at %d texels a side in %lld ms", texels.size, static_cast<long long>(took.count()));
		texels.rgba = {};
		return texture->handle();
	}

} // namespace game
