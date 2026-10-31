#pragma once

#include <random/HashNoise.h>
#include <random/Rng.h>

#include <cstdint>
#include <string_view>

namespace rules::map {

	// One noise layer: salal's hashed gradient noise, seeded by a fork of the stage's stream, so a layer
	// takes no draws and a feature's layer never moves another's. Values lie in about (-1, 1), features
	// about one lattice unit across: scale world units by the layer's frequency first. Single precision,
	// plain arithmetic, the same bits on every platform.
	class NoiseLayer {
	  public:
		NoiseLayer(const foundation::Rng& stream, std::string_view feature)
			: seed(stream.fork(feature).seed()) {}

		[[nodiscard]] double sample(double x, double y) const {
			return foundation::gradientNoise2(static_cast<float>(x), static_cast<float>(y), seed);
		}

		// `octaves` layers, each at twice the last one's frequency and `gain` times its amplitude, over the
		// amplitudes' total.
		[[nodiscard]] double fractal(double x, double y, int octaves, float gain) const {
			return foundation::fractalNoise2(static_cast<float>(x), static_cast<float>(y), seed, octaves, 2.0F, gain);
		}

	  private:
		uint32_t seed;
	};

} // namespace rules::map
