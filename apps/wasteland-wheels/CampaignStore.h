#pragma once

#include <rules/campaign/Campaign.h>
#include <rules/packs/Pack.h>
#include <saves/SaveStore.h>

#include <nlohmann/json.hpp>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace game {

	// What the main menu's Continue says of the save without making its map (Game Flow 1.1): a campaign in progress
	// with its summary, nothing to continue, a damaged save, or one from a build with another save format.
	enum class SaveState { None, Saved, Damaged, OtherFormat };

	struct SaveStatus {
		SaveState state{SaveState::None};
		// Saved: "Day 12 - 3 drivers - 1 stronghold taken". Otherwise why it can't be continued, the line under
		// Continue.
		std::string line;
		// Saved: the campaign as the save holds it, read without its map.
		std::optional<rules::campaign::Campaign> campaign;
	};

	// A past campaign, for Campaign History: its seed, the day it ended on, the strongholds it took, and how it ended,
	// starved, rioted, or disbanded, or abandoned for a new one.
	struct HistoryEntry {
		uint32_t	seed{0};
		int			day{1};
		int			strongholdsTaken{0};
		std::string ending;

		bool operator==(const HistoryEntry&) const = default;
	};

	// The campaign's save and the history of past campaigns, each in a slot of salal's SaveStore, whose envelope carries
	// the save format's version, rules::campaign::kSaveVersion (campaign-save-and-load.md). What a save holds is the
	// campaign's JSON (CampaignJson.h); what makes its map again is in it, and the map is made by whoever loads it.
	class CampaignStore {
	  public:
		static constexpr std::string_view kCampaignSlot = "campaign";
		static constexpr std::string_view kHistorySlot = "history";

		CampaignStore(app::SaveStore& saves, const rules::Content& content);

		// Reads the save's envelope, then its JSON, then the campaign strictly, without its map.
		[[nodiscard]] SaveStatus status();
		// The save's JSON, for a load to open; none when there's no save this build reads.
		[[nodiscard]] std::optional<nlohmann::json> saveJson();
		// The campaign written whole over the save, the one it replaces kept as the backup. False, logged, when it can't
		// be written; the save before stands.
		[[nodiscard]] bool save(const rules::campaign::Campaign& campaign);
		// The campaign into the history with its ending, newest first, and its save gone. A campaign that's over goes in
		// with its own fall, whatever `ending` says. False, logged, when either write fails.
		[[nodiscard]] bool end(const rules::campaign::Campaign& campaign, std::string_view ending);
		// A new campaign over the save: written over it, then the one it replaced, if this build reads it, into the
		// history as abandoned. A save that can't be read is written over, which salal's store sets aside rather than
		// deletes. False, logged, when either write fails, the new campaign saved or not as the first went.
		[[nodiscard]] bool replace(const rules::campaign::Campaign& fresh);
		// Newest first; empty for a history this build can't read.
		[[nodiscard]] std::vector<HistoryEntry> history();

	  private:
		// The history with the campaign's entry at its head.
		[[nodiscard]] bool record(const rules::campaign::Campaign& campaign, std::string_view ending);

		app::SaveStore&		  saves;
		const rules::Content& content;
	};

	// What a history entry says of a campaign ending now: its seed, its day, the strongholds it took, and its ending.
	[[nodiscard]] HistoryEntry historyEntry(const rules::campaign::Campaign& campaign, std::string_view ending);

	// "Day 12 - 3 drivers - 1 stronghold taken", the drivers at the compound, not the dead or the missing.
	[[nodiscard]] std::string campaignSummary(const rules::campaign::Campaign& campaign);

} // namespace game
