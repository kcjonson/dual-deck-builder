#include "Build.h"

#include "BuildStamp.h"

namespace game {

	const char* buildLine() {
		if (build::kStamp[0] != '\0') {
			return build::kStamp;
		}
#ifdef SALAL_DEV_SERVER
		return "DEVELOPMENT BUILD";
#else
		return "EARLY ALPHA";
#endif
	}

} // namespace game
