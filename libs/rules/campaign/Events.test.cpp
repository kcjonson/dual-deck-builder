#include <rules/campaign/CampaignTesting.h>
#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

#include <filesystem>
#include <fstream>
#include <functional>
#include <stdexcept>
#include <string>

namespace {

	using namespace rules;
	using namespace rules::campaigns;
	namespace fs = std::filesystem;

	// An event every field of which reads, for the tests to break one field of.
	const nlohmann::json kTollBooth = nlohmann::json::parse(R"({
		"id": "toll_booth",
		"stopType": "distress",
		"title": "Toll booth",
		"illustration": {"art": "event_toll", "caption": "A booth across the road"},
		"setup": "Someone has built a booth across the road.",
		"situation": "A man with a shotgun wants paying.",
		"choices": [
			{"id": "pay", "title": "Pay the toll", "preview": "He'll take scrap.", "cost": {"scrap": 2}, "danger": 0,
				"outcomes": [{"text": "He waves you through.", "resources": {"water": 1}}]},
			{"id": "drive_on", "title": "Drive on", "preview": "Turn round.", "danger": 0, "outcomes": [{"text": "You turn round."}]}
		]
	})");

	// Packs over the base pack, their events written to a scratch folder for one test and deleted after it. Their
	// manifests join the base pack's loaded content, which is all loadEvents reads of a pack, so the base pack isn't
	// loaded again for each.
	class EventPacks : public ::testing::Test {
	  protected:
		fs::path scratch;

		void SetUp() override {
			scratch =
				fs::temp_directory_path() / (std::string("ddb-events-") + ::testing::UnitTest::GetInstance()->current_test_info()->name());
			fs::remove_all(scratch);
		}

		void TearDown() override { fs::remove_all(scratch); }

		PackManifest pack(std::string_view id, std::vector<PackId> required, const std::vector<nlohmann::json>& events) {
			const fs::path root = scratch / std::string(id);
			fs::create_directories(root);
			if (!events.empty()) {
				fs::create_directories(root / "events");
				std::ofstream(root / "events" / "events.json", std::ios::binary) << nlohmann::json{{"events", events}}.dump();
			}
			return PackManifest{
				.id = PackId{std::string(id)}, .name = "Test", .version = "1", .requiredPacks = std::move(required), .root = root
			};
		}

		static Content over(const std::vector<PackManifest>& packs) {
			Content content = testContent();
			content.packs.insert(content.packs.end(), packs.begin(), packs.end());
			return content;
		}

		static std::string errorFrom(const Content& content) {
			try {
				(void)loadEvents(content);
			} catch (const ContentError& error) {
				return error.what();
			}
			ADD_FAILURE() << "expected a ContentError";
			return "";
		}

		// The error the toll booth, changed by `change`, fails with, in a pack over the base pack.
		std::string errorWith(std::string_view id, const std::function<void(nlohmann::json&)>& change) {
			nlohmann::json event = kTollBooth;
			change(event);
			return errorFrom(over({pack(id, {PackId{"base"}}, {event})}));
		}

		static bool mentions(const std::string& message, std::string_view part) { return message.find(part) != std::string::npos; }
	};

	TEST(Events, TheBasePacksEventsReadAsData) {
		const Events& events = testEvents();
		EXPECT_EQ(events.size(), 5U);
		std::vector<std::string> wrecks;
		for (const EventDefinition* event : eventsFor(events, map::StopType::Wreck)) {
			wrecks.push_back(event->id.value);
		}
		EXPECT_EQ(wrecks, (std::vector<std::string>{"armored_car", "burned_bus", "jackknifed_tanker"})) << "in id order";
		EXPECT_EQ(eventsFor(events, map::StopType::Distress).size(), 2U);
		EXPECT_TRUE(eventsFor(events, map::StopType::Ambush).empty());

		const EventDefinition& tanker = events.at(EventId{"jackknifed_tanker"});
		EXPECT_EQ(tanker.pack, PackId{"base"});
		const EventChoice& valve = choiceOf(tanker, "crack_valve");
		EXPECT_EQ(valve.needs, (EventNeeds{.archetype = DriverId{"mechanic"}, .card = {}, .escort = {}}));
		EXPECT_FALSE(isFree(valve));
		EXPECT_EQ(valve.outcomes.front().gains.gained, Resources{.fuel = 5});
		EXPECT_EQ(valve.outcomes.front().hours, 0.5);
		const EventChoice& strip = choiceOf(tanker, "strip_cab");
		EXPECT_EQ(strip.outcomes.front().weight, 3);
		EXPECT_EQ(strip.outcomes.back().gains.structure, -3);
		EXPECT_EQ(strip.outcomes.back().gains.hp, -2);
		EXPECT_TRUE(isFree(choiceOf(tanker, "drive_on")));
		EXPECT_THROW((void)choiceOf(tanker, "siphon_harder"), std::invalid_argument);

		const EventChoice& running = choiceOf(events.at(EventId{"armored_car"}), "get_it_running");
		EXPECT_EQ(running.cost, Resources{.scrap = 8});
		EXPECT_EQ(running.outcomes.front().gains.escort, EscortId{"outrider"});
		const EventOutcome& bait = choiceOf(events.at(EventId{"burned_bus"}), "search_bus").outcomes.back();
		ASSERT_TRUE(bait.fight.has_value());
		EXPECT_EQ(bait.fight->skulls, 1);
		EXPECT_EQ(bait.fight->won.gained, Resources{.scrap = 6});
		const EventOutcome& charge = choiceOf(events.at(EventId{"family_under_fire"}), "charge").outcomes.front();
		EXPECT_EQ(charge.fight->won.gained, (Resources{.food = 2, .people = 3})) << "settlers ride home as people";
		EXPECT_EQ(choiceOf(events.at(EventId{"mayday_channel_nine"}), "treat_on_the_spot").needs.escort, EscortId{"med_truck"});
	}

	TEST_F(EventPacks, ALaterPackAddsOrOverridesAnEventOnlyOverAPackItRequires) {
		nlohmann::json tanker = kTollBooth;
		tanker["id"] = "jackknifed_tanker";
		tanker["stopType"] = "wreck";
		const PackId base{"base"};
		const Events events = loadEvents(over({pack("expansion", {base}, {kTollBooth, tanker})}));
		EXPECT_EQ(events.size(), 6U);
		EXPECT_EQ(events.at(EventId{"toll_booth"}).pack, PackId{"expansion"});
		EXPECT_EQ(events.at(EventId{"jackknifed_tanker"}).pack, PackId{"expansion"});
		EXPECT_EQ(events.at(EventId{"jackknifed_tanker"}).choices.size(), 2U) << "replaced whole";
		const Events further = loadEvents(over({pack("expansion", {base}, {tanker}), pack("further", {PackId{"expansion"}}, {tanker})}));
		EXPECT_EQ(further.at(EventId{"jackknifed_tanker"}).pack, PackId{"further"}) << "requiring base through the expansion";

		std::string error = errorFrom(over({pack("rival", {}, {tanker})}));
		EXPECT_TRUE(mentions(error, "pack rival overrides event jackknifed_tanker from pack base without requiring base")) << error;
		error = errorFrom(over({pack("twice", {base}, {kTollBooth, kTollBooth})}));
		EXPECT_TRUE(mentions(error, "event toll_booth is defined twice in pack twice")) << error;
		Content alone;
		alone.packs = {pack("alone", {}, {})};
		error = errorFrom(alone);
		EXPECT_TRUE(mentions(error, "no loaded pack has an event for a wreck stop")) << error;
	}

	TEST_F(EventPacks, AnEventThatCouldStrandAPartyOrNamesWhatNoPackDefinesFailsNamingWhere) {
		std::string error = errorWith("mood", [](nlohmann::json& event) { event["mood"] = "tense"; });
		EXPECT_TRUE(mentions(error, "mood")) << error;
		error = errorWith("fight", [](nlohmann::json& event) { event["stopType"] = "ambush"; });
		EXPECT_TRUE(mentions(error, "stopType isn't a stop the run resolves as an event")) << error;
		error = errorWith("stuck", [](nlohmann::json& event) { event["choices"][1]["requires"] = {{"archetype", "mechanic"}}; });
		EXPECT_TRUE(mentions(error, "must hold a choice that needs nothing and costs nothing")) << error;
		error = errorWith("pilot", [](nlohmann::json& event) { event["choices"][0]["requires"] = {{"archetype", "pilot"}}; });
		EXPECT_TRUE(mentions(error, "choices[0].requires.archetype names driver pilot, which no loaded pack defines")) << error;
		error = errorWith("signature", [](nlohmann::json& event) { event["choices"][0]["outcomes"][0]["cards"] = {{"run_ahead", 1}}; });
		EXPECT_TRUE(mentions(error, "signature card")) << error;
		error = errorWith("loss", [](nlohmann::json& event) {
			event["choices"][0]["outcomes"][0]["fight"] = {{"skulls", 1}, {"text", "They want it back."}, {"resources", {{"scrap", -2}}}};
		});
		EXPECT_TRUE(mentions(error, "fight.resources.scrap must be a whole number from 1 to 30")) << error;
		error = errorWith("hours", [](nlohmann::json& event) { event["choices"][0]["outcomes"][0]["hours"] = 0.3; });
		EXPECT_TRUE(mentions(error, "half hours")) << error;
	}

} // namespace
