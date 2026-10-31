#pragma once

#include <algorithm>
#include <functional>
#include <utility>
#include <vector>

namespace rules::map {

	// A min-heap of nodes by key, ties to the lower node, so the order nodes come off it never hangs on the heap's
	// own layout or the standard library's: what the roads', the route tree's, and the rails' searches share. Cleared
	// between searches, it keeps its storage.
	class NodeHeap {
	  public:
		[[nodiscard]] bool empty() const { return entries.empty(); }

		void clear() { entries.clear(); }

		void push(double key, int node) {
			entries.emplace_back(key, node);
			std::ranges::push_heap(entries, std::greater<>{});
		}

		// The least key's entry, taken off.
		std::pair<double, int> pop() {
			std::ranges::pop_heap(entries, std::greater<>{});
			const std::pair<double, int> top = entries.back();
			entries.pop_back();
			return top;
		}

	  private:
		std::vector<std::pair<double, int>> entries;
	};

} // namespace rules::map
