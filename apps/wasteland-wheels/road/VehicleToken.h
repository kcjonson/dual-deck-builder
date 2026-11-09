#pragma once

// The vehicle token (Battle Screen Design 3, vehicle-token.md): a fixed layout at 196 by 117, 135 with a passenger's row,
// that scales as a whole into its slot, between 1 and 1.25. A raider's intents run along the top, two pills then "+N";
// the sprite sits left with its speed under it; the plate holds the name, the armor shield beside the structure bar, and
// the driver's HP bar at the same weight; up to five status chips run under the plate, past five four and "+N". An
// escort has no HP bar, and its passenger's row takes that place, so it stays 117 tall; SPENT leads its statuses. A
// vehicle out of the fight greys out under a WRECKED stamp, or NO DRIVER for a raider with nobody alive aboard. It draws
// in the combat screen's dark palette, whatever the scene's theme. The battle scene fills TokenData from the fight.

#include <rules/battle/EnemyTurn.h>

#include <graphics/Color.h>
#include <ui/Component.h>

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace game::road {

	enum class TokenSide : uint8_t { Player, Escort, Raider };
	// Triangle for driver 1, diamond for driver 2, both for an area hit, square for an escort.
	enum class TargetMark : uint8_t { Triangle, Diamond, Both, Square };
	enum class Wreck : uint8_t { None, Wrecked, NoDriver };

	struct Meter {
		int value = 0;
		int max = 0;
	};

	struct TokenIntent {
		std::string				  value; // "6", "6x3", "?" for an elite's
		std::optional<TargetMark> mark;	 // none for a step on the raider itself
		rules::IntentKind		  kind = rules::IntentKind::Attack;
	};

	// What the road puts on a token at paint time (targeting-preview.md): the outline a target takes while a card is aimed,
	// the damage ghost on each bar the hit under the card takes from, a raider's range chip, the dim on one out of reach,
	// and the acting raider's glow.
	struct TokenLook {
		enum class Outline : uint8_t { None, Legal, Chosen };
		Outline					   outline = Outline::None;
		Foundation::Color		   outlineColor;
		int						   structureLoss = 0;
		int						   driverLoss = 0; // the HP row's: an escort's passenger
		int						   passengerLoss = 0;
		std::optional<std::string> rangeChip; // "R1", "OUT"
		bool					   chipLands = false;
		bool					   dimmed = false;
		bool					   acting = false;
	};

	struct TokenData {
		std::string				 name;
		TokenSide				 side = TokenSide::Player;
		std::optional<int>		 seat; // a player's vehicle's driver, 0 or 1: its mark and stripe
		Meter					 structure;
		int						 armor = 0;
		bool					 heavy = false; // armor past base: no speed boosts
		std::optional<Meter>	 driver;		// none for an escort
		std::optional<Meter>	 passenger;
		int						 speed = 0;
		std::vector<TokenIntent> intents;  // a raider's, in the order they'll act
		std::vector<std::string> statuses; // each a chip's short label ("SH4", "VUL2"), in the order they landed
		bool					 spent = false;
		Wreck					 wreck = Wreck::None;
	};

	class VehicleToken : public ui::Component {
	  public:
		static constexpr float kWidth = 196.0F;
		static constexpr float kHeight = 117.0F;
		static constexpr float kPassengerHeight = 135.0F;
		static constexpr float kMaxScale = 1.25F;
		static constexpr int   kMaxChips = 5;
		static constexpr int   kMaxIntents = 2;

		struct Args {
			UI_COMMON_ARGS
			TokenData data;
			float	  scale = 1.0F;
			// Asked as it draws; unset, it draws plain.
			std::function<TokenLook()> look;
		};

		explicit VehicleToken(const Args& args);

		// The token's height at scale 1: a passenger's row adds 18, except on an escort, where it takes the HP bar's place.
		[[nodiscard]] static float heightFor(const TokenData& data);
		// How far a token scales to fill a slot, the mock's min((w - 6) / 196, (h - 4) / height), neither capped nor
		// floored, so a caller can tell a slot too small (under 1) from one the token fills.
		[[nodiscard]] static float slotScale(Foundation::Vec2 slot, float tokenHeight);
		// The scale it takes in a slot: slotScale held between 1 and `cap`, which the road passes so every token on it
		// matches, itself at most 1.25.
		[[nodiscard]] static float fitScale(Foundation::Vec2 slot, float tokenHeight, float cap = kMaxScale);

		// The chips as they show: SPENT first, then the statuses, four and "+N" past five.
		[[nodiscard]] std::vector<std::string> shownChips() const;
		// The intent pills as they show: two, then "+N".
		[[nodiscard]] std::vector<std::string> shownIntents() const;

		[[nodiscard]] const TokenData& data() const { return token; }
		[[nodiscard]] float			   scale() const { return tokenScale; }
		void						   setData(TokenData data);
		void						   setScale(float scale);
		void						   setLook(std::function<TokenLook()> look);
		// The plate's box at scale 1, which a pick or an arrow lines up with.
		[[nodiscard]] Foundation::Rect plateRect() const;
		// Where a passenger's row starts down the token at scale 1, under the driver's HP.
		[[nodiscard]] static float passengerRowY();

		[[nodiscard]] const char* typeName() const override { return "VehicleToken"; }
		void					  describe(nlohmann::json& node) const override;
		[[nodiscard]] float		  inkExtent() const override;

	  protected:
		void										  render() override;
		[[nodiscard]] ui::PointerEvents				  defaultPointerEvents() const override { return ui::PointerEvents::Auto; }
		[[nodiscard]] std::optional<Foundation::Vec2> intrinsicSize(std::optional<float> width, float availableWidth) const override;

	  private:
		void renderPlate(int32_t key, bool wrecked, const TokenLook& look);
		void renderSprite(int32_t key, bool wrecked);
		void renderIntents(int32_t key, bool wrecked);
		void renderChips(int32_t key, bool wrecked);
		void renderStamp(int32_t key);
		void renderAim(int32_t key, const TokenLook& look);

		TokenData				   token;
		float					   tokenScale;
		std::function<TokenLook()> look;
	};

} // namespace game::road
