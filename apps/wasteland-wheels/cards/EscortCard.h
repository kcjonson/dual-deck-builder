#pragma once

// The escort card (Game Flow 7.0): mini size, 80 by 112, so it lines up with the cards it adds. A hazard-stripe header no
// play card has, the vehicle (a placeholder silhouette until escorts have art), the name on two lines, structure as a bar
// and figures, and the signature card it brings ("+ Top Off"). Left at home for a run it's faded with a STAYING tag, and
// stays pressable so it can be brought back. It draws on the card's dark stock whatever the scene's theme.
//
// A press is its onPress. Its own detail view (the escort's profile beside its signature card) isn't ported.

#include <ui/components/Control.h>

#include <rules/campaign/Campaign.h>
#include <rules/packs/Pack.h>

#include <functional>
#include <string>
#include <vector>

namespace game::cards {

	namespace escort {
		inline constexpr Foundation::Vec2 kSize{80.0F, 112.0F};
		inline constexpr float			  kRadius = 5.0F;
		inline constexpr float			  kBorder = 2.0F;
		inline constexpr float			  kHeader = 10.0F;
		inline constexpr float			  kStripePeriod = 10.0F;
		inline constexpr float			  kStripe = 5.0F;
		inline constexpr float			  kContentX = 6.0F;
		inline constexpr float			  kContentWidth = 68.0F;
		inline constexpr float			  kArtY = 16.0F;
		inline constexpr float			  kArtHeight = 33.0F;
		inline constexpr float			  kNameY = 51.0F;
		inline constexpr float			  kNameSize = 13.0F;
		inline constexpr float			  kNameLine = 13.65F;
		inline constexpr int			  kNameLines = 2;
		inline constexpr float			  kRow = 11.0F;
		inline constexpr float			  kStructureY = 81.0F;
		inline constexpr float			  kBar = 5.0F;
		inline constexpr float			  kFigures = 28.0F;
		inline constexpr float			  kSignatureY = 93.0F;
		inline constexpr float			  kMono = 9.0F;
		inline constexpr float			  kTagRight = 84.0F;
		// How far it draws past its box: the tag up and right, the focus ring all round.
		inline constexpr float kInk = 7.0F;
	} // namespace escort

	struct EscortFace {
		std::string name;
		int			structure = 0;
		int			maxStructure = 0;
		std::string signature; // the signature card's name
		std::string tag;	   // STAYING, or none
	};

	// An escort in the convoy as its card shows it: what's left of its structure and the card it brings.
	[[nodiscard]] EscortFace escortFace(const rules::campaign::ConvoyEscort& escort, const rules::Content& content);

	class EscortCard : public ui::Control {
	  public:
		struct Args {
			UI_COMMON_ARGS
			EscortFace			  face;
			bool				  faded = false;
			std::function<void()> onPress;
		};

		explicit EscortCard(const Args& args);

		[[nodiscard]] const EscortFace& getFace() const { return face; }
		[[nodiscard]] bool				isFaded() const { return faded; }
		[[nodiscard]] const char*		typeName() const override { return "EscortCard"; }
		[[nodiscard]] float				inkExtent() const override { return escort::kInk; }
		void							describe(nlohmann::json& node) const override;

	  protected:
		void onMount() override;
		void render() override;
		void activate() override;

	  private:
		EscortFace				 face;
		bool					 faded;
		std::function<void()>	 onPress;
		std::vector<std::string> name;
		std::string				 signature;
	};

} // namespace game::cards
