#include "scenes/event/EventScene.h"

#include "Words.h"
#include "atlas/AtlasButton.h"
#include "atlas/AtlasTheme.h"
#include "atlas/Icons.h"
#include "atlas/LegendBox.h"
#include "atlas/Tokens.h"
#include "cards/Card.h"
#include "scenes/event/ChoiceCard.h"
#include "scenes/event/EventPlate.h"
#include "scenes/event/EventText.h"

#include <rules/campaign/SupplyRun.h>

#include <nlohmann/json.hpp>

#include <array>
#include <stdexcept>
#include <utility>

namespace game {

	namespace {

		namespace styles = atlas::styles::print;
		namespace palette = atlas::tokens::palette;
		using rules::campaign::Campaign;

		constexpr float kJournalSize = 16.0F;
		constexpr float kJournalLine = 1.45F;
		// The foot's least height, which a row of choice cards keeps whatever they hold.
		constexpr float kFootLeast = 196.0F;
		constexpr float kGoWidth = 270.0F;
		// Room round the cards for what they draw past their boxes: the hex, a stack, a count.
		constexpr float kCardMargin = 12.0F;
		constexpr std::array<foundation::Key, 4>
			kChoiceKeys{foundation::Key::Num1, foundation::Key::Num2, foundation::Key::Num3, foundation::Key::Num4};

		ui::Layout column(float gap, float grow = 0.0F) {
			ui::Layout layout{
				.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = gap, .alignItems = ui::AlignItems::Stretch
			};
			layout.flexGrow = grow;
			return layout;
		}

		ui::Layout row(float gap, ui::AlignItems align, float grow = 0.0F) {
			ui::Layout layout{.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = gap, .alignItems = align};
			layout.flexGrow = grow;
			return layout;
		}

		ui::Layout fixed(ui::Layout layout) {
			layout.flexShrink = 0.0F;
			return layout;
		}

	} // namespace

	EventScene::EventScene(EventArgs args)
		: where(std::move(args.where)) {}

	const ui::Theme& EventScene::sceneTheme() const {
		return atlas::theme();
	}

	std::string EventScene::exportState() const {
		return nlohmann::json{
			{"event", definition != nullptr ? nlohmann::json(definition->id.value) : nlohmann::json(nullptr)},
			{"taken", chosen.empty() ? nlohmann::json(nullptr) : nlohmann::json(chosen)},
			{"outcome", taken ? nlohmann::json(taken->outcome) : nlohmann::json(nullptr)},
			{"notice", notice},
		}
			.dump();
	}

	void EventScene::enter() {
		if (!ui().icons().has("food")) {
			ui().icons().add(icons::iconAtlas());
		}
		const Session* session = sessionOrMenu();
		if (session == nullptr) {
			return;
		}
		const Campaign& campaign = session->campaign;
		if (!campaign.run || !campaign.run->route || rules::campaign::ahead(campaign, session->layers()) != rules::campaign::Ahead::Event) {
			LOG_ERROR(Game, "EventScene: the run isn't at an event; back to the road");
			app().scenes().switchTo(scenes::kRun);
			return;
		}
		definition = &rules::campaign::stopEvent(campaign, game().rules.events, session->layers());
		build();
	}

	void EventScene::build() {
		if (sheet.get() != nullptr) {
			root().get()->removeChild(sheet);
		}
		ui::Layout sheetLayout = column(16.0F);
		sheetLayout.padding = ui::Edges(40.0F, 48.0F, 46.0F, 46.0F);
		sheet = root().addChild<atlas::Sheet>({
			.id = "sheet",
			.size = {ui::percent(100.0F), ui::percent(100.0F)},
			.layout = sheetLayout,
			.onKeyDown = [this](ui::KeyEvent& key) { keys(key); },
			.identity = "event",
		});

		ui::Ref<ui::Component> top =
			sheet.addChild<ui::Component>({.id = "top", .minSize = {0.0F, 0.0F}, .layout = row(24.0F, ui::AlignItems::Stretch, 1.0F)});
		ui::Ref<ui::Component> plate = top.addChild<ui::Component>({
			.id = "plate_column",
			.size = {0.0F, ui::kAuto},
			.minSize = {0.0F, 0.0F},
			.layout = column(8.0F, 3.0F),
		});
		plate.addChild<event::EventPlate>(
			{.id = "plate", .minSize = {0.0F, 120.0F}, .layout = {.flexGrow = 1.0F}, .stopType = definition->stopType}
		);
		plate.addChild<ui::Text>({
			.id = "plate_caption",
			.layout = {.flexShrink = 0.0F},
			.style = styles::kicker,
			.text = "Plate \xC2\xB7 " + definition->caption,
			.wrap = true,
		});

		ui::Ref<ui::Component> journal = top.addChild<ui::Component>({
			.id = "journal",
			.size = {0.0F, ui::kAuto},
			.minSize = {0.0F, 0.0F},
			.layout = column(10.0F, 4.0F),
		});
		ui::Ref<ui::Component> head = journal.addChild<ui::Component>({.id = "head", .layout = fixed(row(16.0F, ui::AlignItems::Start))});
		ui::Ref<ui::Component> titles = head.addChild<ui::Component>({
			.minSize = {0.0F, 0.0F},
			.layout = [] {
				ui::Layout layout = column(4.0F, 1.0F);
				layout.flexShrink = 1.0F;
				return layout;
			}(),
		});
		titles.addChild<ui::Text>({
			.id = "kicker",
			.style = styles::kicker,
			.text = event::kicker(definition->stopType) + (where.empty() ? std::string() : " \xC2\xB7 " + where),
			.wrap = true,
		});
		titles.addChild<ui::Text>({.id = "title", .style = styles::screenTitle, .text = definition->title, .wrap = true});
		if (!taken) {
			head.addChild<atlas::AtlasButton>({
				.id = "back_to_road",
				.layout = {.flexShrink = 0.0F},
				.label = "Back to the road",
				.onPress = [this] { finish(EventNext::Back); },
			});
		}
		ui::Ref<event::JournalPage> page = journal.addChild<event::JournalPage>({
			.id = "journal_page",
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F},
			.overflow = ui::Overflow::Scroll,
			.pitch = kJournalSize * kJournalLine,
			.identity = "event/journal",
		});
		const ui::Style				words = styles::body.extend({.fontSize = kJournalSize, .lineHeight = kJournalLine});
		page.addChild<ui::Text>({.id = "setup", .style = words, .text = definition->setup, .wrap = true});
		page.addChild<ui::Text>({.id = "situation", .style = words, .text = definition->situation, .wrap = true});

		ui::Ref<ui::Component> foot = sheet.addChild<ui::Component>(
			{.id = "foot", .minSize = {0.0F, kFootLeast}, .layout = fixed(row(14.0F, ui::AlignItems::Stretch))}
		);
		if (taken) {
			outcome(foot);
		} else {
			choices(foot);
		}
	}

	void EventScene::choices(ui::Ref<ui::Component> foot) {
		const Session&		   session = *game().session;
		const GameRules&	   loaded = game().rules;
		ui::Ref<ui::Component> group = foot.addChild<ui::Component>({
			.id = "choices",
			.minSize = {0.0F, 0.0F},
			.layout = row(14.0F, ui::AlignItems::Stretch, 1.0F),
			.focusGroup = ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Horizontal},
		});
		ui::Component*		   first = nullptr;
		for (size_t place = 0; place < definition->choices.size(); ++place) {
			const rules::campaign::EventChoice&					choice = definition->choices[place];
			const std::optional<rules::campaign::ChoiceBlocker> blocked =
				rules::campaign::choiceBlocker(session.campaign, loaded.events, session.layers(), choice.id);
			const event::Lock		   lock = !blocked													? event::Lock::Open
											  : blocked->reason == rules::campaign::ChoiceRefusal::Cost ? event::Lock::Short
																										: event::Lock::Need;
			ui::Ref<event::ChoiceCard> card = group.addChild<event::ChoiceCard>({
				.id = "choice_" + choice.id,
				.enabled = !blocked,
				.size = {0.0F, ui::kAuto},
				.minSize = {0.0F, kFootLeast},
				.layout = {.flexGrow = 1.0F},
				.focusable = true,
				.title = choice.title,
				.preview = choice.preview,
				.band = event::bandText(choice, blocked, loaded.content),
				.hotkey = std::to_string(place + 1),
				.lock = lock,
				.icons = event::choiceIcons(choice),
				.onPress = [this, id = choice.id] { take(id); },
			});
			if (first == nullptr && !blocked) {
				first = card.get();
			}
		}
		if (first != nullptr) {
			first->focus();
		}
	}

	void EventScene::outcome(ui::Ref<ui::Component> foot) {
		const GameRules&					 loaded = game().rules;
		const rules::campaign::EventChoice&	 choice = rules::campaign::choiceOf(*definition, chosen);
		const rules::campaign::EventOutcome& landed = choice.outcomes.at(static_cast<size_t>(taken->outcome));
		const ui::Theme&					 theme = ui().getTheme();

		ui::Ref<atlas::LegendBox> box = foot.addChild<atlas::LegendBox>({
			.id = "outcome",
			.size = {0.0F, ui::kAuto},
			.minSize = {0.0F, 0.0F},
			.layout = {.flexGrow = 1.0F},
			.style = {.backgroundColor = theme.get(palette::freshPaper)},
			.look = {.seed = atlas::paperSeed("event/outcome"), .wear = atlas::Wear::Clean},
			.title = choice.title,
		});
		box.addChild<ui::Text>({.id = "outcome_text", .style = styles::body, .text = landed.text, .wrap = true});
		const std::vector<event::LedgerLine> lines = event::resultLines(choice, landed, loaded.content, taken->recruits);
		if (!lines.empty()) {
			ui::Ref<ui::Component> ledger = box.addChild<ui::Component>({.id = "ledger", .layout = column(4.0F)});
			for (size_t index = 0; index < lines.size(); ++index) {
				const event::LedgerLine& line = lines[index];
				const std::string		 id = "ledger_" + std::to_string(index);
				ui::Ref<ui::Component>	 entry = ledger.addChild<ui::Component>({.id = id, .layout = row(8.0F, ui::AlignItems::Center)});
				entry.addChild<event::IconView>({.id = id + "_icon", .layout = {.flexShrink = 0.0F}, .icon = line.icon, .tone = line.tone});
				entry.addChild<ui::Text>({
					.id = id + "_text",
					.minSize = {0.0F, 0.0F},
					.layout = {.flexGrow = 1.0F, .flexShrink = 1.0F},
					.style = line.tone == event::Tone::Cost	  ? styles::warning
							 : line.tone == event::Tone::Gain ? styles::body.extend({.color = theme.get(palette::sage)})
															  : styles::body,
					.text = line.text,
					.wrap = true,
				});
			}
		}
		if (!notice.empty()) {
			box.addChild<ui::Text>({.id = "notice", .style = styles::warning, .text = notice, .wrap = true});
		}

		// The cards it gave, as cards, riding home for the locker.
		if (!landed.gains.cards.empty()) {
			ui::Ref<atlas::LegendBox> given = foot.addChild<atlas::LegendBox>({
				.id = "given",
				.layout = {.flexShrink = 0.0F},
				.look = {.seed = atlas::paperSeed("event/given"), .grab = atlas::Corner::BottomLeft},
				.title = "For the locker",
			});
			ui::Ref<ui::Component>	  shelf = given.addChild<ui::Component>({.id = "given_cards", .layout = [] {
																				 ui::Layout layout = fixed(row(12.0F, ui::AlignItems::Start));
																				 layout.padding = ui::Edges(kCardMargin);
																				 return layout;
																			 }()});
			for (const auto& [card, copies] : landed.gains.cards) {
				shelf.addChild<cards::Card>({
					.id = "given_" + card.value,
					.focusable = true,
					.card = &loaded.content.cards.at(card),
					.cardSize = cards::CardSize::Mini,
					.copies = copies,
				});
			}
		}

		const EventNext		   next = taken->fight ? EventNext::Fight : !taken->reward.empty() ? EventNext::PickCard : EventNext::DriveOn;
		ui::Ref<ui::Component> go = foot.addChild<ui::Component>({
			.id = "go",
			.size = {kGoWidth, ui::kAuto},
			.layout = [] {
				ui::Layout layout = fixed(column(8.0F));
				layout.justifyContent = ui::JustifyContent::End;
				return layout;
			}(),
		});
		ui::Ref<atlas::AtlasButton> button = go.addChild<atlas::AtlasButton>({
			.id = "event_go",
			.label = event::goLabel(landed),
			.road = atlas::Road::Highway,
			.shield = true,
			.onPress = [this, next] { finish(next); },
		});
		if (ui::Component* shown = button.get()) {
			shown->focus();
		}
	}

	void EventScene::take(const std::string& choice) {
		if (taken || definition == nullptr) {
			return;
		}
		Session&		 session = *game().session;
		const GameRules& loaded = game().rules;
		if (rules::campaign::choiceBlocker(session.campaign, loaded.events, session.layers(), choice)) {
			return;
		}
		try {
			taken = rules::campaign::takeEventChoice(
				session.campaign, loaded.content, loaded.campaign, loaded.events, session.layers(), loaded.unlocked, choice
			);
		} catch (const std::invalid_argument& error) {
			// The page offers only what the rules allow, so a refusal here is a bug.
			LOG_ERROR(Game, "EventScene: the rules refused a choice the page offered: %s", error.what());
			return;
		}
		chosen = choice;
		if (!game().store.save(session.campaign)) {
			notice = "The campaign couldn't be saved.";
		}
		build();
	}

	void EventScene::keys(ui::KeyEvent& key) {
		if (key.type != ui::KeyEvent::Type::Down || key.repeat || key.mods != 0 || taken || definition == nullptr) {
			return;
		}
		for (size_t place = 0; place < kChoiceKeys.size() && place < definition->choices.size(); ++place) {
			if (key.key == kChoiceKeys.at(place)) {
				key.consume();
				take(definition->choices[place].id);
				return;
			}
		}
	}

} // namespace game
