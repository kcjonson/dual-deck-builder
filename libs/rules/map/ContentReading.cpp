#include "ContentReading.h"

#include <string>

namespace rules::map {

	namespace {

		std::string written(double value) {
			std::string text = std::to_string(value);
			text.erase(text.find_last_not_of('0') + 1);
			if (text.back() == '.') {
				text.pop_back();
			}
			return text;
		}

	} // namespace

	double readAtLeast(JsonReader& reader, std::string_view key, double least) {
		const double value = reader.requireNumber(key);
		if (!(value >= least)) {
			reader.failAt(key, "must be at least " + written(least));
		}
		return value;
	}

	int readIntAtLeast(JsonReader& reader, std::string_view key, int least) {
		const int value = reader.requireInt(key);
		if (value < least) {
			reader.failAt(key, "must be at least " + std::to_string(least));
		}
		return value;
	}

	double readShare(JsonReader& reader, std::string_view key) {
		const double value = reader.requireNumber(key);
		if (!(value >= 0 && value <= 1)) {
			reader.failAt(key, "must be a share from 0 to 1");
		}
		return value;
	}

	IntRange readIntRange(JsonReader& reader, std::string_view key, int least) {
		JsonReader	   range = reader.requireObject(key);
		const IntRange read{.min = readIntAtLeast(range, "min", least), .max = range.requireInt("max")};
		if (read.max < read.min) {
			range.failAt("max", "must be at least min");
		}
		range.finish();
		return read;
	}

} // namespace rules::map
