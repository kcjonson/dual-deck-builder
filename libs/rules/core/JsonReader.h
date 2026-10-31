#pragma once

#include <nlohmann/json.hpp>

#include <array>
#include <cstddef>
#include <filesystem>
#include <functional>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace rules {

	template <typename Enum, std::size_t Count>
	using EnumNames = std::array<std::pair<std::string_view, Enum>, Count>;

	// Reads one JSON object strictly. A missing required field, a field of the wrong type, or one that
	// nothing read by finish() fails the load with a ContentError naming the file and the path in it.
	// The object has to outlive the reader.
	class JsonReader {
	  public:
		// `where` names the object in messages: its file, then its path inside the file.
		JsonReader(const nlohmann::json& object, std::string where);

		[[nodiscard]] const std::string& where() const { return location; }
		[[nodiscard]] bool has(std::string_view key) const;

		[[nodiscard]] int					 requireInt(std::string_view key);
		[[nodiscard]] std::optional<int>	 optionalInt(std::string_view key);
		[[nodiscard]] double				 requireNumber(std::string_view key);
		[[nodiscard]] bool					 requireBool(std::string_view key);
		[[nodiscard]] bool					 optionalBool(std::string_view key);
		[[nodiscard]] std::string			 requireString(std::string_view key);
		[[nodiscard]] std::optional<std::string> optionalString(std::string_view key);
		[[nodiscard]] std::vector<std::string>	 requireStrings(std::string_view key);

		template <typename Enum, std::size_t Count>
		[[nodiscard]] Enum requireEnum(std::string_view key, const EnumNames<Enum, Count>& names) {
			return enumNamed(key, requireString(key), names);
		}

		template <typename Enum, std::size_t Count>
		[[nodiscard]] std::optional<Enum> optionalEnum(std::string_view key, const EnumNames<Enum, Count>& names) {
			const std::optional<std::string> name = optionalString(key);
			if (!name) {
				return std::nullopt;
			}
			return enumNamed(key, *name, names);
		}

		// The enum value `name` reads as, failing at `key` for a name it doesn't list.
		template <typename Enum, std::size_t Count>
		[[nodiscard]] Enum enumNamed(std::string_view key, std::string_view name, const EnumNames<Enum, Count>& names) const {
			for (const auto& [candidate, value] : names) {
				if (candidate == name) {
					return value;
				}
			}
			std::string expected;
			for (const auto& [candidate, value] : names) {
				expected += expected.empty() ? "" : ", ";
				expected += candidate;
			}
			failAt(key, "\"" + std::string(name) + "\" is not one of " + expected);
		}

		[[nodiscard]] JsonReader				requireObject(std::string_view key);
		[[nodiscard]] std::optional<JsonReader> optionalObject(std::string_view key);
		[[nodiscard]] std::vector<JsonReader>	requireObjects(std::string_view key);
		// An object whose values are all objects, as (key, reader) pairs in key order.
		[[nodiscard]] std::vector<std::pair<std::string, JsonReader>> requireEntries(std::string_view key);
		// The raw value, for a field with more than one shape. It counts as read.
		[[nodiscard]] const nlohmann::json& requireValue(std::string_view key);

		// Fails on every field nothing has read: a typo or a field this build doesn't know.
		void finish() const;

		[[noreturn]] void fail(std::string_view message) const;
		[[noreturn]] void failAt(std::string_view key, std::string_view message) const;

	  private:
		const nlohmann::json*			   object;
		std::string						   location;
		std::set<std::string, std::less<>> read;

		// The field, marked read, or nullptr when it's absent.
		const nlohmann::json* find(std::string_view key);
		const nlohmann::json& require(std::string_view key);
	};

	// A file's JSON, or a ContentError naming the file when it can't be read or parsed.
	[[nodiscard]] nlohmann::json readJsonFile(const std::filesystem::path& file);

} // namespace rules
