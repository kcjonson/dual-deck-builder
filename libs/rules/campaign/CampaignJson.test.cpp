#include <rules/campaign/CampaignJson.h>
#include <rules/campaign/CampaignTesting.h>
#include <rules/campaign/Garage.h>
#include <rules/campaign/Locker.h>
#include <rules/campaign/Recruits.h>
#include <rules/campaign/RunDecks.h>
#include <rules/core/ContentError.h>

#include <gtest/gtest.h>

#include <stdexcept>

namespace {

	using namespace rules;
	using namespace rules::campaigns;

	// A campaign partway through a run, so every part of the save is in it: the Mechanic home injured, a card bought in
	// the garage, two escorts and one of them along, a borrowed card, one left at home, cargo picked up, a missing Raider
	// found on the road, and someone new riding home.
	Campaign campaignOnARun() {
		Campaign	  campaign = foundTestCampaign({"fuel_hauler", "outrider"});
		DriverRecord& mechanic = campaign.driver(crewOf(campaign, "mechanic"));
		mechanic.status = DriverStatus::Injured;
		mechanic.injuredDays = 2;
		mechanic.hitpoints = 12;
		campaign.locker = {{card("repair_kit"), 2}};
		buyCard(campaign, testContent(), testRules().garage, campaign.garage[2].card);
		const CrewId raider = recruitDriver(campaign, testContent(), DriverId{"raider"});
		campaign.driver(raider).status = DriverStatus::Missing;
		const CrewId warrior = crewOf(campaign, "road_warrior");
		const CrewId interceptor = crewOf(campaign, "interceptor");
		startRun(campaign, testContent(), RunStart{.seats = {warrior, interceptor}, .escorts = {ConvoyId{"escort-2"}}, .stage = 1});
		takeFoundDriver(campaign, testContent(), raider);
		takeFoundDriver(campaign, testContent(), DriverId{"mechanic"});
		moveCards(
			campaign, testContent(), testRules().deck, {.card = card("repair_kit"), .count = 1, .from = Locker{}, .to = RunDeckOf{warrior}}
		);
		moveCards(
			campaign, testContent(), testRules().deck, {.card = card("nitro_boost"), .count = 1, .from = RunDeckOf{warrior}, .to = Locker{}}
		);
		addCardsWon(campaign, testContent(), {{card("ram"), 1}});
		campaign.run->cargo.fuel = 2;
		campaign.day = 4;
		return campaign;
	}

	std::string errorOf(const nlohmann::json& save) {
		try {
			(void)readCampaign(save, testContent());
		} catch (const ContentError& error) {
			return error.what();
		}
		ADD_FAILURE() << "expected a ContentError";
		return "";
	}

	bool mentions(const std::string& message, std::string_view part) {
		return message.find(part) != std::string::npos;
	}

	TEST(CampaignJson, ACampaignOnARunWritesAtItsVersionNamingItsPacksAndReadsBackTheSame) {
		const Campaign		 campaign = campaignOnARun();
		const nlohmann::json save = writeCampaign(campaign, testContent());
		EXPECT_EQ(save["version"], kSaveVersion);
		EXPECT_EQ(save["packs"], nlohmann::json::parse(R"([{"id": "base", "version": "0.1.0"}])"));
		EXPECT_EQ(save["run"]["seats"][0]["escortCards"], nlohmann::json::parse(R"([{"card": "run_ahead", "broughtBy": "escort-2"}])"));

		const Campaign loaded = readCampaign(save, testContent());
		EXPECT_EQ(loaded, campaign);
		EXPECT_EQ(writeCampaign(loaded, testContent()), save);
		EXPECT_EQ(readCampaign(writeCampaign(foundTestCampaign(), testContent()), testContent()), foundTestCampaign()) << "and at home";
	}

	TEST(CampaignJson, ASaveFailsLoudOnAMissingPackAnUnknownFieldOrAnotherVersion) {
		const nlohmann::json save = writeCampaign(campaignOnARun(), testContent());

		nlohmann::json expansion = save;
		expansion["packs"].push_back({{"id", "salvage_run"}, {"version", "2"}});
		EXPECT_TRUE(mentions(errorOf(expansion), "names pack salvage_run, which the campaign was made with and isn't loaded"));

		nlohmann::json mood = save;
		mood["drivers"][1]["mood"] = "grim";
		EXPECT_TRUE(mentions(errorOf(mood), "campaign.drivers[1] has fields nothing reads: mood"));

		nlohmann::json notes = save;
		notes["run"]["notes"] = "";
		EXPECT_TRUE(mentions(errorOf(notes), "campaign.run has fields nothing reads: notes"));

		nlohmann::json later = save;
		later["version"] = kSaveVersion + 1;
		EXPECT_TRUE(mentions(
			errorOf(later),
			"campaign.version is " + std::to_string(kSaveVersion + 1) + ", and this build reads version " + std::to_string(kSaveVersion)
		));
	}

	TEST(CampaignJson, ASaveFailsLoudWhenItBreaksTheCampaignsRules) {
		const nlohmann::json save = writeCampaign(campaignOnARun(), testContent());
		const auto			 broken = [&](const auto& change) {
			  nlohmann::json copy = save;
			  change(copy);
			  return errorOf(copy);
		};

		EXPECT_TRUE(
			mentions(broken([](nlohmann::json& json) { json["drivers"][2]["status"] = "dead"; }), "is 0 exactly when the driver is dead")
		);
		EXPECT_TRUE(mentions(broken([](nlohmann::json& json) { json["locker"]["chainsaw"] = 1; }), "names a card no loaded pack defines"));
		EXPECT_TRUE(mentions(broken([](nlohmann::json& json) { json["locker"]["top_off"] = 1; }), "signature card"));
		EXPECT_TRUE(mentions(
			broken([](nlohmann::json& json) { json["run"]["seats"][0]["escortCards"][0]["broughtBy"] = "escort-1"; }),
			"names escort-1, which didn't come along on the run"
		));
		EXPECT_TRUE(mentions(
			broken([](nlohmann::json& json) { json["run"]["seats"][0]["leftHome"]["repair_kit"] = 1; }),
			"is borrowed while the driver's own are left at home"
		));
		EXPECT_TRUE(mentions(broken([](nlohmann::json& json) { json["nextEscortNumber"] = 2; }), "escort-2 is past the counter"));
		EXPECT_TRUE(mentions(
			broken([](nlohmann::json& json) { json["log"][0]["day"] = 5; }), "campaign.log[0].day must be a whole number from 1 to 4"
		));
		EXPECT_TRUE(mentions(
			broken([](nlohmann::json& json) { json["end"] = {{"ending", "starved"}, {"cause", "no_people"}}; }), "is set with a run out"
		));
		EXPECT_TRUE(mentions(broken([](nlohmann::json& json) { json["tally"]["runsHome"] = 1; }), "counts more runs ended"));
		EXPECT_TRUE(mentions(
			broken([](nlohmann::json& json) { json["garage"][0]["card"] = "top_off"; }),
			"which no loaded pack defines as a card a shop sells"
		));
		EXPECT_TRUE(mentions(
			broken([](nlohmann::json& json) { json["run"]["found"][0] = "driver-3"; }),
			"names driver-3, who isn't one of the pool's missing"
		));
		EXPECT_TRUE(mentions(
			broken([](nlohmann::json& json) { json["run"]["recruits"][0] = "war_boy"; }),
			"names driver war_boy, which no loaded pack defines"
		));
	}

	TEST(CampaignJson, WritingACampaignItsOwnSaveCantHoldThrows) {
		Campaign campaign = campaignOnARun();
		campaign.convoy[0].structure = 0;
		EXPECT_THROW((void)writeCampaign(campaign, testContent()), std::logic_error);
	}

} // namespace
