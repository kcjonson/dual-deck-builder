#pragma once

#include <random/Rng.h>

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace rules {

	// The randomness a fight or a campaign carries, as plain values, so the state holding it copies freely:
	// a preview, a projection, or an AI's lookahead plays on a copy and draws what the real one would.
	//
	// foundation::Rng can't be copied (a copy would replay its stream), so nothing holds one. Each random
	// event gets its own Rng instead, forked from the root seed by the stream's name and how many events
	// that stream has had. Streams are independent: drawing on one never moves another.
	class RandomStreams {
	  public:
		explicit RandomStreams(uint32_t seed);

		[[nodiscard]] uint32_t seed() const { return rootSeed; }

		// A fresh Rng for the next event on `stream`, to draw as much as that one event needs: a shuffle,
		// a hit check, an AI's pick. The stream moves on by one event however much is drawn.
		[[nodiscard]] foundation::Rng next(std::string_view stream);

		// How many events `stream` has had.
		[[nodiscard]] uint32_t eventsOn(std::string_view stream) const;

		bool operator==(const RandomStreams&) const = default;

	  private:
		struct Counter {
			std::string stream;
			uint32_t	events{0};

			bool operator==(const Counter&) const = default;
		};

		uint32_t rootSeed;
		// Sorted by stream, so two that have had the same events compare equal.
		std::vector<Counter> counters;
	};

} // namespace rules
