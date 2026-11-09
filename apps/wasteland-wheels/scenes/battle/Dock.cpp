#include "scenes/battle/Dock.h"

#include "Fonts.h"
#include "Words.h"
#include "cards/CardInk.h"
#include "cards/CardStyle.h"
#include "scenes/battle/BattleInk.h"

#include <primitives/Primitives.h>
#include <ui/components/Control.h>

#include <rules/battle/CardPlay.h>

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <numbers>
#include <utility>

namespace game::battle {

	namespace {

		// The mock's dock (Battle Screen Design 4, split-dock.md), in the stage's logical px.
		constexpr float kHeight = 228.0F;
		constexpr float kStageMaxWidth = 1600.0F;
		constexpr float kPad = 16.0F;
		constexpr float kHandsGap = 16.0F; // between the hands and End Turn
		constexpr float kHalfGap = 20.0F;
		constexpr float kTabTop = 8.0F;
		constexpr float kTabHeight = 30.0F;
		constexpr float kTabMaxWidth = 470.0F;
		// Cards hang 38 below the dock's edge and run to its foot, where a full hand's edge cards drop and lean.
		constexpr float kCardsTop = 38.0F;
		constexpr float kCardWidth = cards::face::kSize.x;
		constexpr float kCardStep = kCardWidth + 8.0F;
		constexpr int	kHandCap = 7;
		constexpr float kFanTurn = 0.9F; // degrees a card from the middle
		constexpr float kFanTurnCrowded = 0.5F;
		constexpr float kFanDropPerStep = 0.6F;
		constexpr float kFanDropMax = 5.0F;
		constexpr float kLockDrop = 60.0F;

		// End Turn's column: 26 below the dock's edge, the turn, the 64 px button and the warning under it, 8 apart.
		constexpr float kColumnWidth = 148.0F;
		constexpr float kColumnTop = 26.0F;
		constexpr float kTurnHeight = 13.0F;
		constexpr float kColumnGap = 8.0F;
		constexpr float kButtonHeight = 64.0F;
		constexpr float kButtonRadius = 4.0F;
		constexpr float kButtonEdge = 3.0F;
		constexpr float kWarnSize = 12.0F;
		constexpr float kWarnLine = 15.0F;

		// The tab (the mock's .dtab).
		constexpr float kTabPad = 10.0F;
		constexpr float kTabGap = 10.0F;
		constexpr float kStripe = 3.0F;
		constexpr float kMarkSize = 14.0F;
		constexpr float kNameSize = 15.0F;
		constexpr float kTagSize = 11.0F;
		constexpr float kTagPad = 5.0F;
		constexpr float kTagHeight = 17.0F;
		constexpr int	kMostPips = 6;
		constexpr float kPipWidth = 14.0F;
		constexpr float kPipHeight = 16.0F;
		constexpr float kPipGap = 2.0F;
		constexpr float kPipOff = 0.22F;
		constexpr float kCountGap = 4.0F;
		constexpr float kCountSize = 15.0F;
		constexpr float kPileIcon = 14.0F;
		constexpr float kPileIconGap = 3.0F;
		constexpr float kPileGap = 8.0F;
		constexpr float kPileSize = 12.0F;

		// What the screen's ink doesn't carry: End Turn in the interaction yellow, lit brighter, its ledge darker, grey
		// while it waits.
		constexpr Foundation::Color kButtonFace = ink::kWarn;
		constexpr Foundation::Color kButtonLit = cards::hex(0xF7E38A);
		constexpr Foundation::Color kButtonLedge = cards::hex(0x8C7A2E);
		constexpr Foundation::Color kButtonWaiting = cards::hex(0x34373B);
		constexpr Foundation::Color kButtonText = cards::hex(0x151515);
		constexpr Foundation::Color kClear = cards::hex(0x000000, 0.0F);

		const char* const kCrashedOutNote = "No free seat after the wreck: out of this fight";
		const char* const kDownNote = "Down: out of this fight";

		std::string upper(std::string_view text) {
			std::string out(text);
			std::ranges::transform(out, out.begin(), [](unsigned char letter) { return static_cast<char>(std::toupper(letter)); });
			return out;
		}

		Foundation::Color withAlpha(Foundation::Color color, float alpha) {
			color.a *= alpha;
			return color;
		}

		Foundation::Color seatColor(int seat) {
			return cards::kDriverColors.at(static_cast<size_t>(std::clamp(seat, 0, 1)));
		}

		// The mock's #i-bolt in its 14 by 16 box.
		void drawBolt(Foundation::Vec2 at, Foundation::Color color, int32_t key) {
			const std::array<Foundation::Vec2, 6> bolt{{
				{at.x + 9.0F, at.y},
				{at.x + 2.0F, at.y + 9.0F},
				{at.x + 7.0F, at.y + 9.0F},
				{at.x + 5.0F, at.y + 16.0F},
				{at.x + 12.0F, at.y + 6.0F},
				{at.x + 7.0F, at.y + 6.0F},
			}};
			Renderer::Primitives::drawPolygon({.vertices = bolt, .style = {.fill = color}, .key = key});
		}

		// Draw: two cards stacked. Discard: one, struck through.
		void drawPile(Foundation::Vec2 at, bool discard, Foundation::Color color, int32_t key) {
			if (!discard) {
				cards::drawRounded({at.x + 4.0F, at.y, 9.0F, 12.0F}, 1.5F, kClear, color, 1.0F, key);
				cards::drawRounded({at.x + 1.0F, at.y + 2.0F, 9.0F, 12.0F}, 1.5F, ink::kDriverTab, color, 1.0F, key);
				return;
			}
			cards::drawRounded({at.x + 2.0F, at.y + 1.0F, 10.0F, 12.0F}, 1.5F, kClear, color, 1.0F, key);
			Renderer::Primitives::drawLine({
				.start = {at.x + 1.0F, at.y + 13.0F},
				.end = {at.x + 13.0F, at.y + 1.0F},
				.style = {.color = color, .width = 1.5F},
				.key = key,
			});
		}

	} // namespace

	namespace dock {

		// A driver's tab: mark, name and tag from the half's outer edge, adrenaline and the piles from its inner one; the
		// second driver's mirrored.
		class Tab final : public ui::Component {
		  public:
			void show(const DockHalf& value) { half = value; }

			[[nodiscard]] const char* typeName() const override { return "DockTab"; }
			void					  describe(nlohmann::json& node) const override {
				 node["driver"] = half.driver.value;
				 node["name"] = half.name;
				 node["tag"] = half.tag ? nlohmann::json(*half.tag) : nlohmann::json(nullptr);
				 node["adrenaline"] = half.adrenaline;
				 node["maxAdrenaline"] = half.maxAdrenaline;
				 node["draw"] = half.draw;
				 node["discard"] = half.discard;
			}

		  protected:
			void render() override;

		  private:
			DockHalf half;
		};

		void Tab::render() {
			const int32_t			key = drawKey();
			const Foundation::Color color = seatColor(half.seat);
			const bool				out = half.crashedOut || half.down;
			// Edged on three sides, open to the fan below as the mock's is.
			cards::drawRounded({0.0F, 0.0F, size.x, size.y}, 3.0F, ink::kDriverTab, std::nullopt, 0.0F, key);
			for (const float side : {0.5F, size.x - 0.5F}) {
				Renderer::Primitives::drawLine(
					{.start = {side, 2.0F}, .end = {side, size.y}, .style = {.color = ink::kLine2, .width = 1.0F}, .key = key}
				);
			}
			cards::drawRounded({0.0F, 0.0F, size.x, kStripe}, 1.5F, color, std::nullopt, 0.0F, key);

			// Laid out from the outer edge, then mirrored for the second driver.
			const auto at = [this](float x, float width) {
				return half.seat == 1 ? size.x - x - width : x;
			};
			const float middle = (size.y + kStripe) * 0.5F;

			const std::string drawCount = std::to_string(half.draw);
			const std::string discardCount = std::to_string(half.discard);
			const float		  drawWidth = cards::wordsWidth(drawCount, fonts::kMono, kPileSize);
			const float		  discardWidth = cards::wordsWidth(discardCount, fonts::kMono, kPileSize);
			const float		  pilesWidth = kPileIcon * 2.0F + kPileIconGap * 2.0F + drawWidth + discardWidth + kPileGap;

			const int		  pips = half.maxAdrenaline > kMostPips ? 1 : half.maxAdrenaline;
			const float		  pipsWidth = pips > 0 ? static_cast<float>(pips) * kPipWidth + static_cast<float>(pips - 1) * kPipGap : 0.0F;
			const std::string count = std::to_string(half.adrenaline) + "/" + std::to_string(half.maxAdrenaline);
			const float		  countWidth = cards::wordsWidth(count, fonts::kDisplayBold, kCountSize);
			const float		  adrenalineWidth = out ? 0.0F : pipsWidth + kCountGap + countWidth;

			const std::string tag = half.tag ? *half.tag : std::string();
			const float		  tagWidth = tag.empty() ? 0.0F : cards::wordsWidth(tag, fonts::kMono, kTagSize) + kTagPad * 2.0F;

			float x = kTabPad;
			cards::drawSeatMark(half.seat, {at(x, kMarkSize) + kMarkSize * 0.5F, middle}, kMarkSize, color, key);
			x += kMarkSize + kTabGap;

			const float room = size.x - x - kTabPad - pilesWidth - (out ? 0.0F : adrenalineWidth + kTabGap) - kTabGap -
							   (tag.empty() ? 0.0F : tagWidth + kTabGap);
			if (room > 0.0F) {
				const std::string name = cards::fittedLine(upper(half.name), fonts::kDisplaySemibold, kNameSize, room);
				const float		  nameWidth = cards::wordsWidth(name, fonts::kDisplaySemibold, kNameSize);
				cards::drawWords({
					.text = name,
					.at = {at(x, nameWidth), 0.0F},
					.face = fonts::kDisplaySemibold,
					.size = kNameSize,
					.color = ink::kBone,
					.boxHeight = size.y + kStripe,
					.key = key,
				});
				x += nameWidth + kTabGap;
			}
			if (!tag.empty()) {
				const Foundation::Rect box{at(x, tagWidth), middle - kTagHeight * 0.5F, tagWidth, kTagHeight};
				cards::drawRounded(box, 2.0F, cards::kBlockedBand, std::nullopt, 0.0F, key);
				cards::drawWords({
					.text = tag,
					.at = {box.x, box.y},
					.face = fonts::kMono,
					.size = kTagSize,
					.color = cards::kBlockedText,
					.align = Foundation::HorizontalAlign::Center,
					.boxWidth = box.width,
					.boxHeight = box.height,
					.key = key,
				});
			}

			// From the inner edge: the piles, then adrenaline.
			float	   inner = size.x - kTabPad - pilesWidth;
			const auto pile = [&](bool discard, const std::string& text, float width) {
				drawPile({at(inner, kPileIcon), middle - kPileIcon * 0.5F}, discard, ink::kMuted, key);
				cards::drawWords({
					.text = text,
					.at = {at(inner + kPileIcon + kPileIconGap, width), 0.0F},
					.face = fonts::kMono,
					.size = kPileSize,
					.color = ink::kMuted,
					.boxHeight = size.y + kStripe,
					.key = key,
				});
				inner += kPileIcon + kPileIconGap + width + kPileGap;
			};
			pile(false, drawCount, drawWidth);
			pile(true, discardCount, discardWidth);
			if (out) {
				return;
			}
			float bolt = size.x - kTabPad - pilesWidth - kTabGap - adrenalineWidth;
			// Lit from the outer end; past six, one bolt and the count say it.
			const int lit = half.maxAdrenaline > kMostPips ? pips : half.adrenaline;
			for (int index = 0; index < pips; ++index) {
				drawBolt({at(bolt, kPipWidth), middle - kPipHeight * 0.5F}, withAlpha(color, index < lit ? 1.0F : kPipOff), key);
				bolt += kPipWidth + kPipGap;
			}
			cards::drawWords({
				.text = count,
				.at = {at(bolt - kPipGap + kCountGap, countWidth), 0.0F},
				.face = fonts::kDisplayBold,
				.size = kCountSize,
				.color = color,
				.boxHeight = size.y + kStripe,
				.key = key,
			});
		}

		// What takes a hand's place once its driver is out of the fight.
		class Note final : public ui::Component {
		  public:
			void setText(std::string value) { text = std::move(value); }

			[[nodiscard]] const char* typeName() const override { return "DockNote"; }
			void					  describe(nlohmann::json& node) const override { node["text"] = text; }

		  protected:
			void render() override {
				const int32_t key = drawKey();
				cards::drawRounded(
					{0.0F, 0.0F, size.x, cards::face::kSize.y},
					6.0F,
					kClear,
					ink::kLine2,
					1.0F,
					key,
					Foundation::DashPattern{.dash = 6.0F, .gap = 5.0F}
				);
				cards::drawWords({
					.text = cards::fittedLine(text, fonts::kMono, kPileSize, size.x - kTabPad * 2.0F),
					.at = {0.0F, 0.0F},
					.face = fonts::kMono,
					.size = kPileSize,
					.color = ink::kMuted,
					.align = Foundation::HorizontalAlign::Center,
					.boxWidth = size.x,
					.boxHeight = cards::face::kSize.y,
					.key = key,
				});
			}

		  private:
			std::string text;
		};

		// The hands' grey for the enemy turn, over them and dropping with them.
		class Scrim final : public ui::Component {
		  public:
			void setProgress(float value) { progress = value; }

			[[nodiscard]] const char* typeName() const override { return "DockScrim"; }

		  protected:
			void render() override {
				Renderer::Primitives::drawRect({
					.bounds = {0.0F, 0.0F, size.x, size.y},
					.style = {.fill = withAlpha(ink::kDockScrim, progress)},
					.key = drawKey(),
				});
			}

		  private:
			float progress = 0.0F;
		};

		// A card in the fan, telling the dock when the pointer or a player's focus comes and goes.
		class HandCardView final : public cards::Card {
		  public:
			using cards::Card::Card;

			std::function<void()> onLit;

			[[nodiscard]] bool lit() const {
				const ui::InteractionState now = interaction();
				return now.hovered || now.focusVisible;
			}

		  protected:
			void onInteractionChanged(const ui::InteractionState& previous) override {
				cards::Card::onInteractionChanged(previous);
				if (onLit) {
					onLit();
				}
			}
		};

		// End Turn, and Leave the fight in its place once the fight is over: the interaction yellow with a ledge under it,
		// brighter when pointed at, grey and flat while it waits.
		class Button final : public ui::Control {
		  public:
			struct Args {
				UI_COMMON_ARGS
				std::string			  label;
				float				  labelSize = 21.0F;
				std::function<void()> onPress;
				std::function<void()> onLit;
			};

			explicit Button(const Args& args)
				: label(args.label),
				  labelSize(args.labelSize),
				  onPress(args.onPress),
				  onLit(args.onLit) {}

			void							 setLabel(std::string value) { label = std::move(value); }
			[[nodiscard]] const std::string& getLabel() const { return label; }
			[[nodiscard]] bool				 lit() const {
				  const ui::InteractionState now = interaction();
				  return now.hovered || now.focusVisible;
			}

			[[nodiscard]] const char* typeName() const override { return "DockButton"; }
			// It draws its own waiting look at full strength.
			[[nodiscard]] float stateOpacity() const override { return 1.0F; }
			[[nodiscard]] float inkExtent() const override { return kButtonEdge + 3.0F; }
			void				describe(nlohmann::json& node) const override {
				   ui::Control::describe(node);
				   node["label"] = label;
			}

		  protected:
			void activate() override {
				if (onPress) {
					onPress();
				}
			}
			void onInteractionChanged(const ui::InteractionState& /*previous*/) override {
				if (onLit) {
					onLit();
				}
			}
			void render() override {
				const int32_t			   key = drawKey();
				const ui::InteractionState now = interaction();
				const bool				   waiting = !isEnabledInTree();
				const float				   sink = now.pressed && !waiting ? kButtonEdge : 0.0F;
				if (!waiting && sink == 0.0F) {
					cards::drawRounded({0.0F, kButtonEdge, size.x, size.y}, kButtonRadius, kButtonLedge, std::nullopt, 0.0F, key);
				}
				const Foundation::Color face = waiting ? kButtonWaiting : (now.hovered ? kButtonLit : kButtonFace);
				const Foundation::Rect	box{0.0F, sink, size.x, size.y};
				cards::drawRounded(box, kButtonRadius, face, std::nullopt, 0.0F, key);
				if (now.focusVisible) {
					const float reach = kButtonEdge + 1.0F;
					cards::drawRounded(
						{-reach, sink - reach, size.x + reach * 2.0F, size.y + reach * 2.0F},
						kButtonRadius + reach,
						kClear,
						ink::kBone,
						2.0F,
						key
					);
				}
				cards::drawWords({
					.text = cards::fittedLine(label, fonts::kDisplayBold, labelSize, size.x - 12.0F),
					.at = {box.x, box.y},
					.face = fonts::kDisplayBold,
					.size = labelSize,
					.color = waiting ? ink::kMuted : kButtonText,
					.align = Foundation::HorizontalAlign::Center,
					.boxWidth = box.width,
					.boxHeight = box.height,
					.key = key,
				});
			}

		  private:
			std::string			  label;
			float				  labelSize;
			std::function<void()> onPress;
			std::function<void()> onLit;
		};

		// The column's words: the turn above the button and the unspent warning under it, or the fight's outcome.
		class Column final : public ui::Component {
		  public:
			void show(int turnNow, int unspentNow, std::optional<std::string> outcomeNow, bool lockedNow) {
				turn = turnNow;
				unspent = unspentNow;
				outcome = std::move(outcomeNow);
				locked = lockedNow;
			}

			[[nodiscard]] const char* typeName() const override { return "EndTurnColumn"; }
			void					  describe(nlohmann::json& node) const override {
				 node["label"] = labelText();
				 node["warning"] = warningText();
			}

		  protected:
			void render() override {
				const int32_t key = drawKey();
				cards::drawWords({
					.text = labelText(),
					.at = {0.0F, 0.0F},
					.face = outcome ? fonts::kDisplayBold : fonts::kDisplaySemibold,
					.size = kTurnHeight,
					.color = outcome ? ink::kBone : ink::kMuted,
					.align = Foundation::HorizontalAlign::Center,
					.boxWidth = size.x,
					.boxHeight = kTurnHeight,
					.letterSpacing = kTurnHeight * 0.14F,
					.key = key,
				});
				const std::string warning = warningText();
				if (warning.empty()) {
					return;
				}
				const std::vector<std::string> lines = cards::wrappedLines(warning, fonts::kMono, kWarnSize, size.x, 2);
				float						   y = kTurnHeight + kColumnGap + kButtonHeight + kColumnGap;
				for (const std::string& line : lines) {
					cards::drawWords({
						.text = line,
						.at = {0.0F, y},
						.face = fonts::kMono,
						.size = kWarnSize,
						.color = ink::kWarn,
						.align = Foundation::HorizontalAlign::Center,
						.boxWidth = size.x,
						.boxHeight = kWarnLine,
						.key = key,
					});
					y += kWarnLine;
				}
			}

		  private:
			[[nodiscard]] std::string labelText() const { return outcome ? upper(*outcome) : "TURN " + std::to_string(turn); }
			[[nodiscard]] std::string warningText() const {
				return !outcome && !locked && unspent > 0 ? std::to_string(unspent) + " adrenaline unspent" : std::string();
			}

			int						   turn = 1;
			int						   unspent = 0;
			std::optional<std::string> outcome;
			bool					   locked = false;
		};

	} // namespace dock

	DockPicture dockPicture(
		const rules::BattleState&	 state,
		const rules::Content&		 content,
		const Targeting&			 targeting,
		std::span<const std::string> seats
	) {
		DockPicture picture{.turn = state.turn, .canEndTurn = state.phase == rules::Phase::PlayerTurn};
		if (state.outcome) {
			picture.outcome = outcomeText(*state.outcome);
		}
		int seat = 0;
		for (int index = 0; index < static_cast<int>(state.drivers.size()); ++index) {
			const rules::BattleDriver& driver = state.drivers[static_cast<size_t>(index)];
			if (driver.side != rules::Side::Player) {
				continue;
			}
			const rules::DriverIndex who{index};
			DockHalf				 half{
								.driver = who,
								.seat = seat++,
								.name = fighterName(state, content, who, seats),
								.adrenaline = driver.adrenaline,
								.maxAdrenaline = driver.maxAdrenaline,
								.draw = static_cast<int>(driver.deck.size()),
								.discard = static_cast<int>(driver.discard.size()),
								.crashedOut = driver.crashedOut,
								.down = !driver.isAlive(),
			};
			const std::optional<rules::VehicleIndex> aboard = rules::vehicleCarrying(state, who);
			if (half.down) {
				half.tag = "DOWN";
			} else if (half.crashedOut) {
				half.tag = "CRASHED OUT";
			} else if (aboard && state.vehicle(*aboard).driver != who) {
				half.tag = "PASSENGER";
			}
			if (!half.down && !half.crashedOut) {
				for (int place = 0; place < static_cast<int>(driver.hand.size()); ++place) {
					const rules::BattleCard& held = driver.hand[static_cast<size_t>(place)];
					const HandCard			 card{.driver = who, .handIndex = place};
					half.hand.push_back(
						DockCard{
							.card = card,
							.definition = &rules::definitionOf(content, held.card),
							.upgraded = held.upgraded,
							.playable = targeting.playable(card),
							.affordable = targeting.affordable(card),
							.blockLabel = targeting.blockLabel(card),
						}
					);
				}
			}
			if (rules::driverInFight(state, who)) {
				picture.unspent += driver.adrenaline;
			}
			picture.halves.push_back(std::move(half));
		}
		return picture;
	}

	Dock::Dock(const Args& args)
		: args(args) {}

	void Dock::onMount() {
		setIsolation(true);
		setOnLayout([this](ui::Component& self) {
			place();
			if (args.onLayout) {
				args.onLayout(self);
			}
		});
		hands = addChild<ui::Component>({.id = "dock_hands"});
		scrim = addChild<dock::Scrim>({.id = "dock_scrim", .visible = false, .zIndex = 1, .pointerEvents = ui::PointerEvents::None});
		column = addChild<dock::Column>({.id = "end_turn_column"});
		endTurn = column.addChild<dock::Button>({
			.id = "end_turn",
			.label = "END TURN",
			.onPress =
				[this] {
					if (args.onEndTurn) {
						args.onEndTurn();
					}
				},
			.onLit = [this] { refreshEndTurnPreview(); },
		});
		leave = column.addChild<dock::Button>({
			.id = "leave",
			.visible = false,
			.label = "LEAVE THE FIGHT",
			.labelSize = 17.0F,
			.onPress = [this] {
				if (args.onLeave) {
					args.onLeave();
				}
			},
		});
		show(shown);
		applyDrop(drop);
	}

	float Dock::width() const {
		if (size.x > 0.0F) {
			return size.x;
		}
		// Before the first layout pass: a declared width, if it has one.
		return getSizeSpec().width.resolve(-1.0F).value_or(0.0F);
	}

	void Dock::show(const DockPicture& picture) {
		shown = picture;
		if (getContext() == nullptr) {
			return;
		}
		const bool sameDrivers =
			std::ranges::equal(halves, shown.halves, [](const Half& half, const DockHalf& wanted) { return half.driver == wanted.driver; });
		if (!sameDrivers) {
			for (const Half& half : halves) {
				hands.get()->removeChild(half.root);
			}
			halves.clear();
			for (const DockHalf& wanted : shown.halves) {
				const std::string driver = std::to_string(wanted.driver.value);
				Half			  half{.driver = wanted.driver};
				half.root = hands.addChild<ui::Component>({.id = "dock_half_" + driver});
				half.tab = half.root.addChild<dock::Tab>({.id = "dock_tab_" + driver});
				half.fan = half.root.addChild<ui::Component>({.id = "dock_fan_" + driver, .isolation = true});
				half.note = half.root.addChild<dock::Note>({.id = "dock_note_" + driver, .visible = false});
				halves.push_back(std::move(half));
			}
		}
		for (size_t index = 0; index < halves.size(); ++index) {
			showHalf(halves[index], shown.halves[index]);
		}
		applyLock();
	}

	void Dock::showHalf(Half& half, const DockHalf& picture) {
		half.tab.get()->show(picture);
		const bool out = picture.crashedOut || picture.down;
		half.fan.get()->setVisible(!out);
		half.note.get()->setVisible(out);
		half.note.get()->setText(picture.down ? kDownNote : kCrashedOutNote);

		// A card keeps its element while it holds its place, so a pinned detail view or focus survives a play elsewhere.
		const auto keyOf = [](const DockCard& card) {
			return std::to_string(card.card.handIndex) + ":" + card.definition->id.value + (card.upgraded ? "+" : "");
		};
		std::vector<ui::Ref<ui::Component>> kept;
		ui::Component&						fan = *half.fan.get();
		fan.reconcileChildren(
			picture.hand,
			keyOf,
			[&](const DockCard& card) {
				ui::Ref<dock::HandCardView> made = fan.addChild<dock::HandCardView>({
					.id = "hand_" + std::to_string(card.card.driver.value) + "_" + std::to_string(card.card.handIndex),
					.card = card.definition,
					.upgraded = card.upgraded,
					.cardSize = cards::CardSize::Face,
					.seat = picture.seat,
					.unaffordable = !card.affordable,
					.blocked = card.blockLabel,
				});
				made.get()->onLit = [this] {
					cardChanged();
				};
				kept.push_back(made);
				return ui::Ref<ui::Component>(made);
			},
			[&](ui::Component& existing, const DockCard& card) {
				auto& view = static_cast<dock::HandCardView&>(existing);
				view.setUnaffordable(!card.affordable);
				view.setBlocked(card.blockLabel);
				kept.push_back(view.self());
			}
		);
		half.cards = std::move(kept);
	}

	void Dock::place() {
		if (getContext() == nullptr) {
			return;
		}
		const float total = width();
		const float stage = std::min(total, kStageMaxWidth);
		const float stageX = (total - stage) * 0.5F;
		const float handsX = stageX + kPad;
		const float endX = stageX + stage - kPad - kColumnWidth;
		const float handsWidth = std::max(0.0F, endX - kHandsGap - handsX);
		for (const ui::Ref<ui::Component>& over : {hands, ui::Ref<ui::Component>(scrim)}) {
			over.get()->setPosition({handsX, 0.0F});
			over.get()->setSize(Foundation::Vec2{handsWidth, kHeight});
		}
		column.get()->setPosition({endX, kColumnTop});
		column.get()->setSize(Foundation::Vec2{kColumnWidth, kHeight - kColumnTop});
		for (const ui::Ref<dock::Button>& button : {endTurn, leave}) {
			button.get()->setPosition({0.0F, kTurnHeight + kColumnGap});
			button.get()->setSize(Foundation::Vec2{kColumnWidth, kButtonHeight});
		}

		const auto	count = static_cast<float>(halves.size());
		const float halfWidth = count > 1.0F ? std::max(0.0F, (handsWidth - kHalfGap * (count - 1.0F)) / count) : handsWidth;
		const float tabWidth = std::min(halfWidth, kTabMaxWidth);
		for (size_t index = 0; index < halves.size(); ++index) {
			const Half& half = halves[index];
			half.root.get()->setPosition({static_cast<float>(index) * (halfWidth + kHalfGap), 0.0F});
			half.root.get()->setSize(Foundation::Vec2{halfWidth, kHeight});
			half.tab.get()->setPosition({shown.halves[index].seat == 1 ? halfWidth - tabWidth : 0.0F, kTabTop});
			half.tab.get()->setSize(Foundation::Vec2{tabWidth, kTabHeight});
			for (const ui::Ref<ui::Component>& below : {half.fan, ui::Ref<ui::Component>(half.note)}) {
				below.get()->setPosition({0.0F, kCardsTop});
				below.get()->setSize(Foundation::Vec2{halfWidth, kHeight - kCardsTop});
			}
			placeFan(half, halfWidth);
		}
	}

	// The mock's fanHand: the step tightens from 136 as the hand fills so every card starts inside the half, each turned
	// about its bottom centre a little more from the middle and dropped along a shallow arc. One under the pointer or a
	// player's focus straightens and comes to the top so it reads whole.
	void Dock::placeFan(const Half& half, float width) {
		const int count = static_cast<int>(half.cards.size());
		if (count == 0) {
			return;
		}
		const float step = count > 1 ? std::min(kCardStep, (width - kCardWidth) / static_cast<float>(count - 1)) : 0.0F;
		const float left = (width - kCardWidth - step * static_cast<float>(count - 1)) * 0.5F;
		const float turn = (count > kHandCap ? kFanTurnCrowded : kFanTurn) * std::numbers::pi_v<float> / 180.0F;
		for (int index = 0; index < count; ++index) {
			auto* view = static_cast<dock::HandCardView*>(half.cards[static_cast<size_t>(index)].get());
			if (view == nullptr) {
				continue;
			}
			const float offset = static_cast<float>(index) - static_cast<float>(count - 1) * 0.5F;
			const bool	raised = view->lit() && !isLocked && !dragged;
			view->setPosition({left + static_cast<float>(index) * step, std::min(kFanDropMax, offset * offset * kFanDropPerStep)});
			view->setTransform({.rotate = raised ? 0.0F : offset * turn, .origin = {0.5F, 1.0F}});
			view->setZIndex(raised ? count : index);
		}
	}

	void Dock::cardChanged() {
		place();
		refreshPresented();
	}

	// The latest playable card lit is the one presented, falling back to any other still lit; none while locked or while a
	// card is being dragged.
	void Dock::refreshPresented() {
		std::vector<HandCard> lit;
		for (size_t index = 0; index < halves.size() && index < shown.halves.size(); ++index) {
			const Half& half = halves[index];
			for (size_t place = 0; place < half.cards.size() && place < shown.halves[index].hand.size(); ++place) {
				const auto*		view = static_cast<const dock::HandCardView*>(half.cards[place].get());
				const DockCard& card = shown.halves[index].hand[place];
				if (view != nullptr && view->lit() && card.playable && !isLocked && !dragged) {
					lit.push_back(card.card);
				}
			}
		}
		std::erase_if(presenting, [&lit](const HandCard& card) { return std::ranges::find(lit, card) == lit.end(); });
		for (const HandCard& card : lit) {
			if (std::ranges::find(presenting, card) == presenting.end()) {
				presenting.push_back(card);
			}
		}
		const std::optional<HandCard> latest = presenting.empty() ? std::nullopt : std::optional(presenting.back());
		if (latest != presented) {
			presented = latest;
			if (args.onPresented) {
				args.onPresented(presented);
			}
		}
	}

	void Dock::refreshEndTurnPreview() {
		const dock::Button* button = endTurn.get();
		const bool			now = button != nullptr && button->isShown() && button->isEnabledInTree() && !isLocked && button->lit();
		if (now != previewing) {
			previewing = now;
			if (args.onEndTurnPreview) {
				args.onEndTurnPreview(now);
			}
		}
	}

	void Dock::applyLock() {
		const bool over = shown.outcome.has_value();
		hands.get()->setPointerEvents(isLocked ? std::optional(ui::PointerEvents::None) : std::nullopt);
		hands.get()->setDescendantsFocusable(!isLocked);
		endTurn.get()->setVisible(!over);
		endTurn.get()->setLabel(isLocked ? "WAIT" : "END TURN");
		endTurn.get()->setEnabled(!isLocked && !over && shown.canEndTurn);
		leave.get()->setVisible(over);
		column.get()->show(shown.turn, shown.unspent, shown.outcome, isLocked);

		// A drag's callbacks find the dock again when they run: it may have gone by the time one ends.
		const ui::Ref<ui::Component> owner = self();
		for (size_t index = 0; index < halves.size() && index < shown.halves.size(); ++index) {
			const Half& half = halves[index];
			for (size_t place = 0; place < half.cards.size() && place < shown.halves[index].hand.size(); ++place) {
				ui::Component* view = half.cards[place].get();
				if (view == nullptr) {
					continue;
				}
				const DockCard& card = shown.halves[index].hand[place];
				if (!card.playable || isLocked) {
					view->clearDragSource();
					continue;
				}
				view->setDragSource({
					.kind = std::string(kCardDrag),
					.value = card.card,
					.onDragStart =
						[owner, held = card.card](const ui::Drag& /*drag*/) {
							if (auto* dock = static_cast<Dock*>(owner.get())) {
								dock->dragged = held;
								dock->cardChanged();
								if (dock->args.onDragStart) {
									dock->args.onDragStart(held);
								}
							}
						},
					.onDragEnd =
						[owner, held = card.card](const ui::Drag& drag) {
							if (auto* dock = static_cast<Dock*>(owner.get())) {
								dock->dragged.reset();
								if (dock->args.onDragEnd) {
									dock->args.onDragEnd(held, drag.dropped);
								}
								if (owner.get() != nullptr) {
									dock->cardChanged();
								}
							}
						},
				});
			}
		}
		place();
		refreshPresented();
		refreshEndTurnPreview();
	}

	void Dock::setLocked(bool locked) {
		if (locked == isLocked) {
			return;
		}
		isLocked = locked;
		const float target = locked ? 1.0F : 0.0F;
		if (getContext() == nullptr) {
			drop = target;
			return;
		}
		applyLock();
		dropTween = tween<float>({.from = drop, .to = target, .onUpdate = [this](const float& progress) { applyDrop(progress); }});
		if (!dropTween.running()) {
			applyDrop(target);
		}
	}

	// The hands and their scrim drop together; End Turn and the dock's ground stay put.
	void Dock::applyDrop(float progress) {
		drop = progress;
		const ui::Transform dropped{.translate = {0.0F, kLockDrop * progress}};
		hands.get()->setTransform(dropped);
		scrim.get()->setTransform(dropped);
		scrim.get()->setProgress(progress);
		scrim.get()->setVisible(progress > 0.0F);
	}

	cards::Card* Dock::card(HandCard card) const {
		for (const Half& half : halves) {
			if (half.driver == card.driver && card.handIndex >= 0 && card.handIndex < static_cast<int>(half.cards.size())) {
				return static_cast<dock::HandCardView*>(half.cards[static_cast<size_t>(card.handIndex)].get());
			}
		}
		return nullptr;
	}

	void Dock::describe(nlohmann::json& node) const {
		node["locked"] = isLocked;
		node["turn"] = shown.turn;
		node["unspent"] = shown.unspent;
		node["canEndTurn"] = shown.canEndTurn;
		node["outcome"] = shown.outcome ? nlohmann::json(*shown.outcome) : nlohmann::json(nullptr);
		node["presented"] =
			presented ? nlohmann::json{{"driver", presented->driver.value}, {"handIndex", presented->handIndex}} : nlohmann::json(nullptr);
		node["endTurnPreview"] = previewing;
	}

	void Dock::render() {
		const int32_t key = drawKey();
		Renderer::Primitives::drawRect({
			.bounds = {0.0F, 0.0F, size.x, size.y},
			.style = {.fill = ink::kDockTop, .gradient = Foundation::LinearGradient{.from = ink::kDockTop, .to = ink::kDockFoot}},
			.key = key,
		});
		Renderer::Primitives::drawRect({.bounds = {0.0F, 0.0F, size.x, 1.0F}, .style = {.fill = ink::kLine2}, .key = key});
	}

} // namespace game::battle
