#include "scenes/crew/CustomizeScene.h"

#include "Words.h"
#include "atlas/AtlasButton.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Icons.h"
#include "atlas/LegendBox.h"
#include "atlas/Sheet.h"
#include "atlas/Tokens.h"
#include "cards/DriverCard.h"

#include <rules/campaign/Locker.h>
#include <rules/campaign/RunDecks.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <utility>
#include <vector>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;
		using rules::campaign::Campaign;
		using rules::campaign::CardMove;
		using rules::campaign::RunDeck;
		using rules::campaign::RunDeckCopies;

		constexpr float kSideWidth = 200.0F;

		// Whether the run deck differs from the default deck it was dealt (customize-screen.md, the CUSTOM tag's test).
		bool customized(const RunDeck& deck) {
			return !deck.leftHome.empty() || !deck.borrowed.empty();
		}

		// Under the driver card: whether the run deck is still the default deck, and how it differs if not.
		std::string runDeckNote(const RunDeck& deck) {
			if (!customized(deck)) {
				return "Same as the default deck. Change anything here and it applies to this run only.";
			}
			std::vector<std::string> changes;
			if (const int home = rules::campaign::totalCards(deck.leftHome); home > 0) {
				changes.push_back(counted(home, "card", "cards") + " left at home");
			}
			if (const int borrowed = rules::campaign::totalCards(deck.borrowed); borrowed > 0) {
				changes.push_back(std::to_string(borrowed) + " borrowed");
			}
			std::string joined;
			for (const std::string& change : changes) {
				joined += (joined.empty() ? "" : ", ") + change;
			}
			return "For this run only: " + joined + ". The default deck stays as it is.";
		}

	} // namespace

	CustomizeScene::CustomizeScene(CustomizeArgs args)
		: driver(std::move(args.driver)) {}

	const ui::Theme& CustomizeScene::sceneTheme() const {
		return atlas::theme();
	}

	void CustomizeScene::enter() {
		if (!ui().icons().has("food")) {
			ui().icons().add(icons::iconAtlas());
		}
		if (sessionOrMenu() == nullptr) {
			return;
		}
		build();
		if (ui::Component* doneButton = crew::findUnder(ui(), sheet.get(), "done")) {
			doneButton->focus();
		}
	}

	std::string CustomizeScene::exportState() const {
		if (!game().session) {
			return "null";
		}
		const RunDeck* deck = game().session->campaign.runDeckOf(driver);
		nlohmann::json counts = nlohmann::json::object();
		if (deck != nullptr) {
			for (const auto& [name, cards] : {std::pair{"own", &deck->own}, {"borrowed", &deck->borrowed}, {"leftHome", &deck->leftHome}}) {
				nlohmann::json side = nlohmann::json::object();
				for (const auto& [card, count] : *cards) {
					side[card.value] = count;
				}
				counts[name] = side;
			}
		}
		return nlohmann::json{{"driver", driver.value}, {"seated", deck != nullptr}, {"deck", counts}, {"notice", notice}}.dump();
	}

	void CustomizeScene::build() {
		const Campaign&	  campaign = game().session->campaign;
		const std::string focused = ui().focused().get() != nullptr ? ui().focused().get()->getId() : std::string();
		if (sheet.get() != nullptr) {
			root().get()->removeChild(sheet);
		}
		ui::Layout sheetLayout = crew::column(10.0F);
		sheetLayout.padding = ui::Edges(40.0F, 48.0F, 50.0F, 46.0F);
		sheet = root().addChild<atlas::Sheet>({
			.id = "sheet",
			.size = {ui::percent(100.0F), ui::percent(100.0F)},
			.layout = sheetLayout,
			.onKeyDown = [this](ui::KeyEvent& event) { keys(event); },
			.identity = "customize",
		});
		heading(campaign);
		if (!notice.empty()) {
			sheet.addChild<ui::Text>({.id = "notice", .style = styles::warning, .text = notice});
		}
		if (campaign.runDeckOf(driver) == nullptr) {
			sheet.addChild<ui::Text>({
				.id = "not_seated",
				.style = styles::quiet,
				.text = campaign.run ? "This driver isn't seated on the run." : "No run is out, so there's no run deck to change.",
				.wrap = true,
			});
			return;
		}
		ui::Ref<ui::Component> body = sheet.addChild<ui::Component>({
			.id = "body",
			.minSize = {0.0F, 0.0F},
			.layout = crew::grown(crew::row(12.0F, ui::AlignItems::Stretch)),
		});
		driverColumn(body, campaign);
		runDeck(body, campaign);
		locker(body, campaign);
		crew::refocus(ui(), sheet.get(), focused, {"done"});
	}

	void CustomizeScene::heading(const Campaign& /*campaign*/) {
		ui::Ref<ui::Component> row = sheet.addChild<ui::Component>({.layout = crew::fixed(crew::row(16.0F))});
		ui::Ref<ui::Component> words =
			row.addChild<ui::Component>({.minSize = {0.0F, 0.0F}, .layout = crew::grown(crew::row(16.0F, ui::AlignItems::End))});
		words.addChild<ui::Text>({.id = "title", .style = styles::screenTitle, .text = "Customize"});
		words.addChild<ui::Text>({
			.id = "subtitle",
			.layout = {.flexShrink = 1.0F},
			.style = styles::subtitle,
			.text = "Changes last for this run only / default deck unchanged",
			.wrap = true,
		});
		row.addChild<atlas::AtlasButton>({
			.id = "done",
			.layout = crew::fixed({}),
			.label = "Done",
			.road = atlas::Road::Highway,
			.shield = true,
			.onPress = [this] { done(); },
		});
	}

	void CustomizeScene::driverColumn(ui::Ref<ui::Component> body, const Campaign& campaign) {
		const GameRules&					 loaded = game().rules;
		const RunDeck&						 deck = *campaign.runDeckOf(driver);
		const auto							 seatAt = std::ranges::find(campaign.run->seats, driver, &RunDeck::driver);
		const int							 seat = static_cast<int>(seatAt - campaign.run->seats.begin());
		const int							 seats = static_cast<int>(campaign.run->seats.size());
		const RunDeck*						 partner = seats == 2 ? &campaign.run->seats.at(static_cast<size_t>(1 - seat)) : nullptr;
		const rules::campaign::DriverRecord& record = campaign.driver(driver);

		ui::Ref<atlas::LegendBox> box = body.addChild<atlas::LegendBox>({
			.id = "side",
			.size = {kSideWidth, ui::kAuto},
			.minSize = {0.0F, 0.0F},
			.layout = crew::fixed({}),
			.look = {.seed = atlas::paperSeed("customize/" + driver.value), .grab = atlas::Corner::BottomLeft},
			.title = "Driver " + std::to_string(seat + 1) + " of " + std::to_string(seats),
		});
		ui::Ref<ui::Component>	  scroll = box.addChild<ui::Component>({
			   .id = "side_scroll",
			   .size = {ui::kAuto, 0.0F},
			   .minSize = {0.0F, 0.0F},
			   .layout = crew::grown(crew::column(10.0F)),
			   .overflow = ui::Overflow::Scroll,
		   });
		cards::DriverFace		  face = cards::driverFace(campaign, loaded.content, record);
		face.tag.clear(); // the column's title says the seat
		ui::Ref<ui::Component> cardRow = scroll.addChild<ui::Component>({.layout = crew::row(0.0F)});
		cardRow.addChild<cards::DriverCard>({.id = "driver_card", .margin = ui::Edges(8.0F, 0.0F, 0.0F, 4.0F), .face = face});
		scroll.addChild<ui::Text>(
			{.id = "vehicle", .style = styles::body, .text = loaded.content.drivers.at(record.archetype).vehicle.name}
		);
		scroll.addChild<ui::Text>({.id = "deck_note", .style = styles::note, .text = runDeckNote(deck), .wrap = true});
		scroll.addChild<atlas::AtlasButton>({
			.id = "reset",
			.enabled = customized(deck),
			.label = "Reset to default",
			.onPress = [this] { step([this](Campaign& played) { rules::campaign::resetRunDeck(played, driver); }); },
		});

		scroll.addChild<ui::Text>({.id = "escort_kicker", .style = styles::kicker, .text = "Escort cards"});
		std::vector<crew::CardEntry> escorts;
		for (const rules::campaign::EscortCard& escort : deck.escortCards) {
			crew::CardEntry entry{
				.key = escort.broughtBy.value,
				.card = &loaded.content.cards.at(escort.card),
				.state = cards::MiniState::Locked,
			};
			if (partner != nullptr) {
				entry.controls.push_back({
					.key = "give",
					.label = "Give to driver " + std::to_string(2 - seat),
					.run = [this, escort = escort.broughtBy, to = partner->driver] {
						step([escort, to](Campaign& played) { rules::campaign::moveEscortCard(played, escort, to); });
					},
				});
			}
			escorts.push_back(std::move(entry));
		}
		if (escorts.empty()) {
			scroll.addChild<ui::Text>({.id = "escort_none", .style = styles::quiet, .text = "None in this run deck.", .wrap = true});
		} else {
			crew::cardGrid(scroll, {.id = "escort_cards", .entries = std::move(escorts), .seat = seat});
			scroll.addChild<ui::Text>(
				{.id = "escort_note", .style = styles::note, .text = "Locked, and outside the size limit.", .wrap = true}
			);
		}
	}

	crew::EntryControl CustomizeScene::move(const std::string& key, const std::string& label, const CardMove& made) {
		const GameRules&								  loaded = game().rules;
		const Campaign&									  campaign = game().session->campaign;
		const std::optional<rules::campaign::CardBlocker> blocker =
			rules::campaign::cardMoveBlocker(campaign, loaded.content, loaded.campaign.deck, made);
		// The run deck has no such copy to move: the stack's own count says so, and the line stays for a reason.
		const bool quiet = blocker && blocker->reason == rules::campaign::CardRefusal::TooFew &&
						   (made.copies == RunDeckCopies::Own || made.copies == RunDeckCopies::Home);
		crew::EntryControl control{.key = key, .label = label, .off = blocker.has_value()};
		if (blocker && !quiet) {
			control.reason = cardRefusalText(campaign, *blocker, loaded.content);
		}
		control.run = [this, made] {
			step([this, made](Campaign& played) {
				rules::campaign::moveCards(played, game().rules.content, game().rules.campaign.deck, made);
			});
		};
		return control;
	}

	void CustomizeScene::runDeck(ui::Ref<ui::Component> body, const Campaign& campaign) {
		const GameRules& loaded = game().rules;
		const RunDeck&	 deck = *campaign.runDeckOf(driver);
		const int seat = static_cast<int>(std::ranges::find(campaign.run->seats, driver, &RunDeck::driver) - campaign.run->seats.begin());
		ui::Ref<atlas::LegendBox> box = body.addChild<atlas::LegendBox>({
			.id = "run_deck",
			.size = {0.0F, ui::kAuto},
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F},
			.look = {.seed = atlas::paperSeed("customize/run_deck"), .grab = atlas::Corner::BottomRight},
		});
		ui::Layout				  chipsLayout = crew::row(8.0F);
		chipsLayout.flexWrap = ui::FlexWrap::Wrap;
		ui::Ref<ui::Component> chips = box.addChild<ui::Component>({.id = "run_deck_chips", .layout = crew::fixed(chipsLayout)});
		crew::chip(
			chips,
			"run_deck_size",
			"RUN DECK " + std::to_string(rules::campaign::totalCards(rules::campaign::runDeckCards(deck))) + "/" +
				std::to_string(loaded.campaign.deck.mostCards)
		);
		crew::chip(chips, "run_deck_borrowed", "BORROWED " + std::to_string(rules::campaign::totalCards(deck.borrowed)));
		crew::chip(chips, "run_deck_home", "LEFT HOME " + std::to_string(rules::campaign::totalCards(deck.leftHome)));
		box.addChild<ui::Text>({.id = "run_deck_kicker", .style = styles::kicker, .text = "Run deck / hover a card for its detail view"});

		const rules::campaign::RunDeckOf here{driver};
		std::vector<crew::CardEntry>	 entries;
		const auto						 stack = [&](const rules::CardId& card,
								 int				  copies,
								 const std::string&	  key,
								 cards::MiniState	  state,
								 RunDeckCopies		  fewer,
								 RunDeckCopies		  more) {
			  entries.push_back({
									  .key = key,
									  .card = &loaded.content.cards.at(card),
									  .copies = copies,
									  .state = state,
									  .controls = {
					  move("fewer", "-", {.card = card, .from = here, .to = rules::campaign::Locker{}, .copies = fewer}),
					  move("more", "+", {.card = card, .from = rules::campaign::Locker{}, .to = here, .copies = more})
				  },
			  });
		};
		for (const auto& [card, copies] : deck.own) {
			stack(card, copies, card.value, cards::MiniState::None, RunDeckCopies::Own, RunDeckCopies::Home);
		}
		for (const auto& [card, copies] : deck.borrowed) {
			stack(card, copies, card.value + "-borrowed", cards::MiniState::Borrowed, RunDeckCopies::Borrowed, RunDeckCopies::Borrowed);
		}
		for (const auto& [card, copies] : deck.leftHome) {
			stack(card, copies, card.value + "-home", cards::MiniState::Home, RunDeckCopies::Own, RunDeckCopies::Home);
		}
		crew::sortEntries(entries);
		ui::Ref<ui::Component> scroll = box.addChild<ui::Component>({
			.id = "run_deck_scroll",
			.size = {ui::kAuto, 0.0F},
			.minSize = {0.0F, 0.0F},
			.layout = crew::grown(crew::column(0.0F)),
			.overflow = ui::Overflow::Scroll,
		});
		crew::cardGrid(scroll, {.id = "deck", .entries = std::move(entries), .seat = seat});
		box.addChild<ui::Text>({
			.id = "run_deck_foot",
			.style = styles::note,
			.text = "Borrowed cards come back with the driver. If the driver dies, they're lost with the deck.",
			.wrap = true,
		});
	}

	void CustomizeScene::locker(ui::Ref<ui::Component> body, const Campaign& campaign) {
		const GameRules&		  loaded = game().rules;
		const rules::DriverId&	  archetype = campaign.driver(driver).archetype;
		ui::Ref<atlas::LegendBox> box = body.addChild<atlas::LegendBox>({
			.id = "locker",
			.size = {0.0F, ui::kAuto},
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F},
			.look = {.seed = atlas::paperSeed("customize/locker"), .grab = atlas::Corner::TopRight},
			.title = "Locker",
		});
		box.addChild<ui::Text>({
			.id = "locker_kicker",
			.style = styles::kicker,
			.text = campaign.run->seats.size() == 2 ? "Copies the other seat hasn't borrowed" : "Spare copies, free to borrow",
		});
		crew::kindFilter(
			box,
			"locker_filter",
			filter,
			[this](crew::CardKind kind) {
				filter = kind;
				build();
			},
			"customize/locker_filter"
		);
		std::vector<crew::CardEntry> entries;
		for (const auto& [card, copies] : campaign.locker) {
			const rules::CardDefinition& definition = loaded.content.cards.at(card);
			if (!crew::passesFilter(definition, filter)) {
				continue;
			}
			entries.push_back({
				.key = card.value,
				.card = &definition,
				.copies = copies,
				.state = definition.driverRestriction && *definition.driverRestriction != archetype ? cards::MiniState::Unavailable
																									: cards::MiniState::None,
				.controls = {move(
					"borrow",
					"Borrow",
					{.card = card,
					 .from = rules::campaign::Locker{},
					 .to = rules::campaign::RunDeckOf{driver},
					 .copies = RunDeckCopies::Borrowed}
				)},
			});
		}
		crew::sortEntries(entries);
		ui::Ref<ui::Component> scroll = box.addChild<ui::Component>({
			.id = "locker_scroll",
			.size = {ui::kAuto, 0.0F},
			.minSize = {0.0F, 0.0F},
			.layout = crew::grown(crew::column(0.0F)),
			.overflow = ui::Overflow::Scroll,
		});
		if (entries.empty()) {
			scroll.addChild<ui::Text>({
				.id = "locker_empty",
				.style = styles::quiet,
				.text = campaign.locker.empty() ? "Nothing in the locker is free to borrow." : "Nothing of that kind in the locker.",
				.wrap = true,
			});
		} else {
			crew::cardGrid(scroll, {.id = "locker", .entries = std::move(entries)});
		}
	}

	void CustomizeScene::keys(ui::KeyEvent& event) {
		if (event.type == ui::KeyEvent::Type::Cancel) {
			done();
			event.consume();
		}
	}

	void CustomizeScene::done() {
		finish(CustomizeDone{});
	}

	template <typename Action>
	void CustomizeScene::step(Action&& action) {
		Campaign& campaign = game().session->campaign;
		action(campaign);
		notice = game().store.save(campaign) ? std::string() : std::string("The campaign couldn't be saved.");
		build();
	}

} // namespace game
