#pragma once

#include <stdexcept>

namespace rules {

	// Pack content or a save that doesn't load: bad JSON, a missing, unknown or mistyped field, or a reference to
	// nothing. Thrown while packs or a save load, never once play has started, and the message names the file or
	// the path in the save.
	class ContentError : public std::runtime_error {
	  public:
		using std::runtime_error::runtime_error;
	};

} // namespace rules
