#include "JsonReader.h"

#include "ContentError.h"

#include <fstream>
#include <limits>

namespace rules {

	JsonReader::JsonReader(const nlohmann::json& object, std::string where)
		: object(&object),
		  location(std::move(where)) {
		if (!object.is_object()) {
			fail("must be an object");
		}
	}

	bool JsonReader::has(std::string_view key) const {
		return object->find(key) != object->end();
	}

	const nlohmann::json* JsonReader::find(std::string_view key) {
		const auto field = object->find(key);
		if (field == object->end()) {
			return nullptr;
		}
		read.emplace(key);
		return &*field;
	}

	const nlohmann::json& JsonReader::require(std::string_view key) {
		const nlohmann::json* field = find(key);
		if (field == nullptr) {
			failAt(key, "is required");
		}
		return *field;
	}

	int JsonReader::requireInt(std::string_view key) {
		const nlohmann::json& field = require(key);
		if (!field.is_number_integer()) {
			failAt(key, "must be a whole number");
		}
		const auto value = field.get<int64_t>();
		if (value < std::numeric_limits<int>::min() || value > std::numeric_limits<int>::max()) {
			failAt(key, "is out of range");
		}
		return static_cast<int>(value);
	}

	std::optional<int> JsonReader::optionalInt(std::string_view key) {
		if (!has(key)) {
			return std::nullopt;
		}
		return requireInt(key);
	}

	double JsonReader::requireNumber(std::string_view key) {
		const nlohmann::json& field = require(key);
		if (!field.is_number()) {
			failAt(key, "must be a number");
		}
		return field.get<double>();
	}

	bool JsonReader::requireBool(std::string_view key) {
		const nlohmann::json& field = require(key);
		if (!field.is_boolean()) {
			failAt(key, "must be true or false");
		}
		return field.get<bool>();
	}

	bool JsonReader::optionalBool(std::string_view key) {
		return has(key) && requireBool(key);
	}

	std::string JsonReader::requireString(std::string_view key) {
		const nlohmann::json& field = require(key);
		if (!field.is_string()) {
			failAt(key, "must be a string");
		}
		return field.get<std::string>();
	}

	std::optional<std::string> JsonReader::optionalString(std::string_view key) {
		if (!has(key)) {
			return std::nullopt;
		}
		return requireString(key);
	}

	std::vector<std::string> JsonReader::requireStrings(std::string_view key) {
		const nlohmann::json& field = require(key);
		if (!field.is_array()) {
			failAt(key, "must be an array of strings");
		}
		std::vector<std::string> strings;
		strings.reserve(field.size());
		for (const nlohmann::json& item : field) {
			if (!item.is_string()) {
				failAt(key, "must be an array of strings");
			}
			strings.push_back(item.get<std::string>());
		}
		return strings;
	}

	JsonReader JsonReader::requireObject(std::string_view key) {
		return {require(key), location + "." + std::string(key)};
	}

	std::optional<JsonReader> JsonReader::optionalObject(std::string_view key) {
		if (!has(key)) {
			return std::nullopt;
		}
		return requireObject(key);
	}

	std::vector<JsonReader> JsonReader::requireObjects(std::string_view key) {
		const nlohmann::json& field = require(key);
		if (!field.is_array()) {
			failAt(key, "must be an array");
		}
		std::vector<JsonReader> readers;
		readers.reserve(field.size());
		for (size_t index = 0; index < field.size(); ++index) {
			readers.emplace_back(field[index], location + "." + std::string(key) + "[" + std::to_string(index) + "]");
		}
		return readers;
	}

	std::vector<std::pair<std::string, JsonReader>> JsonReader::requireEntries(std::string_view key) {
		const nlohmann::json& field = require(key);
		if (!field.is_object()) {
			failAt(key, "must be an object");
		}
		std::vector<std::pair<std::string, JsonReader>> entries;
		for (const auto& [name, value] : field.items()) {
			entries.emplace_back(name, JsonReader(value, location + "." + std::string(key) + "." + name));
		}
		return entries;
	}

	const nlohmann::json& JsonReader::requireValue(std::string_view key) {
		return require(key);
	}

	void JsonReader::finish() const {
		std::string unknown;
		for (const auto& [key, value] : object->items()) {
			if (!read.contains(key)) {
				unknown += unknown.empty() ? "" : ", ";
				unknown += key;
			}
		}
		if (!unknown.empty()) {
			fail("has fields nothing reads: " + unknown);
		}
	}

	void JsonReader::fail(std::string_view message) const {
		throw ContentError(location + " " + std::string(message));
	}

	void JsonReader::failAt(std::string_view key, std::string_view message) const {
		throw ContentError(location + "." + std::string(key) + " " + std::string(message));
	}

	nlohmann::json readJsonFile(const std::filesystem::path& file) {
		std::ifstream stream(file, std::ios::binary);
		if (!stream) {
			throw ContentError(file.generic_string() + " can't be read");
		}
		try {
			return nlohmann::json::parse(stream);
		} catch (const nlohmann::json::exception& error) {
			// Not only parse_error: a number too big for a double, 1e999, is out_of_range.
			throw ContentError(file.generic_string() + " isn't valid JSON: " + error.what());
		}
	}

} // namespace rules
