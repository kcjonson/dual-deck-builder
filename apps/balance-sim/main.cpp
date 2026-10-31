// balance-sim (docs/specs/Balance Simulation.md): the command line tool over the sim's core. It loads the base pack and
// any packs given over it, as the game does, reads the config, plays it, prints the summary, and writes the JSON.
//
//   balance-sim fights [--config <file>] [--pack <dir>]... [--seed <n>] [--runs <n>] [--crews all|pairs|solo|<a+b,c>]
//     [--routes <1,2,1+2,spike_crew>] [--stage <0,2>] [--tier <n>] [--turns <n>] [--player <policy>] [--workers <n>]
//     [--json <file>]
//
// Options on the command line win over the config's fields. Build it in RelWithDebInfo or Release: in Debug the
// stand-ins that play the fight out on copies, and MCTS most, are many times slower.

#include "Fights.h"
#include "FightsConfig.h"
#include "Report.h"

#include <rules/core/ContentError.h>
#include <rules/core/JsonReader.h>
#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <charconv>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

	constexpr std::string_view kUsage =
		"usage: balance-sim fights [--config <file>] [--pack <dir>]... [--seed <n>] [--runs <n>]\n"
		"         [--crews all|pairs|solo|road_warrior+interceptor,mechanic] [--routes 1,2,3,1+2,spike_crew]\n"
		"         [--stage 0,2] [--tier <n>] [--turns <n>] [--player <policy>] [--workers <n>] [--json <file>]\n";

	// A mistake on the command line, which prints the usage.
	class UsageError : public std::runtime_error {
	  public:
		using std::runtime_error::runtime_error;
	};

	struct Options {
		std::optional<std::filesystem::path> config;
		std::vector<std::filesystem::path>	 packs;
		std::optional<std::filesystem::path> json;
		int									 workers{2};
		// The config's fields the command line sets, as the config would hold them.
		nlohmann::json overrides = nlohmann::json::object();
	};

	int wholeNumber(std::string_view option, std::string_view text) {
		int		   value = 0;
		const auto end = text.data() + text.size();
		const auto [stopped, error] = std::from_chars(text.data(), end, value);
		if (error != std::errc{} || stopped != end) {
			throw UsageError(std::string(option) + " takes a whole number, not \"" + std::string(text) + "\"");
		}
		return value;
	}

	std::vector<std::string_view> split(std::string_view text, char separator) {
		std::vector<std::string_view> parts;
		size_t						  start = 0;
		while (true) {
			const size_t end = text.find(separator, start);
			parts.push_back(text.substr(start, end - start));
			if (end == std::string_view::npos) {
				return parts;
			}
			start = end + 1;
		}
	}

	bool isWholeNumber(std::string_view text) {
		return !text.empty() && text.find_first_not_of("0123456789") == std::string_view::npos;
	}

	Options readOptions(int argc, char** argv) {
		const std::vector<std::string_view> args(argv + 1, argv + argc);
		if (args.empty() || args.front() == "--help" || args.front() == "-h") {
			throw UsageError("");
		}
		if (args.front() != "fights") {
			throw UsageError("the mode is fights, not \"" + std::string(args.front()) + "\"; gen, runs, and calibrate aren't built yet");
		}
		Options options;
		for (size_t index = 1; index < args.size(); ++index) {
			const std::string_view option = args[index];
			if (index + 1 >= args.size()) {
				throw UsageError(std::string(option) + " needs a value");
			}
			const std::string_view value = args[++index];
			if (option == "--config") {
				options.config = std::filesystem::path(value);
			} else if (option == "--pack") {
				options.packs.emplace_back(value);
			} else if (option == "--json") {
				options.json = std::filesystem::path(value);
			} else if (option == "--workers") {
				options.workers = wholeNumber(option, value);
				if (options.workers < 1) {
					throw UsageError("--workers takes 1 or more");
				}
			} else if (option == "--seed" || option == "--runs" || option == "--tier" || option == "--turns") {
				options.overrides[std::string(option.substr(2))] = wholeNumber(option, value);
			} else if (option == "--stage") {
				nlohmann::json stages = nlohmann::json::array();
				for (const std::string_view stage : split(value, ',')) {
					stages.push_back(wholeNumber(option, stage));
				}
				options.overrides["stages"] = std::move(stages);
			} else if (option == "--crews") {
				if (value == "all" || value == "pairs" || value == "solo") {
					options.overrides["crews"] = std::string(value);
					continue;
				}
				nlohmann::json crews = nlohmann::json::array();
				for (const std::string_view crew : split(value, ',')) {
					nlohmann::json seats = nlohmann::json::array();
					for (const std::string_view seat : split(crew, '+')) {
						seats.push_back(std::string(seat));
					}
					crews.push_back(std::move(seats));
				}
				options.overrides["crews"] = std::move(crews);
			} else if (option == "--routes") {
				nlohmann::json routes = nlohmann::json::array();
				for (const std::string_view route : split(value, ',')) {
					nlohmann::json steps = nlohmann::json::array();
					for (const std::string_view step : split(route, '+')) {
						steps.push_back(
							isWholeNumber(step) ? nlohmann::json(wholeNumber(option, step)) : nlohmann::json(std::string(step))
						);
					}
					routes.push_back(std::move(steps));
				}
				options.overrides["routes"] = std::move(routes);
			} else if (option == "--player") {
				options.overrides["standIn"] = nlohmann::json{{"policy", std::string(value)}};
			} else {
				throw UsageError("unknown option " + std::string(option));
			}
		}
		return options;
	}

	int run(const Options& options) {
		std::vector<std::filesystem::path> roots{std::filesystem::path(DDB_PACKS_DIR) / "base"};
		roots.insert(roots.end(), options.packs.begin(), options.packs.end());
		const rules::Content content = rules::loadPacks(roots);

		nlohmann::json config = options.config ? rules::readJsonFile(*options.config) : nlohmann::json::object();
		if (!config.is_object()) {
			throw rules::ContentError(options.config->generic_string() + " must be an object");
		}
		for (const auto& [key, value] : options.overrides.items()) {
			config[key] = value;
		}
		// With the crews listed on the command line, the config's archetypes have nothing to draw for.
		if (options.overrides.contains("crews") && options.overrides["crews"].is_array()) {
			config.erase("archetypes");
		}
		const std::string		where = options.config ? options.config->generic_string() : "config";
		const sim::FightsConfig read = sim::readFightsConfig(config, where, content);

		const sim::SimRules		shared(content);
		const sim::FightsReport report = sim::playFights(read, shared, options.workers);
		sim::printReport(std::cout, report, content.packs);
		if (options.json) {
			std::ofstream file(*options.json, std::ios::binary);
			if (!file) {
				throw std::runtime_error("can't write " + options.json->generic_string());
			}
			file << sim::reportJson(report, content.packs).dump(1, '\t') << "\n";
			std::cout << "wrote " << options.json->generic_string() << "\n";
		}
		return 0;
	}

} // namespace

int main(int argc, char** argv) {
	try {
		return run(readOptions(argc, argv));
	} catch (const UsageError& error) {
		if (*error.what() != '\0') {
			std::cerr << "balance-sim: " << error.what() << "\n";
		}
		std::cerr << kUsage;
		return 2;
	} catch (const std::exception& error) {
		std::cerr << "balance-sim: " << error.what() << "\n";
		return 1;
	}
}
