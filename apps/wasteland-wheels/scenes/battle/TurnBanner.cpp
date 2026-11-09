#include "scenes/battle/TurnBanner.h"

#include "Fonts.h"
#include "cards/CardInk.h"
#include "scenes/battle/BattleInk.h"

#include <primitives/Primitives.h>
#include <ui/Context.h>
#include <ui/theme/Tokens.h>

#include <algorithm>
#include <cmath>
#include <utility>

namespace game::battle {

	namespace {

		// The mock's .banner: 32 px display spaced 0.28 em, solid from a quarter of the way across to three quarters, the
		// words sliding in from the left and out to the right by a share of the width.
		constexpr float				kTextSize = 32.0F;
		constexpr float				kLetterSpacing = kTextSize * 0.28F;
		constexpr float				kSolidFrom = 0.25F;
		constexpr float				kSlide = 0.12F;
		constexpr Foundation::Color kRaidersText = cards::hex(0xFFD8D0);

		Foundation::Color faded(Foundation::Color color, float alpha) {
			color.a *= alpha;
			return color;
		}

	} // namespace

	TurnBanner::TurnBanner(const Args& /*args*/) {}

	void TurnBanner::announce(rules::Side side) {
		const bool yours = side == rules::Side::Player;
		bring(
			yours ? "YOUR TURN" : "RAIDERS' TURN", yours ? ink::kBannerPlayer : ink::kBannerRaiders, yours ? ink::kBone : kRaidersText, true
		);
	}

	void TurnBanner::announceEnd(std::string text) {
		bring(std::move(text), ink::kBannerPlayer, ink::kBone, false);
	}

	bool TurnBanner::showing() const {
		return up;
	}

	std::string TurnBanner::text() const {
		return up ? shownText : std::string();
	}

	void TurnBanner::onMount() {
		if (getSizeSpec().height.isAuto()) {
			setSize({getSizeSpec().width, kBandHeight});
		}
		setVisible(up);
		if (up) {
			enter();
		}
	}

	void TurnBanner::bring(std::string words, Foundation::Color band, Foundation::Color ink, bool leaving) {
		shownText = std::move(words);
		bandColor = band;
		textColor = ink;
		leaves = leaving;
		up = true;
		if (getContext() == nullptr) {
			return;
		}
		setVisible(true);
		enter();
	}

	void TurnBanner::enter() {
		if (hold.valid()) {
			getContext()->getAnimator().cancel(hold);
			hold = {};
		}
		const ui::Theme& theme = getContext()->getTheme();
		// Through the animator, so under reduced motion it lands in place on its first tick; the hold is reading time and
		// runs on the clock either way.
		motion = tween<float>({
			.from = 0.0F,
			.to = 1.0F,
			.durationMs = theme.get(ui::tokens::motion::duration::normal),
			.easing = ui::Easing(theme.get(ui::tokens::motion::easing::enter)),
			.onUpdate = [this](const float& at) { travel = at; },
			.onComplete =
				[this] {
					if (leaves) {
						hold = after(static_cast<double>(kHold) * 1000.0, [this] {
							hold = {};
							leave();
						});
					}
				},
		});
	}

	void TurnBanner::leave() {
		const ui::Theme& theme = getContext()->getTheme();
		motion = tween<float>({
			.from = 1.0F,
			.to = 2.0F,
			.durationMs = theme.get(ui::tokens::motion::duration::normal),
			.easing = ui::Easing(theme.get(ui::tokens::motion::easing::exit)),
			.onUpdate = [this](const float& at) { travel = at; },
			.onComplete =
				[this] {
					up = false;
					setVisible(false);
				},
		});
	}

	void TurnBanner::render() {
		const float alpha = std::clamp(1.0F - std::abs(travel - 1.0F), 0.0F, 1.0F) * opacity();
		if (alpha <= 0.0F) {
			return;
		}
		const int32_t			key = drawKey();
		const float				top = (size.y - kBandHeight) * 0.5F;
		const float				edge = size.x * kSolidFrom;
		const Foundation::Color band = faded(bandColor, alpha);
		const Foundation::Color clear = faded(bandColor, 0.0F);
		Renderer::Primitives::drawRect({
			.bounds = {0.0F, top, edge, kBandHeight},
			.style = {.fill = band, .gradient = Foundation::LinearGradient{.from = clear, .to = band, .horizontal = true}},
			.key = key,
		});
		Renderer::Primitives::drawRect({.bounds = {edge, top, size.x - 2.0F * edge, kBandHeight}, .style = {.fill = band}, .key = key});
		Renderer::Primitives::drawRect({
			.bounds = {size.x - edge, top, edge, kBandHeight},
			.style = {.fill = band, .gradient = Foundation::LinearGradient{.from = band, .to = clear, .horizontal = true}},
			.key = key,
		});
		cards::drawWords({
			.text = shownText,
			.at = {(travel - 1.0F) * kSlide * size.x, top},
			.face = fonts::kDisplayBold,
			.size = kTextSize,
			.color = faded(textColor, alpha),
			.align = Foundation::HorizontalAlign::Center,
			.boxWidth = size.x,
			.boxHeight = kBandHeight,
			.letterSpacing = kLetterSpacing,
			.key = key,
		});
	}

} // namespace game::battle
