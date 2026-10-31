#include "scenes/founding/FoundingScene.h"

#include "Words.h"

#include <rules/campaign/Founding.h>
#include <rules/map/MapPipeline.h>

#include <nlohmann/json.hpp>

#include <exception>
#include <utility>

namespace game {

	using rules::campaign::MapMaking;

	FoundingScene::FoundingScene(FoundingArgs args)
		: asked(args.seed) {}

	void FoundingScene::enter() {
		start(asked.value_or(game().newSeed()));
	}

	void FoundingScene::start(uint32_t onSeed) {
		seed = onSeed;
		cancelling = false;
		failure.clear();
		shown = "Making the area map";
		page = kit::openPage(*this, page, "New campaign", "Seed " + std::to_string(seed));
		progressLine = kit::text(page.body, shown, "progress");
		kit::button(page.footer, "cancel", "Cancel", [this] {
			if (job && !cancelling) {
				job->cancel();
				cancelling = true;
				kit::setNotice(page, "Cancelling");
			}
		});
		job = std::make_unique<MapJob<FoundingMap>>([found = game().maps.found, seed = onSeed](const MapMaking& making) {
			return found(seed, making);
		});
	}

	void FoundingScene::update(const app::FrameContext& /*frame*/) {
		if (!job) {
			return;
		}
		showProgress();
		if (!job->done()) {
			return;
		}
		std::unique_ptr<MapJob<FoundingMap>> finished = std::move(job);
		try {
			FoundingMap made = finished->take();
			if (cancelling) {
				// It finished before the stop reached it; a cancelled founding keeps nothing all the same.
				app().scenes().switchTo(scenes::kMainMenu);
				return;
			}
			const GameRules&		  loaded = game().rules;
			rules::campaign::Campaign campaign = rules::campaign::foundCampaign(
				loaded.content, loaded.campaign, rules::campaign::Founding{.map = made.origin, .unlocked = loaded.unlocked}
			);
			if (!game().store.replace(campaign)) {
				showFailure("The new campaign couldn't be saved.");
				return;
			}
			game().session = Session{.campaign = std::move(campaign), .map = std::move(made.map)};
			app().scenes().switchTo(scenes::kCompound);
		} catch (const rules::map::MapPipelineCancelled&) {
			app().scenes().switchTo(scenes::kMainMenu);
		} catch (const rules::map::MapPipelineError& error) {
			showFailure(std::string("No map could be made on this seed: ") + error.what());
		} catch (const std::exception& error) {
			LOG_ERROR(Game, "FoundingScene: founding on seed %u threw: %s", seed, error.what());
			showFailure(std::string("The founding failed: ") + error.what());
		}
	}

	void FoundingScene::showProgress() {
		const std::optional<MapProgress> progress = job->progress();
		if (!progress) {
			return;
		}
		std::string text = progressText(*progress);
		if (text != shown) {
			shown = std::move(text);
			if (ui::Text* line = progressLine.get()) {
				line->setText(shown);
			}
		}
	}

	void FoundingScene::showFailure(const std::string& reason) {
		failure = reason;
		page = kit::openPage(*this, page, "New campaign", "Seed " + std::to_string(seed));
		kit::text(page.body, failure, "failure");
		kit::button(page.footer, "another_seed", "Try another seed", [this] { start(game().newSeed()); }, ui::ButtonVariant::Primary);
		kit::button(page.footer, "back", "Back", [this] { app().scenes().switchTo(scenes::kMainMenu); });
	}

	std::string FoundingScene::exportState() const {
		return nlohmann::json{
			{"seed", seed}, {"progress", shown}, {"cancelling", cancelling}, {"failure", failure}, {"making", job != nullptr}
		}.dump();
	}

} // namespace game
