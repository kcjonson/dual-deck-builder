#include "RoadNetwork.h"

#include <cstddef>
#include <numeric>

namespace rules::map {

	int loopCount(size_t nodes, std::span<const RoadStretch> stretches) {
		std::vector<size_t> parent(nodes);
		std::iota(parent.begin(), parent.end(), size_t{0});
		const auto find = [&](size_t node) {
			size_t root = node;
			while (parent[root] != root) {
				root = parent[root];
			}
			while (parent[node] != root) {
				const size_t next = parent[node];
				parent[node] = root;
				node = next;
			}
			return root;
		};
		size_t pieces = nodes;
		for (const RoadStretch& stretch : stretches) {
			const size_t a = find(static_cast<size_t>(stretch.from));
			const size_t b = find(static_cast<size_t>(stretch.to));
			if (a != b) {
				parent[a] = b;
				pieces -= 1;
			}
		}
		return static_cast<int>(stretches.size()) - static_cast<int>(nodes) + static_cast<int>(pieces);
	}

} // namespace rules::map
