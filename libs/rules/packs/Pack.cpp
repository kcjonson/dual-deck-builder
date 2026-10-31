#include "Pack.h"

#include <rules/core/ContentError.h>
#include <rules/core/JsonReader.h>

#include <algorithm>
#include <set>

namespace rules {

	namespace {

		namespace fs = std::filesystem;

		// Where a definition came from, for overrides and messages.
		struct Origin {
			PackId		pack;
			std::string file;
		};

		PackManifest readManifest(const fs::path& root) {
			const fs::path file = root / "pack.json";
			if (!fs::is_regular_file(file)) {
				throw ContentError(root.generic_string() + " has no pack.json, so it isn't a pack");
			}
			const nlohmann::json json = readJsonFile(file);
			JsonReader			 reader(json, file.generic_string());
			PackManifest		 manifest{
						.id = PackId{reader.requireString("id")},
						.name = reader.requireString("name"),
						.version = reader.requireString("version"),
						.requiredPacks = {},
						.root = root,
			};
			if (reader.has("requires")) {
				for (std::string& required : reader.requireStrings("requires")) {
					manifest.requiredPacks.push_back(PackId{std::move(required)});
				}
			}
			reader.finish();
			return manifest;
		}

		// The .json files directly in `folder`, sorted, so packs load the same everywhere. Anything else in it
		// fails, since nothing would read it.
		std::vector<fs::path> jsonFilesIn(const fs::path& folder) {
			std::vector<fs::path> files;
			if (!fs::is_directory(folder)) {
				return files;
			}
			for (const fs::directory_entry& entry : fs::directory_iterator(folder)) {
				if (!entry.is_regular_file() || entry.path().extension() != ".json") {
					throw ContentError(entry.path().generic_string() + " isn't a .json file, and nothing in " + folder.generic_string() + " reads it");
				}
				files.push_back(entry.path());
			}
			std::ranges::sort(files);
			return files;
		}

		std::vector<fs::path> foldersIn(const fs::path& folder) {
			std::vector<fs::path> folders;
			if (!fs::is_directory(folder)) {
				return folders;
			}
			for (const fs::directory_entry& entry : fs::directory_iterator(folder)) {
				if (!entry.is_directory()) {
					throw ContentError(entry.path().generic_string() + " isn't a folder; every opponent is a folder holding opponent.json");
				}
				folders.push_back(entry.path());
			}
			std::ranges::sort(folders);
			return folders;
		}

		class Loader {
		  public:
			explicit Loader(std::vector<PackManifest> manifests) {
				for (size_t index = 0; index < manifests.size(); ++index) {
					const PackManifest& manifest = manifests[index];
					if (closures.contains(manifest.id)) {
						throw ContentError(manifest.root.generic_string() + ": pack " + manifest.id.value + " is loaded twice");
					}
					std::set<PackId>& closure = closures[manifest.id];
					for (const PackId& required : manifest.requiredPacks) {
						const auto loaded = closures.find(required);
						if (loaded == closures.end() || loaded->first == manifest.id) {
							const bool later = std::ranges::any_of(manifests, [&](const PackManifest& other) { return other.id == required; });
							throw ContentError(
								manifest.root.generic_string() + ": pack " + manifest.id.value + " requires " + required.value +
								(later ? ", which loads after it" : ", which isn't among the packs loaded")
							);
						}
						closure.insert(required);
						closure.insert(loaded->second.begin(), loaded->second.end());
					}
				}
				content.packs = std::move(manifests);
			}

			Content load() {
				for (const PackManifest& manifest : content.packs) {
					loadPack(manifest);
				}
				checkReferences();
				return std::move(content);
			}

		  private:
			Content								   content;
			std::map<PackId, std::set<PackId>>	   closures;
			std::map<CardId, Origin>			   cardOrigins;
			std::map<DriverId, Origin>			   driverOrigins;
			std::map<EscortId, Origin>			   escortOrigins;
			std::map<OpponentId, Origin>		   opponentOrigins;

			void loadPack(const PackManifest& manifest) {
				forEachDefinition(manifest, "cards", [&](JsonReader reader, const std::string& file) {
					define(content.cards, cardOrigins, readCard(std::move(reader)), "card", manifest, file);
				});
				forEachDefinition(manifest, "drivers", [&](JsonReader reader, const std::string& file) {
					define(content.drivers, driverOrigins, readDriver(std::move(reader)), "driver", manifest, file);
				});
				forEachDefinition(manifest, "escorts", [&](JsonReader reader, const std::string& file) {
					define(content.escorts, escortOrigins, readEscort(std::move(reader)), "escort", manifest, file);
				});
				for (const fs::path& folder : foldersIn(manifest.root / "opponents")) {
					const fs::path file = folder / "opponent.json";
					if (!fs::is_regular_file(file)) {
						throw ContentError(folder.generic_string() + " has no opponent.json");
					}
					const nlohmann::json json = readJsonFile(file);
					OpponentDefinition	 opponent = readOpponent(JsonReader(json, file.generic_string()), OpponentId{folder.filename().string()});
					checkScript(folder, file, opponent.behavior.script);
					define(content.opponents, opponentOrigins, std::move(opponent), "opponent", manifest, file.generic_string());
				}
			}

			// Calls `read` for every object in the `kind` array of every file in the pack's `kind` folder.
			template <typename Read>
			void forEachDefinition(const PackManifest& manifest, const std::string& kind, Read&& read) {
				for (const fs::path& path : jsonFilesIn(manifest.root / kind)) {
					const std::string	 file = path.generic_string();
					const nlohmann::json json = readJsonFile(path);
					JsonReader			 reader(json, file);
					for (JsonReader& definition : reader.requireObjects(kind)) {
						read(std::move(definition), file);
					}
					reader.finish();
				}
			}

			template <typename IdType, typename Definition>
			void define(
				std::map<IdType, Definition>& definitions,
				std::map<IdType, Origin>&	  origins,
				Definition					  definition,
				const std::string&			  kind,
				const PackManifest&			  manifest,
				const std::string&			  file
			) {
				const IdType id = definition.id;
				const auto	 earlier = origins.find(id);
				if (earlier != origins.end()) {
					const Origin& origin = earlier->second;
					if (origin.pack == manifest.id) {
						throw ContentError(file + ": " + kind + " " + id.value + " is defined twice in pack " + manifest.id.value + ", here and in " + origin.file);
					}
					if (!closures.at(manifest.id).contains(origin.pack)) {
						throw ContentError(
							file + ": pack " + manifest.id.value + " overrides " + kind + " " + id.value + " from pack " + origin.pack.value +
							" without requiring " + origin.pack.value
						);
					}
				}
				definition.pack = manifest.id;
				origins.insert_or_assign(id, Origin{.pack = manifest.id, .file = file});
				definitions.insert_or_assign(id, std::move(definition));
			}

			// A behavior's script has to be a file in the opponent's own folder.
			static void checkScript(const fs::path& folder, const fs::path& file, const std::string& script) {
				if (script.empty()) {
					return;
				}
				const fs::path relative(script);
				const bool	   escapes =
					relative.is_absolute() || relative.has_root_name() || std::ranges::any_of(relative, [](const fs::path& part) { return part == ".."; });
				if (escapes) {
					throw ContentError(file.generic_string() + ": behavior.script has to stay inside the opponent's folder");
				}
				if (!fs::is_regular_file(folder / relative)) {
					throw ContentError(file.generic_string() + ": behavior.script names " + script + ", which isn't in the opponent's folder");
				}
			}

			void requireCard(const CardId& card, const Origin& origin, const std::string& what) const {
				if (!content.cards.contains(card)) {
					throw ContentError(origin.file + ": " + what + " names card " + card.value + ", which no pack defines");
				}
			}

			void checkReferences() const {
				for (const auto& [id, driver] : content.drivers) {
					for (const DeckEntry& entry : driver.startingDeck) {
						requireCard(entry.card, driverOrigins.at(id), "driver " + id.value + "'s starting deck");
					}
				}
				for (const auto& [id, opponent] : content.opponents) {
					for (const DeckEntry& entry : opponent.deck) {
						requireCard(entry.card, opponentOrigins.at(id), "opponent " + id.value + "'s deck");
					}
				}
				for (const auto& [id, card] : content.cards) {
					const Origin& origin = cardOrigins.at(id);
					if (card.driverRestriction && !content.drivers.contains(*card.driverRestriction)) {
						throw ContentError(
							origin.file + ": card " + id.value + " is restricted to driver " + card.driverRestriction->value + ", which no pack defines"
						);
					}
					if (card.signatureOf && !content.escorts.contains(*card.signatureOf)) {
						throw ContentError(
							origin.file + ": card " + id.value + " is the signature of escort " + card.signatureOf->value + ", which no pack defines"
						);
					}
				}
				for (const auto& [id, escort] : content.escorts) {
					const Origin& origin = escortOrigins.at(id);
					requireCard(escort.signatureCard, origin, "escort " + id.value + "'s signatureCard");
					const CardDefinition& card = content.cards.at(escort.signatureCard);
					if (card.signatureOf != id) {
						throw ContentError(
							origin.file + ": escort " + id.value + "'s signature card " + card.id.value + " has to name it in signatureOf"
						);
					}
				}
			}
		};

	} // namespace

	Content loadPacks(std::span<const std::filesystem::path> packRoots) {
		std::vector<PackManifest> manifests;
		manifests.reserve(packRoots.size());
		for (const std::filesystem::path& root : packRoots) {
			manifests.push_back(readManifest(root));
		}
		return Loader(std::move(manifests)).load();
	}

} // namespace rules
