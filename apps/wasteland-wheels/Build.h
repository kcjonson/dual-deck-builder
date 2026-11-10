#pragma once

// The build's line, under the splash's loader, at the foot of the menu, and in --check's output and the log: a playtest
// build's "BUILD 212 - 2f8d7a7" (playtest-distribution.md), the number and commit the download page shows, from
// -DDDB_BUILD_NUMBER and -DDDB_BUILD_SHA; otherwise a development build says so, and a Release without them is the
// early alpha. Already in capitals, since a transform would capitalise the commit too.

namespace game {

	[[nodiscard]] const char* buildLine();

} // namespace game
