#pragma once

// What the credits list, all of it from the repository: the licence in LICENSE, the commit authors, the bundled faces
// with the copyright lines and licences their files carry (fonts/*-OFL.txt), and what the game is built with. A face
// bundled without an entry fails the credits' test.

#include <string>
#include <vector>

namespace game {

	struct CreditEntry {
		std::string				 name;
		std::vector<std::string> lines;
		std::string				 asset; // a bundled face's file stem under fonts/, whose licence ships beside it; none otherwise
	};

	struct CreditSection {
		std::string				 heading;
		std::vector<CreditEntry> entries;
	};

	[[nodiscard]] const std::vector<CreditSection>& credits();

} // namespace game
