// balance-sim (docs/specs/Balance Simulation.md): the command line tool over the sim's core. It loads the base pack and
// any packs given over it, as the game does, reads the config, plays it, prints the summary, and writes the JSON.
//
//   balance-sim fights [--config <file>] [--pack <dir>]... [--seed <n>] [--runs <n>] [--crews all|pairs|solo|<a+b,c>]
//     [--routes <1,2,1+2,spike_crew>] [--stage <0,2>] [--tier <n>] [--turns <n>] [--player <policy>] [--workers <n>]
//     [--json <file>]
//   balance-sim gen [--config <file>] [--maps <n>|<seed,seed>] [--workers <n>] [--json <file>]
//   balance-sim runs [--config <file>] [--pack <dir>]... [--maps <n>|<seed,seed>] [--runs <n>] [--crews ...]
//     [--routes all|<n>] [--tier <1,2>] [--stage <0,2>] [--turns <n>] [--player <policy>] [--neighbor on|off]
//     [--workers <n>] [--json <file>]
//
// Options on the command line win over the config's fields. Build it in RelWithDebInfo or Release: in Debug the
// stand-ins that play the fight out on copies, and MCTS most, are many times slower. Run mode's maps are made from the
// base pack's map content, which --pack doesn't reach.

#include "Fights.h"
#include "FightsConfig.h"
#include "Gen.h"
#include "GenReport.h"
#include "Report.h"
#include "RunReport.h"
#include "Runs.h"
#include "RunsConfig.h"

#include <rules/core/ContentError.h>
#include <rules/core/JsonReader.h>
#include <rules/map/AreaMapPipeline.h>
#include <rules/map/RouteDescriptors.h>
#include <rules/packs/Pack.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <charconv>
#include <chrono>
#include <filesystem>
#include <format>
#include <fstream>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

	constexpr std::string_view kUsage =
		"usage: balance-sim fights [--config <file>] [--pack <dir>]... [--seed <n>] [--runs <n>]\n"
		"         [--crews all|pairs|solo|road_warrior+interceptor,mechanic] [--routes 1,2,3,1+2,spike_crew]\n"
		"         [--stage 0,2] [--tier <n>] [--turns <n>] [--player <policy>] [--cards] [--log <cell>:<run>]\n"
		"         [--workers <n>] [--json <file>]\n"
		"       balance-sim gen [--config <file>] [--maps <n>|<seed,seed>] [--workers <n>] [--json <file>]\n"
		"       balance-sim runs [--config <file>] [--pack <dir>]... [--maps <n>|<seed,seed>] [--runs <n>]\n"
		"         [--crews all|pairs|solo|road_warrior+interceptor,mechanic] [--routes all|<n>] [--tier 1,2]\n"
		"         [--stage 0,2] [--turns <n>] [--player <policy>] [--neighbor on|off] [--log <cell>:<run>]\n"
		"         [--workers <n>] [--json <file>]\n";

	enum class Mode { Fights, Gen, Runs };

	// A mistake on the command line, which prints the usage.
	class UsageError : public std::runtime_error {
	  public:
		using std::runtime_error::runtime_error;
	};

	struct Options {
		Mode								 mode{Mode::Fights};
		std::optional<std::filesystem::path> config;
		std::vector<std::filesystem::path>	 packs;
		std::optional<std::filesystem::path> json;
		int									 workers{2};
		// One run of one cell to play and print in words, `cell:run`, in place of the sweep.
		std::optional<std::string> log;
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

	nlohmann::json wholeNumbers(std::string_view option, std::string_view text) {
		nlohmann::json numbers = nlohmann::json::array();
		for (const std::string_view number : split(text, ',')) {
			numbers.push_back(wholeNumber(option, number));
		}
		return numbers;
	}

	// `--log`'s cell and run: the cell's name up to the last colon, and a run from 1 after it.
	std::pair<std::string, int> logged(std::string_view text) {
		const size_t colon = text.rfind(':');
		if (colon == std::string_view::npos || colon == 0) {
			throw UsageError("--log takes a cell and a run, road_warrior+interceptor:1+2@0:3");
		}
		const int run = wholeNumber("--log", text.substr(colon + 1));
		if (run < 1) {
			throw UsageError("--log counts runs from 1");
		}
		return {std::string(text.substr(0, colon)), run};
	}

	Options readOptions(int argc, char** argv) {
		const std::vector<std::string_view> args(argv + 1, argv + argc);
		if (args.empty() || args.front() == "--help" || args.front() == "-h") {
			throw UsageError("");
		}
		if (args.front() != "fights" && args.front() != "gen" && args.front() != "runs") {
			throw UsageError("the mode is fights, gen, or runs, not \"" + std::string(args.front()) + "\"; calibrate isn't built");
		}
		Options	   options{.mode = args.front() == "runs" ? Mode::Runs : args.front() == "gen" ? Mode::Gen : Mode::Fights};
		const bool runs = options.mode == Mode::Runs;
		const bool gen = options.mode == Mode::Gen;
		for (size_t index = 1; index < args.size(); ++index) {
			const std::string_view option = args[index];
			if (options.mode == Mode::Fights && option == "--cards") {
				options.overrides["cards"] = true;
				continue;
			}
			if (index + 1 >= args.size()) {
				throw UsageError(std::string(option) + " needs a value");
			}
			const std::string_view value = args[++index];
			if (gen && option != "--config" && option != "--maps" && option != "--workers" && option != "--json") {
				throw UsageError(std::string(option) + " isn't an option of gen");
			}
			if (option == "--config") {
				options.config = std::filesystem::path(value);
			} else if (option == "--log") {
				options.log = std::string(value);
			} else if (option == "--pack") {
				options.packs.emplace_back(value);
			} else if (option == "--json") {
				options.json = std::filesystem::path(value);
			} else if (option == "--workers") {
				options.workers = wholeNumber(option, value);
				if (options.workers < 1) {
					throw UsageError("--workers takes 1 or more");
				}
			} else if (option == "--runs" || option == "--turns" || (!runs && (option == "--seed" || option == "--tier"))) {
				options.overrides[std::string(option.substr(2))] = wholeNumber(option, value);
			} else if (option == "--stage") {
				options.overrides["stages"] = wholeNumbers(option, value);
			} else if (runs && option == "--tier") {
				options.overrides["tiers"] = wholeNumbers(option, value);
			} else if ((runs || gen) && option == "--maps") {
				options.overrides["maps"] =
					value.find(',') == std::string_view::npos ? nlohmann::json(wholeNumber(option, value)) : wholeNumbers(option, value);
			} else if (runs && option == "--routes") {
				options.overrides["routes"] = value == "all" ? nlohmann::json("all") : nlohmann::json(wholeNumber(option, value));
			} else if (runs && option == "--neighbor") {
				if (value != "on" && value != "off") {
					throw UsageError("--neighbor takes on or off, not \"" + std::string(value) + "\"");
				}
				options.overrides["neighbor"] = value == "on";
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
			} else if (!runs && option == "--routes") {
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
				throw UsageError("unknown option " + std::string(option) + " for " + std::string(args.front()));
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
		const std::string	where = options.config ? options.config->generic_string() : "config";
		const sim::SimRules shared(content);
		const auto			write = [&](const nlohmann::ordered_json& json) {
			 if (!options.json) {
				 return;
			 }
			 std::ofstream file(*options.json, std::ios::binary);
			 if (!file) {
				 throw std::runtime_error("can't write " + options.json->generic_string());
			 }
			 file << json.dump(1, '\t') << "\n";
			 std::cout << "wrote " << options.json->generic_string() << "\n";
		};

		if (options.mode == Mode::Gen) {
			const sim::GenConfig				read = sim::readGenConfig(config, where);
			const std::filesystem::path			base = roots.front();
			const rules::map::MapContent		mapContent = rules::map::readMapContent(base);
			const rules::map::RouteTuning		routeTuning = rules::map::readRouteTuning(base / "map" / "routes.json");
			const auto							started = std::chrono::steady_clock::now();
			const sim::MadeMaps					maps = sim::makeRunMaps(read.maps, mapContent, routeTuning, options.workers);
			const std::chrono::duration<double> making = std::chrono::steady_clock::now() - started;
			std::cout << std::format("made {} maps in {:.1f} s on {} workers\n", maps.maps.size(), making.count(), options.workers);
			const sim::GenReport report = sim::auditMaps(read, shared, maps.maps, options.workers);
			sim::printGenReport(std::cout, report, content.packs);
			write(sim::genReportJson(report, content.packs));
			return 0;
		}
		if (options.mode == Mode::Fights) {
			const sim::FightsConfig fights = sim::readFightsConfig(config, where, content);
			if (options.log) {
				const auto [name, run] = logged(*options.log);
				const std::vector<sim::FightCell> cells = sim::fightCells(fights);
				const auto						  cell = std::ranges::find(cells, name, &sim::FightCell::name);
				if (cell == cells.end()) {
					throw UsageError("--log names no cell the config makes: " + name);
				}
				const sim::RunRecord record = sim::playRun(fights, shared, *cell, run, &std::cout);
				std::cout << std::format("{} run {}: {}\n", name, run, sim::runEndName(record.end));
				return 0;
			}
			const sim::FightsReport report = sim::playFights(fights, shared, options.workers);
			sim::printReport(std::cout, report, content.packs);
			write(sim::reportJson(report, content.packs));
			return 0;
		}

		const sim::RunsConfig				read = sim::readRunsConfig(config, where, content);
		const std::filesystem::path			base = roots.front();
		const rules::map::MapContent		mapContent = rules::map::readMapContent(base);
		const rules::map::RouteTuning		routeTuning = rules::map::readRouteTuning(base / "map" / "routes.json");
		const auto							started = std::chrono::steady_clock::now();
		const sim::MadeMaps					maps = sim::makeRunMaps(read.maps, mapContent, routeTuning, options.workers);
		const std::chrono::duration<double> making = std::chrono::steady_clock::now() - started;
		std::cout << std::format("made {} maps in {:.1f} s on {} workers\n", maps.maps.size(), making.count(), options.workers);
		if (options.log) {
			const auto [name, run] = logged(*options.log);
			const std::vector<sim::RunCell> cells = sim::runCells(read, shared, maps.maps);
			const auto						cell = std::ranges::find(cells, name, &sim::RunCell::name);
			if (cell == cells.end()) {
				throw UsageError("--log names no cell the config makes: " + name);
			}
			const sim::RouteRunRecord record = sim::playRouteRun(read, shared, maps.maps, *cell, run, &std::cout);
			std::cout << std::format("{} run {}: {}\n", name, run, sim::routeEndName(record.end));
			return 0;
		}
		const sim::RunsReport report = sim::playRuns(read, shared, maps.maps, options.workers);
		sim::printRunReport(std::cout, report, content.packs);
		write(sim::runReportJson(report, content.packs));
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
