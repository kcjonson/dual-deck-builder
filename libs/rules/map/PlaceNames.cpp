#include "PlaceNames.h"

#include <rules/core/JsonReader.h>

#include <cassert>
#include <utility>

namespace rules::map {

	namespace {

		// Draws for a name nobody has before settling for a numbered one.
		constexpr int kNameDraws = 64;

		std::vector<std::string> readWords(JsonReader& reader, std::string_view key) {
			std::vector<std::string> words = reader.requireStrings(key);
			if (words.empty()) {
				reader.failAt(key, "must list at least one word");
			}
			std::set<std::string> seen;
			for (const std::string& word : words) {
				if (word.empty()) {
					reader.failAt(key, "has an empty word");
				}
				if (!seen.insert(word).second) {
					reader.failAt(key, "lists \"" + word + "\" twice");
				}
			}
			return words;
		}

	} // namespace

	PlaceNamePool readPlaceNames(const std::filesystem::path& file) {
		const nlohmann::json json = readJsonFile(file);
		JsonReader			 reader(json, file.generic_string());
		PlaceNamePool		 pool{.starts = readWords(reader, "starts"), .endings = readWords(reader, "endings")};
		reader.finish();
		return pool;
	}

	PlaceNamer::PlaceNamer(const PlaceNamePool& pool, foundation::Rng&& rng, std::span<const std::string> taken)
		: pool(&pool),
		  rng(std::move(rng)) {
		assert(!pool.starts.empty() && !pool.endings.empty() && "PlaceNamer: a pool has words");
		for (const std::string& name : taken) {
			used.insert(name);
			for (size_t start = 0; start < pool.starts.size(); ++start) {
				if (name.starts_with(pool.starts[start])) {
					startsUsed.insert(start);
				}
			}
		}
	}

	std::string PlaceNamer::next() {
		std::vector<size_t> starts;
		for (size_t start = 0; start < pool->starts.size(); ++start) {
			if (!startsUsed.contains(start)) {
				starts.push_back(start);
			}
		}
		if (starts.empty()) {
			for (size_t start = 0; start < pool->starts.size(); ++start) {
				starts.push_back(start);
			}
		}
		std::string name;
		size_t		start = 0;
		for (int draw = 0; draw < kNameDraws; ++draw) {
			start = rng.pick(starts);
			name = pool->starts[start] + rng.pick(pool->endings);
			if (!used.contains(name)) {
				break;
			}
		}
		std::string numbered = name;
		for (int number = 2; used.contains(numbered); ++number) {
			numbered = name + " " + std::to_string(number);
		}
		used.insert(numbered);
		startsUsed.insert(start);
		return numbered;
	}

} // namespace rules::map
