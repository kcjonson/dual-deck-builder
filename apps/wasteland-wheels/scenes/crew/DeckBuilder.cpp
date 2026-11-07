#include "scenes/crew/DeckBuilder.h"

#include "atlas/AtlasButton.h"
#include "atlas/Highlighter.h"
#include "atlas/Ink.h"
#include "atlas/Paper.h"
#include "atlas/Tokens.h"
#include "cards/CardStyle.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <ui/components/Control.h>
#include <ui/shapes/Rectangle.h>
#include <ui/shapes/Text.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <utility>

namespace game::crew {

	namespace {

		namespace styles = atlas::styles::print;
		namespace palette = atlas::tokens::palette;

		// An entry is wide enough for two compact controls side by side, "Add" and "Confirm", and the longest reason on two
		// lines; minis in a grid sit at least kGridGap apart.
		constexpr float kEntryWidth = 108.0F;
		constexpr float kEntryGap = cards::mini::kGridGap - (kEntryWidth - cards::mini::kSize.x);
		constexpr float kCurveHeight = 36.0F;

		constexpr std::array<std::pair<CardKind, const char*>, 5> kKinds{{
			{CardKind::All, "All"},
			{CardKind::Attack, "Attack"},
			{CardKind::Defense, "Defense"},
			{CardKind::Utility, "Utility"},
			{CardKind::Order, "Order"},
		}};

		// One of the filter's tabs: its label in display capitals, marked in highlighter while it's the one chosen.
		class KindTab : public ui::Control {
		  public:
			struct Args {
				UI_COMMON_ARGS
				std::string			  label;
				bool				  chosen = false;
				std::string			  identity;
				std::function<void()> onPress;
			};

			explicit KindTab(const Args& args)
				: label(args.label),
				  chosen(args.chosen),
				  seed(atlas::paperSeed(args.identity)),
				  onPress(args.onPress) {}

			[[nodiscard]] const char* typeName() const override { return "KindTab"; }
			[[nodiscard]] float		  inkExtent() const override { return 5.0F; }

			void describe(nlohmann::json& node) const override {
				ui::Control::describe(node);
				node["label"] = label;
				node["chosen"] = chosen;
			}

		  protected:
			void onMount() override {
				ui::Control::onMount();
				ui::Layout layout = row(0.0F);
				layout.justifyContent = ui::JustifyContent::Center;
				layout.padding = ui::Edges(0.0F, 12.0F);
				setLayout(layout);
				setMinSize({0.0F, 32.0F});
				addChild<ui::Text>({
					.id = getId().empty() ? std::string() : getId() + "_label",
					.style = chosen ? styles::sectionTabActive : styles::sectionTab,
					.text = label,
				});
			}

			void render() override {
				const ui::Theme&		   theme = getContext()->getTheme();
				const int32_t			   key = drawKey();
				const ui::InteractionState state = interaction();
				if (chosen) {
					atlas::drawHighlight({
						.bounds = {2.0F, 3.0F, size.x - 4.0F, size.y - 6.0F},
						.highlighter = theme.get(palette::highlighter),
						.seed = seed,
						.key = key,
					});
				}
				if (state.hovered || state.focusVisible) {
					const float reach = state.focusVisible ? 3.0F : 0.0F;
					Renderer::Primitives::drawRect({
						.bounds = {-reach, -reach, size.x + reach * 2.0F, size.y + reach * 2.0F},
						.style =
							{.fill = Foundation::Color(0.0F, 0.0F, 0.0F, 0.0F),
							 .border =
								 Foundation::BorderStyle{
									 .color = theme.get(palette::ink),
									 .width = state.focusVisible ? 2.0F : 1.0F,
									 .position = Foundation::BorderPosition::Inside
								 }},
						.key = key,
					});
				}
			}

			void activate() override {
				if (onPress) {
					onPress();
				}
			}

		  private:
			std::string			  label;
			bool				  chosen;
			uint32_t			  seed;
			std::function<void()> onPress;
		};

		void entryOf(ui::Ref<ui::Component> grid, const GridSpec& spec, const CardEntry& entry) {
			const std::string	   id = spec.id + "_" + entry.key;
			ui::Ref<ui::Component> box = grid.addChild<ui::Component>({
				.id = id + "_entry",
				.size = {kEntryWidth, ui::kAuto},
				.layout = fixed(column(6.0F, ui::AlignItems::Center)),
			});
			box.addChild<cards::Card>({
				.id = id,
				.card = entry.card,
				.cardSize = cards::CardSize::Mini,
				.seat = spec.seat,
				.copies = entry.copies,
				.state = entry.state,
			});
			if (entry.controls.empty()) {
				return;
			}
			ui::Ref<ui::Component>	   controls = box.addChild<ui::Component>({
					.id = id + "_controls",
					.size = {ui::percent(100.0F), ui::kAuto},
					.margin = ui::Edges(cards::mini::kInk + 1.0F, 0.0F, 0.0F, 0.0F),
					.layout = row(4.0F, ui::AlignItems::Stretch),
			});
			std::optional<std::string> said;
			bool					   warning = false;
			for (const EntryControl& control : entry.controls) {
				const std::string controlId = id + "_" + control.key;
				const bool		  armed = control.destructive && spec.armed != nullptr && spec.armed->control == controlId;
				const bool		  off = control.off || control.reason.has_value();
				if (armed) {
					said = "Press again to scrap";
					warning = true;
				} else if (control.reason && !said) {
					said = control.reason;
				}
				controls.addChild<atlas::AtlasButton>({
					.id = controlId,
					.enabled = !off,
					.layout = {.flexGrow = 1.0F},
					.label = armed ? std::string("Confirm") : control.label,
					.compact = true,
					.onPress = [armedNow = spec.armed, arm = spec.arm, run = control.run, destructive = control.destructive, controlId] {
						if (!destructive) {
							run();
							return;
						}
						if (armedNow != nullptr && armedNow->control == controlId) {
							if (armedNow->seconds >= kArmGuard) {
								run();
							}
							return;
						}
						arm(controlId);
					},
				});
			}
			if (said) {
				box.addChild<ui::Text>({
					.id = id + "_reason",
					.size = {ui::percent(100.0F), ui::kAuto},
					.style = (warning ? styles::warning : styles::note)
								 .extend({.fontSize = 12.0F, .textAlign = Foundation::HorizontalAlign::Center}),
					.text = *said,
					.wrap = true,
				});
			}
		}

	} // namespace

	void sortEntries(std::vector<CardEntry>& entries) {
		std::ranges::sort(entries, [](const CardEntry& a, const CardEntry& b) {
			if (a.card->cost != b.card->cost) {
				return a.card->cost < b.card->cost;
			}
			if (a.card->name != b.card->name) {
				return a.card->name < b.card->name;
			}
			return a.key < b.key;
		});
	}

	CardKind cardKind(const rules::CardDefinition& card) {
		const std::string_view first = card.tags.empty() ? std::string_view() : std::string_view(card.tags.front());
		if (first == "attack" || first == "power") {
			return CardKind::Attack;
		}
		if (first == "defense") {
			return CardKind::Defense;
		}
		if (first == "order") {
			return CardKind::Order;
		}
		return CardKind::Utility;
	}

	bool passesFilter(const rules::CardDefinition& card, CardKind filter) {
		return filter == CardKind::All || cardKind(card) == filter;
	}

	ui::Ref<ui::Component> cardGrid(ui::Ref<ui::Component> parent, const GridSpec& spec) {
		ui::Layout layout = row(kEntryGap, ui::AlignItems::Start);
		layout.flexWrap = ui::FlexWrap::Wrap;
		layout.padding = ui::Edges(cards::mini::kInk + 2.0F);
		ui::Ref<ui::Component> grid = parent.addChild<ui::Component>({
			.id = spec.id,
			.layout = layout,
			.focusGroup = ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Both},
		});
		for (const CardEntry& entry : spec.entries) {
			entryOf(grid, spec, entry);
		}
		return grid;
	}

	ui::Ref<ui::Component> kindFilter(
		ui::Ref<ui::Component>		  parent,
		const std::string&			  id,
		CardKind					  chosen,
		std::function<void(CardKind)> choose,
		std::string_view			  identity
	) {
		ui::Layout bar = row(0.0F, ui::AlignItems::Stretch);
		bar.padding = ui::Edges(2.0F);
		ui::Ref<atlas::Paper> filter = parent.addChild<atlas::Paper>({
			.id = id,
			.layout = fixed(bar),
			.style = {.backgroundColor = parent.get()->getContext()->getTheme().get(palette::index)},
			.focusGroup = ui::FocusGroup{.orientation = ui::FocusGroup::Orientation::Horizontal},
			.look = {.seed = atlas::paperSeed(identity), .wear = atlas::Wear::Clean},
		});
		for (const auto& [kind, name] : kKinds) {
			filter.addChild<KindTab>({
				.id = id + "_" + std::string(name),
				.label = name,
				.chosen = kind == chosen,
				.identity = std::string(identity) + "/" + name,
				.onPress = [choose, kind] { choose(kind); },
			});
		}
		return filter;
	}

	ui::Ref<ui::Component> chip(ui::Ref<ui::Component> parent, const std::string& id, const std::string& text) {
		const ui::Theme& theme = parent.get()->getContext()->getTheme();
		ui::Layout		 layout = row(0.0F);
		layout.padding = ui::Edges(3.0F, 8.0F);
		ui::Ref<atlas::Paper> box = parent.addChild<atlas::Paper>({
			.id = id,
			.layout = fixed(layout),
			.style = {.backgroundColor = theme.get(palette::freshPaper), .borderColor = theme.get(palette::ink), .borderWidth = 1.0F},
			.look = {.seed = atlas::paperSeed(id), .wear = atlas::Wear::Clean},
		});
		box.addChild<ui::Text>({.id = id + "_text", .style = styles::figure.extend({.fontSize = 13.0F}), .text = text});
		return box;
	}

	ui::Ref<ui::Component> costCurve(ui::Ref<ui::Component> parent, const std::string& id, const std::array<int, 4>& counts) {
		const ui::Theme&	   theme = parent.get()->getContext()->getTheme();
		const int			   most = std::max(1, *std::ranges::max_element(counts));
		ui::Ref<ui::Component> curve = parent.addChild<ui::Component>({.id = id, .layout = fixed(row(10.0F, ui::AlignItems::End))});
		constexpr std::array<const char*, 4> kCosts{"0", "1", "2", "3+"};
		for (size_t cost = 0; cost < counts.size(); ++cost) {
			ui::Ref<ui::Component> bar = curve.addChild<ui::Component>({.layout = column(2.0F, ui::AlignItems::Center)});
			bar.addChild<ui::Text>(
				{.id = id + "_count_" + std::to_string(cost), .style = styles::caption, .text = std::to_string(counts.at(cost))}
			);
			const float height = std::max(1.0F, kCurveHeight * static_cast<float>(counts.at(cost)) / static_cast<float>(most));
			bar.addChild<ui::Rectangle>({.size = {16.0F, height}, .style = {.backgroundColor = theme.get(palette::ink)}});
			bar.addChild<ui::Text>({.style = styles::caption, .text = kCosts.at(cost)});
		}
		return curve;
	}

	ui::Component* findUnder(ui::Context& context, ui::Component* root, std::string_view id) {
		std::vector<ui::Component*> open{root};
		while (!open.empty()) {
			ui::Component* at = open.back();
			open.pop_back();
			if (at == nullptr) {
				continue;
			}
			if (at->getId() == id) {
				return at;
			}
			for (const ui::ComponentId child : at->getChildren()) {
				open.push_back(context.find(child));
			}
		}
		return nullptr;
	}

	void refocus(ui::Context& context, ui::Component* root, const std::string& was, const std::vector<std::string>& fallbacks) {
		if (was.empty()) {
			return;
		}
		std::vector<std::string> tries{was};
		if (const size_t cut = was.rfind('_'); cut != std::string::npos) {
			tries.push_back(was.substr(0, cut));
		}
		tries.insert(tries.end(), fallbacks.begin(), fallbacks.end());
		for (const std::string& id : tries) {
			ui::Component* found = findUnder(context, root, id);
			if (found != nullptr && found->canReceiveFocus() && found->focus()) {
				return;
			}
		}
	}

} // namespace game::crew
