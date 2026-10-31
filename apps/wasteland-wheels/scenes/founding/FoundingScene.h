#pragma once

#include "MapJob.h"
#include "scenes/GameScene.h"

#include <cstdint>
#include <memory>
#include <optional>
#include <string>

namespace game {

	struct FoundingArgs {
		// The seed to found on; a fresh one from the context when none.
		std::optional<uint32_t> seed;
	};

	// New Campaign (Game Flow 1.1; map-pipeline-worker.md, The founding contract): the area map made on a worker with its
	// progress shown, then the campaign founded on it and saved, the one it replaces going into the history as
	// abandoned, and the compound. Cancel stops the making at the next stage and goes back to the menu with nothing
	// changed. A seed whose attempts all fail says so and offers another.
	class FoundingScene final : public GameScene<FoundingArgs> {
	  public:
		explicit FoundingScene(FoundingArgs args);

		const char* name() const override { return scenes::kFounding; }
		void		update(const app::FrameContext& frame) override;
		std::string exportState() const override;

	  protected:
		void enter() override;

	  private:
		void start(uint32_t onSeed);
		void showFailure(const std::string& reason);
		void showProgress();

		std::optional<uint32_t>				 asked;
		uint32_t							 seed = 0;
		std::unique_ptr<MapJob<FoundingMap>> job;
		ui::Ref<ui::Text>					 progressLine;
		std::string							 shown;
		bool								 cancelling = false;
		std::string							 failure;
	};

} // namespace game
