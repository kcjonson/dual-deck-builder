#include "scenes/result/BattleResultScene.h"

#include "Words.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Icons.h"
#include "scenes/result/ResultPage.h"

#include <rules/campaign/Infirmary.h>
#include <rules/campaign/Recruits.h>

#include <nlohmann/json.hpp>

#include <string>
#include <utility>

namespace game {

	namespace {

		using rules::campaign::SeatFate;

		constexpr float kAfterWidth = 560.0F;

	} // namespace

	BattleResultScene::BattleResultScene(BattleResultArgs args)
		: fought(std::move(args)) {}

	const ui::Theme& BattleResultScene::sceneTheme() const {
		return atlas::theme();
	}

	void BattleResultScene::enter() {
		if (!ui().icons().has("shield-mark")) {
			ui().icons().add(icons::iconAtlas());
		}
		Session* session = sessionOrMenu();
		if (session == nullptr) {
			return;
		}
		const rules::campaign::Campaign&	   campaign = session->campaign;
		const rules::Content&				   content = game().rules.content;
		const rules::BattleState&			   state = fought.fight.state;
		const rules::campaign::FightWriteBack& back = fought.back;
		const bool							   won = back.outcome == rules::Outcome::Won;
		if (back.outcome == rules::Outcome::Lost) {
			LOG_ERROR(Game, "BattleResultScene: a lost fight's result is the debrief's");
		}

		const int		   skulls = content.encounters.at(fought.fight.encounter).skulls;
		const result::Page sheet = result::openPage(
			root(),
			{
				.identity = "battle_result",
				.heading = {
					.kicker = std::string(won ? "Fight won" : "Fight broken off") + " \xC2\xB7 " + counted(skulls, "skull", "skulls") +
							  " \xC2\xB7 " + counted(state.turn, "turn", "turns"),
					.title = won ? "The road is clear" : "The raiders broke off",
					.story = won ? "Every raider is down or gone." : "Nothing won; the damage stays with the convoy.",
				},
			}
		);

		ui::Ref<atlas::LegendBox> after = result::box(sheet, "after", "After the fight", kAfterWidth);
		int						  rows = 0;
		const auto				  add = [&](atlas::MapSymbol symbol, const std::string& text, bool warning = false) {
			   result::row(after, "after_" + std::to_string(rows++), symbol, text, warning);
		};
		for (const rules::campaign::SeatWriteBack& seat : back.seats) {
			const rules::campaign::DriverRecord& record = campaign.driver(seat.driver);
			const std::string					 name = rules::campaign::driverName(campaign, content, seat.driver);
			const std::string					 hitpoints =
				std::to_string(record.hitpoints) + " of " + std::to_string(rules::campaign::maxHitpointsOf(content, record)) + " HP";
			if (seat.fate == SeatFate::Revived) {
				add(atlas::MapSymbol::Diamond, name + " went down and was revived, " + hitpoints + ".", true);
			} else if (seat.fate == SeatFate::PickedUp) {
				add(atlas::MapSymbol::Ring, name + " crashed out and was picked up, " + hitpoints + ".");
			}
			if (seat.healed > 0) {
				add(atlas::MapSymbol::Ring, name + " was patched up " + std::to_string(seat.healed) + " HP by the haulers.");
			}
		}
		if (back.dividends != rules::campaign::Resources{}) {
			add(atlas::MapSymbol::Ring, "The haulers paid " + amountsText(back.dividends) + " into the cargo.");
		}
		for (int index = 0; index < static_cast<int>(state.vehicles.size()); ++index) {
			const rules::BattleVehicle& vehicle = state.vehicle(rules::VehicleIndex{index});
			if (vehicle.side == rules::Side::Player && vehicle.escort && vehicle.structure == 0) {
				add(atlas::MapSymbol::Diamond, content.escorts.at(*vehicle.escort).name + " was wrecked and left the convoy.", true);
			}
		}
		if (rows == 0) {
			add(atlas::MapSymbol::Dash, "Everyone drove on as they were.");
		}

		ui::Ref<atlas::AtlasButton> onward = result::highway(sheet, "continue", "Back on the road", [this] { app().scenes().pop(); });
		onward.get()->focus();
	}

	std::string BattleResultScene::exportState() const {
		return nlohmann::json{
			{"outcome", outcomeText(fought.back.outcome)},
			{"turns", fought.fight.state.turn},
			{"escortsLost", fought.back.escortsLost.size()},
		}
			.dump();
	}

} // namespace game
