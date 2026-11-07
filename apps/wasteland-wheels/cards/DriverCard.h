#pragma once

// The driver card (Game Flow 7.0): a person as a card, 104 by 146, a little bigger than a mini since it sits beside their
// deck. A riveted double frame no play card has, a portrait (a placeholder head and shoulders until drivers have art),
// the name on two lines whether it needs them or not so a row keeps its specialty, HP bar and foot level, the specialty
// (or how a lost driver went), HP as a bar and figures, and the hand limit and deck size. Tags straddle the top edge:
// where they stand (INJURED, LOST, SEAT 1, SEAT 2) and CUSTOM beside it for a run deck customized at load out. Faded is a
// driver who can't be picked where they're shown; the reason is the consumer's to say under it. It draws on the card's
// dark stock whatever the scene's theme, as a play card does.
//
// A press is its onPress. Its own detail view (the driver's stats and deck) isn't ported; the deck shows beside it on
// every scene that has one.

#include <ui/components/Control.h>

#include <rules/campaign/Campaign.h>
#include <rules/packs/Pack.h>

#include <functional>
#include <string>
#include <vector>

namespace game::cards {

	namespace driver {
		inline constexpr Foundation::Vec2 kSize{104.0F, 146.0F};
		inline constexpr float			  kRadius = 2.0F;
		inline constexpr float			  kOuter = 2.0F;
		inline constexpr float			  kGap = 2.0F;
		inline constexpr float			  kRivetInset = 8.0F;
		inline constexpr float			  kRivet = 1.5F;
		inline constexpr float			  kContentX = 11.0F;
		inline constexpr float			  kContentWidth = 82.0F;
		inline constexpr float			  kPortraitY = 10.0F;
		inline constexpr float			  kPortraitHeight = 60.0F;
		inline constexpr float			  kNameY = 74.0F;
		inline constexpr float			  kNameSize = 13.0F;
		inline constexpr float			  kNameLine = 13.65F;
		inline constexpr int			  kNameLines = 2;
		inline constexpr float			  kRow = 11.0F;
		inline constexpr float			  kSpecialtyY = 102.0F;
		inline constexpr float			  kSpecialtySize = 10.0F;
		inline constexpr float			  kHpY = 114.0F;
		inline constexpr float			  kBar = 5.0F;
		inline constexpr float			  kFigures = 38.0F;
		inline constexpr float			  kFootY = 126.0F;
		inline constexpr float			  kMono = 9.0F;
		// The tags straddle the top edge and hang past the right one; CUSTOM stands left of a status tag, this far apart.
		inline constexpr float kTagRight = 108.0F;
		inline constexpr float kTagGap = 3.0F;
		// How far it draws past its box: a tag up and right, the focus ring all round.
		inline constexpr float kInk = 7.0F;
	} // namespace driver

	// What a driver card shows, as plain data each scene fills from its own model.
	struct DriverFace {
		std::string name;	   // "Road Warrior 2"
		std::string specialty; // "DEFENSIVE TANK", or how a lost driver went
		int			hitpoints = 0;
		int			maxHitpoints = 0;
		int			handLimit = 0;
		int			deckSize = 0;
		std::string tag; // INJURED, LOST, SEAT 1, SEAT 2, or none
		bool		custom = false;
	};

	// A driver in the pool as the card shows them: their name as the campaign gives it, their archetype's specialty and
	// maxima, the deck they'd take (the run deck's cards while they're seated on a run out), where they stand, and CUSTOM
	// once that run deck differs from their default deck.
	[[nodiscard]] DriverFace
	driverFace(const rules::campaign::Campaign& campaign, const rules::Content& content, const rules::campaign::DriverRecord& driver);

	class DriverCard : public ui::Control {
	  public:
		struct Args {
			UI_COMMON_ARGS
			DriverFace			  face;
			bool				  faded = false;
			std::function<void()> onPress;
		};

		explicit DriverCard(const Args& args);

		[[nodiscard]] const DriverFace&				  getFace() const { return face; }
		[[nodiscard]] const std::vector<std::string>& nameLines() const { return name; }
		[[nodiscard]] bool							  isFaded() const { return faded; }
		[[nodiscard]] const char*					  typeName() const override { return "DriverCard"; }
		[[nodiscard]] float							  inkExtent() const override { return driver::kInk; }
		void										  describe(nlohmann::json& node) const override;

	  protected:
		void onMount() override;
		void render() override;
		void activate() override;

	  private:
		DriverFace				 face;
		bool					 faded;
		std::function<void()>	 onPress;
		std::vector<std::string> name;
		std::string				 specialty;
	};

} // namespace game::cards
