#include "cards/CardDetail.h"

#include "Fonts.h"
#include "cards/CardInk.h"
#include "cards/CardStyle.h"

#include <primitives/Primitives.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <string>

namespace game::cards {

	namespace {

		namespace look = detail;

		constexpr float kInsetTop = look::kBorder + look::kPadTop;
		constexpr float kInsetSide = look::kBorder + look::kPadSide;
		constexpr float kInsetBottom = look::kBorder + look::kPadBottom;
		constexpr float kInner = look::kWidth - kInsetSide * 2.0F;
		constexpr float kNameX = kInsetSide + look::kHexSide + 10.0F;
		constexpr float kMarkSize = 12.0F;
		constexpr float kRuleGap = 8.0F;
		// The keyword boxes.
		constexpr float kNotePadX = 10.0F;
		constexpr float kNotePadY = 8.0F;
		constexpr float kNoteTitle = 15.0F;
		constexpr float kNoteTitleLine = 18.0F;
		constexpr float kNoteBody = 13.0F;
		constexpr float kNoteBodyLine = 18.0F;

		std::string typeWord(const rules::CardDefinition& card) {
			const std::string_view label = typeLabel(card);
			if (label == "ATK") {
				return "ATTACK";
			}
			if (label == "DEF") {
				return "DEFENSE";
			}
			if (label == "PWR") {
				return "POWER";
			}
			if (label == "ORD") {
				return "ORDER";
			}
			if (label == "SYN") {
				return "SYNERGY";
			}
			return "UTILITY";
		}

		std::string upper(std::string_view text) {
			std::string out(text);
			std::ranges::transform(out, out.begin(), [](unsigned char letter) { return static_cast<char>(std::toupper(letter)); });
			return out;
		}

		constexpr float kNoteText = look::kKeywordWidth - kNotePadX * 2.0F;
		constexpr int	kNoteLines = 8;

	} // namespace

	CardDetail::CardDetail(const Args& args)
		: card(args.card),
		  upgraded(args.upgraded),
		  seat(args.seat),
		  pinned(args.pinned),
		  description(args.card != nullptr ? rules::cardDescription(*args.card, args.upgraded) : std::string()) {
		if (card == nullptr) {
			return;
		}
		const float typeWidth = wordsWidth(typeWord(*card), fonts::kMono, look::kTypeSize) + (seat ? kMarkSize + 5.0F : 0.0F);
		const float nameWidth = look::kWidth - kInsetSide - kNameX - typeWidth - 6.0F;
		name = wrappedLines(rules::cardName(*card, upgraded), fonts::kDisplayBold, look::kNameSize, nameWidth, look::kNameLines);
		flow = flowWords(description, rules::KeywordMarks::Anywhere, fonts::kBody, look::kRulesSize, look::kRulesLine, kInner);
		head = std::max(look::kHexSide, static_cast<float>(name.size()) * look::kNameLine);
		const auto total = [this](float artHeight) {
			return kInsetTop + head + look::kGap + artHeight + look::kGap + static_cast<float>(flow.lines) * look::kRulesLine + kRuleGap +
				   1.0F + kRuleGap + look::kFootHeight + kInsetBottom;
		};
		const float over = total(look::kArtHeight) - look::kMaxHeight;
		art = over > 0.0F ? std::max(look::kArtMin, look::kArtHeight - over) : look::kArtHeight;
		height = total(art);
	}

	CardDetail::Metrics CardDetail::measure() const {
		return {.height = height, .art = art, .nameLines = static_cast<int>(name.size()), .rulesLines = flow.lines};
	}

	float CardDetail::inkExtent() const {
		// The drop shadow lifting it off the road.
		return 56.0F;
	}

	void CardDetail::describe(nlohmann::json& node) const {
		if (card == nullptr) {
			return;
		}
		node["card"] = card->id.value;
		node["name"] = rules::cardName(*card, upgraded);
		node["text"] = description;
		node["pinned"] = pinned;
	}

	std::optional<Foundation::Vec2> CardDetail::intrinsicSize(std::optional<float> /*width*/, float /*availableWidth*/) const {
		return Foundation::Vec2{look::kWidth, height};
	}

	void CardDetail::render() {
		if (card == nullptr) {
			return;
		}
		const int32_t key = drawKey();
		drawRounded(
			{0.0F, 0.0F, size.x, size.y},
			look::kRadius,
			kGround,
			frameColor(seat),
			look::kBorder,
			key,
			std::nullopt,
			Foundation::BoxShadow{.color = kShadow, .blur = 40.0F, .offset = {0.0F, 16.0F}}
		);

		// The head: hex, name, and the type with the seat's mark at the right.
		drawCostHex({kInsetSide, kInsetTop}, look::kHexSide, look::kHexDigits, card->cost, kHexBone, kDigits, key);
		const float nameTop = kInsetTop + (head - static_cast<float>(name.size()) * look::kNameLine) * 0.5F;
		for (size_t line = 0; line < name.size(); ++line) {
			drawWords({
				.text = upper(name[line]),
				.at = {kNameX, nameTop + static_cast<float>(line) * look::kNameLine},
				.face = fonts::kDisplayBold,
				.size = look::kNameSize,
				.color = kName,
				.boxHeight = look::kNameLine,
				.key = key,
			});
		}
		float right = look::kWidth - kInsetSide;
		if (seat) {
			drawSeatMark(*seat, {right - kMarkSize * 0.5F, kInsetTop + 8.0F}, kMarkSize, kDriverColors.at(static_cast<size_t>(*seat)), key);
			right -= kMarkSize + 5.0F;
		}
		drawWords({
			.text = typeWord(*card),
			.at = {right - 80.0F, kInsetTop + 2.0F},
			.face = fonts::kMono,
			.size = look::kTypeSize,
			.color = kMuted,
			.align = Foundation::HorizontalAlign::Right,
			.boxWidth = 80.0F,
			.key = key,
		});

		float y = kInsetTop + head + look::kGap;
		drawArt({kInsetSide, y, kInner, art}, 4.0F, seat, artGlyph(*card), std::min(48.0F, art * 0.75F), false, key);
		y += art + look::kGap;
		drawFlow(flow, {kInsetSide, y}, kDetailRules, kKeyword, flow.lines, key);
		y += static_cast<float>(flow.lines) * look::kRulesLine + kRuleGap;

		Renderer::Primitives::drawRect({.bounds = {kInsetSide, y, kInner, 1.0F}, .style = {.fill = kLineFaint}, .key = key});
		y += 1.0F + kRuleGap;
		drawGem({kInsetSide + look::kGem * 0.5F, y + look::kFootHeight * 0.5F}, look::kGem, gemColor(card->rarity), key);
		std::string foot = upper(rarityName(card->rarity));
		if (const std::optional<int> range = rules::cardRange(*card, upgraded)) {
			foot += "  R" + std::to_string(*range);
		}
		drawWords({
			.text = foot,
			.at = {kInsetSide + look::kGem + 8.0F, y},
			.face = fonts::kMono,
			.size = look::kFootSize,
			.color = kMuted,
			.boxHeight = look::kFootHeight,
			.key = key,
		});
		drawWords({
			.text = pinned ? "PINNED" : "RMB / I: PIN",
			.at = {kInsetSide, y},
			.face = fonts::kMono,
			.size = look::kFootSize,
			.color = kDim,
			.align = Foundation::HorizontalAlign::Right,
			.boxWidth = kInner,
			.boxHeight = look::kFootHeight,
			.key = key,
		});
	}

	KeywordNote::KeywordNote(const Args& args)
		: keyword(args.keyword),
		  lines(
			  args.keyword != nullptr ? wrappedLines(std::string(args.keyword->meaning), fonts::kBody, kNoteBody, kNoteText, kNoteLines)
									  : std::vector<std::string>()
		  ) {}

	void KeywordNote::describe(nlohmann::json& node) const {
		if (keyword != nullptr) {
			node["keyword"] = std::string(keyword->name);
		}
	}

	std::optional<Foundation::Vec2> KeywordNote::intrinsicSize(std::optional<float> /*width*/, float /*availableWidth*/) const {
		return Foundation::Vec2{look::kKeywordWidth, kNotePadY * 2.0F + kNoteTitleLine + static_cast<float>(lines.size()) * kNoteBodyLine};
	}

	void KeywordNote::render() {
		if (keyword == nullptr) {
			return;
		}
		const int32_t key = drawKey();
		drawRounded(
			{0.0F, 0.0F, size.x, size.y},
			6.0F,
			kGround,
			kLine,
			1.0F,
			key,
			std::nullopt,
			Foundation::BoxShadow{.color = kShadow, .blur = 24.0F}
		);
		drawWords({
			.text = std::string(keyword->name),
			.at = {kNotePadX, kNotePadY},
			.face = fonts::kDisplayBold,
			.size = kNoteTitle,
			.color = kKeyword,
			.boxHeight = kNoteTitleLine,
			.key = key,
		});
		for (size_t line = 0; line < lines.size(); ++line) {
			drawWords({
				.text = lines[line],
				.at = {kNotePadX, kNotePadY + kNoteTitleLine + static_cast<float>(line) * kNoteBodyLine},
				.face = fonts::kBody,
				.size = kNoteBody,
				.color = kRules,
				.boxHeight = kNoteBodyLine,
				.key = key,
			});
		}
	}

	void CardInspect::onMount() {
		ui::Layout layout = getLayout();
		layout.display = ui::Display::Flex;
		layout.flexDirection = ui::FlexDirection::Row;
		layout.alignItems = ui::AlignItems::Start;
		layout.gap = look::kKeywordOffset;
		setLayout(layout);
		if (shown.card == nullptr) {
			return;
		}
		const std::string						 id = getId();
		const std::vector<const rules::Keyword*> found = rules::cardKeywords(*shown.card, shown.upgraded);
		const auto								 notes = [&] {
			  if (found.empty()) {
				  return;
			  }
			  ui::Layout column{
											  .display = ui::Display::Flex,
											  .flexDirection = ui::FlexDirection::Column,
											  .gap = look::kKeywordGap,
											  .alignItems = ui::AlignItems::Start,
			  };
			  column.flexShrink = 0.0F;
			  ui::Ref<ui::Component> boxes = addChild<ui::Component>({.id = id.empty() ? std::string() : id + "_keywords", .layout = column});
			  for (size_t index = 0; index < found.size() && index < static_cast<size_t>(look::kKeywordMax); ++index) {
				  boxes.addChild<KeywordNote>({.keyword = found[index]});
			  }
		};
		// Driver 2's boxes sit to its left, everyone else's to its right.
		const bool left = shown.seat == 1;
		if (left) {
			notes();
		}
		addChild<CardDetail>({
			.id = id.empty() ? std::string() : id + "_detail",
			.layout = {.flexShrink = 0.0F},
			.card = shown.card,
			.upgraded = shown.upgraded,
			.seat = shown.seat,
			.pinned = shown.pinned,
		});
		if (!left) {
			notes();
		}
	}

} // namespace game::cards
