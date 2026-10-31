#include "CampaignStore.h"

#include "Words.h"

#include <rules/campaign/CampaignJson.h>
#include <rules/core/ContentError.h>

#include <utils/Log.h>

#include <algorithm>
#include <exception>

namespace game {

	using rules::campaign::Campaign;
	using rules::campaign::DriverStatus;

	namespace {

		constexpr const char* kNoCampaign = "No campaign in progress.";
		constexpr const char* kDamaged = "The save is damaged.";
		constexpr const char* kOtherFormat = "The save is from a version of the game with another save format.";

		SaveStatus statusOf(SaveState state, std::string line) {
			return SaveStatus{.state = state, .line = std::move(line), .campaign = std::nullopt};
		}

	} // namespace

	CampaignStore::CampaignStore(app::SaveStore& store, const rules::Content& loaded)
		: saves(store),
		  content(loaded) {}

	SaveStatus CampaignStore::status() {
		const app::Expected<nlohmann::json, app::SaveStore::LoadError> read = saves.readJson(kCampaignSlot);
		if (!read) {
			switch (read.error()) {
				case app::SaveStore::LoadError::Missing:
					return statusOf(SaveState::None, kNoCampaign);
				case app::SaveStore::LoadError::Corrupt:
					return statusOf(SaveState::Damaged, kDamaged);
				case app::SaveStore::LoadError::NewerThanBuild:
				case app::SaveStore::LoadError::UpgradeFailed:
					return statusOf(SaveState::OtherFormat, kOtherFormat);
			}
		}
		const nlohmann::json& json = *read;
		if (json.is_object() && json.contains("version") && json["version"] != rules::campaign::kSaveVersion) {
			return statusOf(SaveState::OtherFormat, kOtherFormat);
		}
		try {
			Campaign   campaign = rules::campaign::readCampaign(json, content);
			SaveStatus status = statusOf(SaveState::Saved, campaignSummary(campaign));
			status.campaign = std::move(campaign);
			return status;
		} catch (const rules::ContentError& error) {
			return statusOf(SaveState::Damaged, std::string(kDamaged) + " " + error.what());
		} catch (const std::exception& error) {
			// A throw that isn't the reader's is a bug, but one bad save mustn't lock the player out of the menu.
			LOG_ERROR(Game, "CampaignStore: reading the save threw: %s", error.what());
			return statusOf(SaveState::Damaged, std::string(kDamaged) + " " + error.what());
		}
	}

	std::optional<nlohmann::json> CampaignStore::saveJson() {
		app::Expected<nlohmann::json, app::SaveStore::LoadError> read = saves.readJson(kCampaignSlot);
		if (!read) {
			return std::nullopt;
		}
		return std::move(*read);
	}

	bool CampaignStore::save(const Campaign& campaign) {
		nlohmann::json json;
		try {
			json = rules::campaign::writeCampaign(campaign, content);
		} catch (const std::exception& error) {
			LOG_ERROR(Game, "CampaignStore: the campaign can't be written: %s", error.what());
			return false;
		}
		if (!saves.writeJson(kCampaignSlot, json)) {
			LOG_ERROR(Game, "CampaignStore: the save couldn't be written");
			return false;
		}
		return true;
	}

	bool CampaignStore::end(const Campaign& campaign, std::string_view ending) {
		if (!record(campaign, ending)) {
			LOG_ERROR(Game, "CampaignStore: the history couldn't be written; the save stays");
			return false;
		}
		if (!saves.remove(kCampaignSlot)) {
			LOG_ERROR(Game, "CampaignStore: the ended campaign's save couldn't be removed");
			return false;
		}
		return true;
	}

	bool CampaignStore::replace(const Campaign& fresh) {
		const SaveStatus replaced = status();
		if (!save(fresh)) {
			return false;
		}
		if (replaced.state == SaveState::Saved && !record(*replaced.campaign, "abandoned")) {
			LOG_ERROR(Game, "CampaignStore: the campaign the new one replaced couldn't go into the history");
			return false;
		}
		return true;
	}

	bool CampaignStore::record(const Campaign& campaign, std::string_view ending) {
		std::vector<HistoryEntry> entries = history();
		const HistoryEntry		  entry = historyEntry(campaign, ending);
		// A second end of the same campaign, after a crash between the history and the save going, adds nothing.
		if (entries.empty() || entries.front() != entry) {
			entries.insert(entries.begin(), entry);
		}
		nlohmann::json list = nlohmann::json::array();
		for (const HistoryEntry& past : entries) {
			list.push_back({{"seed", past.seed}, {"day", past.day}, {"strongholdsTaken", past.strongholdsTaken}, {"ending", past.ending}});
		}
		return saves.writeJson(kHistorySlot, nlohmann::json{{"entries", list}});
	}

	std::vector<HistoryEntry> CampaignStore::history() {
		const app::Expected<nlohmann::json, app::SaveStore::LoadError> read = saves.readJson(kHistorySlot);
		if (!read) {
			if (read.error() != app::SaveStore::LoadError::Missing) {
				LOG_WARNING(Game, "CampaignStore: the history can't be read; the next ending starts it over");
			}
			return {};
		}
		std::vector<HistoryEntry> entries;
		try {
			for (const nlohmann::json& entry : read->at("entries")) {
				entries.push_back(
					HistoryEntry{
						.seed = entry.at("seed").get<uint32_t>(),
						.day = entry.at("day").get<int>(),
						.strongholdsTaken = entry.at("strongholdsTaken").get<int>(),
						.ending = entry.at("ending").get<std::string>(),
					}
				);
			}
		} catch (const nlohmann::json::exception& error) {
			LOG_WARNING(Game, "CampaignStore: the history doesn't read (%s); the next ending starts it over", error.what());
			return {};
		}
		return entries;
	}

	HistoryEntry historyEntry(const Campaign& campaign, std::string_view ending) {
		return HistoryEntry{
			.seed = campaign.seed,
			.day = campaign.day,
			.strongholdsTaken = static_cast<int>(campaign.mapState.strongholdsTaken.size()),
			.ending = campaign.end ? std::string(nameOf(rules::campaign::kEndingNames, campaign.end->ending)) : std::string(ending),
		};
	}

	std::string campaignSummary(const Campaign& campaign) {
		const auto atCompound = std::ranges::count_if(campaign.drivers, [](const rules::campaign::DriverRecord& driver) {
			return driver.status != DriverStatus::Dead && driver.status != DriverStatus::Missing;
		});
		const auto strongholds = static_cast<int>(campaign.mapState.strongholdsTaken.size());
		return "Day " + std::to_string(campaign.day) + " - " + counted(static_cast<int>(atCompound), "driver", "drivers") + " - " +
			   counted(strongholds, "stronghold", "strongholds") + " taken";
	}

} // namespace game
