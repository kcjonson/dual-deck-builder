#pragma once

// What the Crew screen, Customize and load out share (crew-screen.md, A deck builder that knows nothing of campaigns): a
// side of cards as entries, each a mini stacked to its copies with its controls under it and a line for why one is off;
// the locker's filter by kind; the chips over a deck; and the cost curve. The scenes fill the entries from the campaign,
// asking the rules for every control; nothing here reads a campaign.

#include "cards/Card.h"

#include <ui/Component.h>

#include <rules/core/Card.h>

#include <array>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace game::crew {

	inline ui::Layout column(float gap, ui::AlignItems align = ui::AlignItems::Stretch) {
		return {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Column, .gap = gap, .alignItems = align};
	}

	inline ui::Layout row(float gap, ui::AlignItems align = ui::AlignItems::Center) {
		return {.display = ui::Display::Flex, .flexDirection = ui::FlexDirection::Row, .gap = gap, .alignItems = align};
	}

	inline ui::Layout grown(ui::Layout layout, float grow = 1.0F) {
		layout.flexGrow = grow;
		return layout;
	}

	inline ui::Layout fixed(ui::Layout layout) {
		layout.flexShrink = 0.0F;
		return layout;
	}

	struct EntryControl {
		std::string				   key; // in its id: "add", "scrap", "remove", "fewer", "more", "borrow", "give"
		std::string				   label;
		std::optional<std::string> reason;				// off, with this said under the card
		bool					   off = false;			// off with nothing said, beside a control whose reason says it
		bool					   destructive = false; // two presses: the first arms it, reading "Confirm"
		std::function<void()>	   run;
	};

	struct CardEntry {
		std::string					 key; // the card's id, or its own: "<card>-borrowed", "<card>-home", an escort's id
		const rules::CardDefinition* card = nullptr;
		int							 copies = 1;
		cards::MiniState			 state = cards::MiniState::None;
		std::vector<EntryControl>	 controls;
	};

	// Cheapest first, then by name, then by key, so a card's +N or HOME stack sits right after its own.
	void sortEntries(std::vector<CardEntry>& entries);

	enum class CardKind : uint8_t { All, Attack, Defense, Utility, Order };

	// A card's kind, from its first tag: a power card files under Attack, as its placeholder art does, and anything that
	// isn't an attack, a defense or an order under Utility, so every card is under exactly one.
	[[nodiscard]] CardKind cardKind(const rules::CardDefinition& card);
	[[nodiscard]] bool	   passesFilter(const rules::CardDefinition& card, CardKind filter);

	// The destructive control armed by its first press, by id, and how long it has been armed on the frame clock.
	struct Armed {
		std::string control;
		double		seconds = 0.0;
	};

	// A second press this soon after arming is a double-click's, and does nothing; this long armed, it lets go.
	inline constexpr double kArmGuard = 0.3;
	inline constexpr double kArmHold = 3.0;

	struct GridSpec {
		// The grid's id. Each entry's mini is "<id>_<key>", its controls "<id>_<key>_<control>", its line "<id>_<key>_reason".
		std::string								id;
		std::vector<CardEntry>					entries;
		std::optional<int>						seat; // whose cards they are, for the frame's colour
		const Armed*							armed = nullptr;
		std::function<void(const std::string&)> arm; // a destructive control's first press, by its id
	};

	// The entries in a wrapping grid, one focus group, with room round them for what a mini draws past its box.
	ui::Ref<ui::Component> cardGrid(ui::Ref<ui::Component> parent, const GridSpec& spec);

	// All, Attack, Defense, Utility and Order as a row of tabs on the index colour, the chosen one in highlighter.
	ui::Ref<ui::Component> kindFilter(
		ui::Ref<ui::Component>		  parent,
		const std::string&			  id,
		CardKind					  chosen,
		std::function<void(CardKind)> choose,
		std::string_view			  identity
	);

	// "HP 40/40": mono on fresh paper in a fine ink rule.
	ui::Ref<ui::Component> chip(ui::Ref<ui::Component> parent, const std::string& id, const std::string& text);

	// How many cards cost 0, 1, 2, and 3 or more, as bars with their counts, under a deck.
	ui::Ref<ui::Component> costCurve(ui::Ref<ui::Component> parent, const std::string& id, const std::array<int, 4>& counts);

	// The component under `root` with the id, or null.
	[[nodiscard]] ui::Component* findUnder(ui::Context& context, ui::Component* root, std::string_view id);

	// After a rebuild, focus on what had it: the same id, else the mini of the entry it was a control of, else, by the
	// fallbacks in order, the first that's there and can take it.
	void refocus(ui::Context& context, ui::Component* root, const std::string& was, const std::vector<std::string>& fallbacks = {});

} // namespace game::crew
