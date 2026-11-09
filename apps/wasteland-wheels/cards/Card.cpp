#include "cards/Card.h"

#include "Fonts.h"
#include "cards/CardDetail.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <utils/Log.h>

#include <rules/core/CardText.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>

namespace game::cards {

	namespace {

		constexpr float kFocusGap = 3.0F;
		constexpr float kFocusWidth = 2.0F;
		constexpr float kSelectedBorder = 3.0F;
		// The detail view sits this far beside the card it opens from.
		constexpr float kViewGap = 12.0F;

		std::string upper(std::string_view text) {
			std::string out(text);
			std::ranges::transform(out, out.begin(), [](unsigned char letter) { return static_cast<char>(std::toupper(letter)); });
			return out;
		}

		const char* stateName(MiniState state) {
			switch (state) {
				case MiniState::None:
					return "none";
				case MiniState::Borrowed:
					return "borrowed";
				case MiniState::Home:
					return "home";
				case MiniState::Locked:
					return "locked";
				case MiniState::Unavailable:
					return "unavailable";
			}
			return "";
		}

	} // namespace

	Card::Card(const Args& args)
		: card(args.card),
		  upgraded(args.upgraded),
		  cardSize(args.cardSize),
		  seat(args.seat),
		  copies(std::max(1, args.copies)),
		  state(args.state),
		  unaffordable(args.unaffordable),
		  blocked(args.blocked),
		  selected(args.selected),
		  inspectable(args.inspectable),
		  onPress(args.onPress) {}

	Foundation::Vec2 Card::sizeOf(CardSize cardSize) {
		return cardSize == CardSize::Face ? face::kSize : mini::kSize;
	}

	bool Card::faded() const {
		return cardSize == CardSize::Mini && (state == MiniState::Home || state == MiniState::Unavailable);
	}

	float Card::inkExtent() const {
		return cardSize == CardSize::Face ? face::kInk : mini::kInk;
	}

	void Card::describe(nlohmann::json& node) const {
		ui::Control::describe(node);
		if (card == nullptr) {
			return;
		}
		node["card"] = card->id.value;
		node["name"] = rules::cardName(*card, upgraded);
		node["cost"] = card->cost;
		node["size"] = cardSize == CardSize::Face ? "face" : "mini";
		if (cardSize == CardSize::Face) {
			node["summary"] = rules::plainText(rules::cardSummary(*card, upgraded));
			node["summaryLines"] = summary.lines;
			node["unaffordable"] = unaffordable;
			node["blocked"] = blocked ? nlohmann::json(*blocked) : nlohmann::json(nullptr);
		} else {
			node["copies"] = copies;
			node["state"] = stateName(state);
		}
		node["pinned"] = isPinned();
	}

	void Card::onMount() {
		ui::Control::onMount();
		setSize(sizeOf(cardSize));
		if (card == nullptr) {
			LOG_ERROR(Game, "A card component was built with no card");
			return;
		}
		const std::string shownName = rules::cardName(*card, upgraded);
		if (cardSize == CardSize::Face) {
			// Measured at 16 against its slot, set at 14 if it doesn't fit, and cut past that.
			nameFontSize =
				wordsWidth(shownName, fonts::kDisplayBold, face::kNameSize) <= face::kNameWidth ? face::kNameSize : face::kNameShrunk;
			name = {fittedLine(shownName, fonts::kDisplayBold, nameFontSize, face::kNameWidth)};
			summary = flowWords(
				rules::cardSummary(*card, upgraded),
				rules::KeywordMarks::Bracketed,
				fonts::kBody,
				face::kRulesSize,
				face::kRulesLine,
				face::kRulesWidth
			);
		} else {
			nameFontSize = mini::kNameSize;
			name = wrappedLines(shownName, fonts::kDisplayBold, mini::kNameSize, mini::kNameWidth, mini::kNameLines);
		}
		if (inspectable) {
			setTooltip([this](ui::Component& /*owner*/, Foundation::Vec2 /*at*/) { return openView(ui::OverlayKind::Tooltip); });
		}
	}

	ui::Ref<ui::Component> Card::openView(ui::OverlayKind kind) {
		const bool pinned = kind == ui::OverlayKind::Panel;
		return openOverlay<CardInspect>(
			{
				.id = getId().empty() ? std::string() : getId() + (pinned ? "_pinned" : "_inspect"),
				.card = card,
				.upgraded = upgraded,
				.seat = seat,
				.pinned = pinned,
			},
			{.kind = kind, .placement = ui::Anchored{.side = ui::Side::Right, .align = ui::Align::Start, .gap = kViewGap}}
		);
	}

	void Card::setPinned(bool pinned) {
		if (pinned == isPinned() || !inspectable) {
			return;
		}
		ui::Context& context = *getContext();
		if (focusView.get() != nullptr) {
			context.closeOverlay(focusView);
			focusView = {};
		}
		if (pinned) {
			// One view at a time: the pinned one, until it's let go.
			setTooltip({});
			pinnedView = openView(ui::OverlayKind::Panel);
			return;
		}
		context.closeOverlay(pinnedView);
		pinnedView = {};
		setTooltip([this](ui::Component& /*owner*/, Foundation::Vec2 /*at*/) { return openView(ui::OverlayKind::Tooltip); });
	}

	void Card::onInteractionChanged(const ui::InteractionState& previous) {
		const ui::InteractionState now = interaction();
		if (!inspectable || isPinned() || now.focusVisible == previous.focusVisible) {
			return;
		}
		if (now.focusVisible && focusView.get() == nullptr) {
			focusView = openView(ui::OverlayKind::Tooltip);
		} else if (!now.focusVisible && focusView.get() != nullptr) {
			getContext()->closeOverlay(focusView);
			focusView = {};
		}
	}

	void Card::activate() {
		if (onPress) {
			onPress();
		}
	}

	void Card::handlePointer(ui::PointerEvent& event) {
		if (inspectable && event.type == ui::PointerEvent::Type::Down && event.button == foundation::MouseButton::Right) {
			setPinned(!isPinned());
			event.consume();
			return;
		}
		ui::Control::handlePointer(event);
	}

	void Card::handleKey(ui::KeyEvent& event) {
		if (inspectable && event.type == ui::KeyEvent::Type::Down && event.key == foundation::Key::I && !event.repeat) {
			setPinned(!isPinned());
			event.consume();
			return;
		}
		if (event.type == ui::KeyEvent::Type::Cancel && isPinned()) {
			setPinned(false);
			event.consume();
			return;
		}
		// Nothing to do on a press: the activate is left unconsumed for whatever holds the card, a drag source picking it up.
		if (event.type == ui::KeyEvent::Type::Activate && !onPress) {
			return;
		}
		ui::Control::handleKey(event);
	}

	Foundation::Color Card::restingFrame() const {
		return frameColor(seat);
	}

	void Card::render() {
		if (card == nullptr) {
			return;
		}
		const int32_t key = drawKey();
		if (cardSize == CardSize::Face) {
			renderFace(key);
		} else {
			renderMini(key);
		}
	}

	void Card::renderOutline(int32_t key, float radius) {
		const ui::InteractionState now = interaction();
		const float				   reach = kFocusGap + kFocusWidth;
		if (now.focusVisible) {
			drawRounded(
				{-reach, -reach, size.x + reach * 2.0F, size.y + reach * 2.0F},
				radius + reach,
				{0.0F, 0.0F, 0.0F, 0.0F},
				kHover,
				kFocusWidth,
				key
			);
		}
	}

	void Card::renderFace(int32_t key) {
		const ui::InteractionState now = interaction();
		const bool				   dim = unaffordable || blocked.has_value();
		const auto				   tone = [dim](Foundation::Color color) {
			return dim ? dimmedText(color) : color;
		};
		const bool lit = now.hovered || now.focusVisible || selected;
		drawRounded(
			{0.0F, 0.0F, size.x, size.y},
			face::kRadius,
			dim ? dimmed(kGround) : kGround,
			lit ? kHover : (dim ? dimmed(restingFrame()) : restingFrame()),
			selected ? kSelectedBorder : face::kBorder,
			key
		);
		renderOutline(key, face::kRadius);

		drawWords({
			.text = std::string(typeLabel(*card)),
			.at = {face::kTypeRight - 60.0F, face::kTypeY},
			.face = fonts::kMono,
			.size = face::kTypeSize,
			.color = tone(kMuted),
			.align = Foundation::HorizontalAlign::Right,
			.boxWidth = 60.0F,
			.key = key,
		});
		if (seat) {
			const Foundation::Color mark = kDriverColors.at(static_cast<size_t>(*seat));
			drawSeatMark(*seat, face::kMarkCentre, face::kMarkSize, dim ? dimmed(mark) : mark, key);
		}
		if (!name.empty()) {
			drawWords({
				.text = name.front(),
				.at = face::kNameAt,
				.face = fonts::kDisplayBold,
				.size = nameFontSize,
				.color = tone(kName),
				.boxHeight = 18.0F,
				.key = key,
			});
		}
		drawArt({face::kArtX, face::kArtY, face::kArtWidth, face::kArtHeight}, face::kArtRadius, seat, artGlyph(*card), 38.0F, dim, key);
		if (blocked) {
			// At full strength over the dimmed card: it's the one thing on it to read (call 367).
			const Foundation::Rect strip{face::kBlockedInset, face::kBlockedY, size.x - face::kBlockedInset * 2.0F, face::kBlockedHeight};
			drawRounded(strip, 2.0F, kBlockedBand, std::nullopt, 0.0F, key);
			drawWords({
				.text = fittedLine(*blocked, fonts::kMono, face::kBlockedSize, strip.width - face::kBlockedPad * 2.0F),
				.at = {strip.x + face::kBlockedPad, strip.y},
				.face = fonts::kMono,
				.size = face::kBlockedSize,
				.color = kBlockedText,
				.boxHeight = strip.height,
				.key = key,
			});
		}
		drawFlow(summary, face::kRulesAt, tone(kRules), tone(kKeyword), face::kRulesLines, key);

		const float footMiddle = face::kFootY + face::kFootHeight * 0.5F;
		drawGem(
			{face::kFootX + face::kGem * 0.5F, footMiddle}, face::kGem, dim ? dimmed(gemColor(card->rarity)) : gemColor(card->rarity), key
		);
		drawWords({
			.text = upper(rarityName(card->rarity)),
			.at = {face::kFootX + face::kGem + 6.0F, face::kFootY},
			.face = fonts::kMono,
			.size = face::kFootSize,
			.color = tone(kMuted),
			.boxHeight = face::kFootHeight,
			.key = key,
		});
		if (const std::optional<int> range = rules::cardRange(*card, upgraded)) {
			const std::string chip = "R" + std::to_string(*range);
			const float		  width = wordsWidth(chip, fonts::kMono, face::kFootSize) + 8.0F;
			drawRounded(
				{face::kFootRight - width, face::kFootY + 1.0F, width, face::kFootHeight - 2.0F},
				3.0F,
				{0.0F, 0.0F, 0.0F, 0.0F},
				tone(kMuted),
				1.0F,
				key
			);
			drawWords({
				.text = chip,
				.at = {face::kFootRight - width, face::kFootY},
				.face = fonts::kMono,
				.size = face::kFootSize,
				.color = tone(kMuted),
				.align = Foundation::HorizontalAlign::Center,
				.boxWidth = width,
				.boxHeight = face::kFootHeight,
				.key = key,
			});
		}
		drawCostHex(
			face::kHexAt,
			face::kHexSide,
			face::kHexDigits,
			card->cost,
			dim ? dimmed(kHexBone) : kHexBone,
			unaffordable ? kDigitsUnpayable : kDigits,
			key
		);
	}

	void Card::renderStack(int32_t key) {
		const int				edges = std::min(copies - 1, mini::kStackEdges);
		const bool				dim = faded();
		const Foundation::Color edge =
			seat
				? Foundation::
					  Color{restingFrame().r * mini::kEdgeBrightness, restingFrame().g * mini::kEdgeBrightness, restingFrame().b * mini::kEdgeBrightness, 1.0F}
				: kDim;
		for (int depth = edges; depth >= 1; --depth) {
			const float offset = static_cast<float>(depth) * mini::kStackStep;
			drawRounded(
				{offset, offset, size.x, size.y}, mini::kRadius, dim ? dimmed(kGround) : kGround, dim ? dimmed(edge) : edge, 1.0F, key
			);
		}
	}

	void Card::renderTag(int32_t key) {
		std::string text;
		switch (state) {
			case MiniState::Borrowed:
				text = "+" + std::to_string(copies);
				break;
			case MiniState::Home:
				text = "HOME";
				break;
			case MiniState::Locked:
				text = "LOCKED";
				break;
			case MiniState::None:
			case MiniState::Unavailable:
				return;
		}
		const float			   width = wordsWidth(text, fonts::kMono, mini::kTagSize, 0.6F) + mini::kTagPad * 2.0F;
		const Foundation::Rect box{mini::kTagRight - width, -mini::kTagHeight * 0.5F, width, mini::kTagHeight};
		drawRounded(box, 2.0F, kGround, kMuted, 1.0F, key);
		drawWords({
			.text = text,
			.at = {box.x, box.y},
			.face = fonts::kMono,
			.size = mini::kTagSize,
			.color = kName,
			.align = Foundation::HorizontalAlign::Center,
			.boxWidth = box.width,
			.boxHeight = box.height,
			.letterSpacing = 0.6F,
			.key = key,
		});
	}

	void Card::renderMini(int32_t key) {
		const ui::InteractionState now = interaction();
		const bool				   dim = faded();
		const auto				   tone = [dim](Foundation::Color color) {
			return dim ? dimmedText(color) : color;
		};
		const bool lit = now.hovered || now.focusVisible || selected;
		renderStack(key);
		const bool dashed = state == MiniState::Borrowed && !lit;
		drawRounded(
			{0.0F, 0.0F, size.x, size.y},
			mini::kRadius,
			dim ? dimmed(kGround) : kGround,
			lit ? kHover : (dim ? dimmed(restingFrame()) : restingFrame()),
			selected ? kSelectedBorder : mini::kBorder,
			key,
			dashed ? std::optional(Foundation::DashPattern{.dash = mini::kDash, .gap = mini::kDashGap}) : std::nullopt
		);
		renderOutline(key, mini::kRadius);

		for (size_t line = 0; line < name.size(); ++line) {
			drawWords({
				.text = name[line],
				.at = {mini::kNameAt.x, mini::kNameAt.y + static_cast<float>(line) * mini::kNameLine},
				.face = fonts::kDisplayBold,
				.size = mini::kNameSize,
				.color = tone(kName),
				.boxHeight = mini::kNameLine,
				.key = key,
			});
		}
		drawArt({mini::kArtX, mini::kArtY, mini::kArtWidth, mini::kArtHeight}, face::kArtRadius, seat, artGlyph(*card), 28.0F, dim, key);
		drawWords({
			.text = std::string(typeLabel(*card)),
			.at = mini::kTypeAt,
			.face = fonts::kMono,
			.size = mini::kTypeSize,
			.color = tone(kMuted),
			.key = key,
		});
		drawGem(mini::kGemCentre, mini::kGem, dim ? dimmed(gemColor(card->rarity)) : gemColor(card->rarity), key);
		drawCostHex(mini::kHexAt, mini::kHexSide, mini::kHexDigits, card->cost, dim ? dimmed(kHexBone) : kHexBone, kDigits, key);
		renderTag(key);
		if (copies > 1) {
			const std::string	   count = "x" + std::to_string(copies);
			const float			   width = wordsWidth(count, fonts::kDisplayBold, mini::kCountSize) + mini::kCountPad * 2.0F;
			const float			   right = size.x + mini::kStackStep * static_cast<float>(std::min(copies - 1, mini::kStackEdges));
			const Foundation::Rect pill{right - width, size.y - mini::kCountHeight * 0.5F, width, mini::kCountHeight};
			drawRounded(pill, mini::kCountHeight * 0.5F, dim ? dimmed(kHexBone) : kHexBone, std::nullopt, 0.0F, key);
			drawWords({
				.text = count,
				.at = {pill.x, pill.y},
				.face = fonts::kDisplayBold,
				.size = mini::kCountSize,
				.color = kDigits,
				.align = Foundation::HorizontalAlign::Center,
				.boxWidth = pill.width,
				.boxHeight = pill.height,
				.key = key,
			});
		}
	}

} // namespace game::cards
