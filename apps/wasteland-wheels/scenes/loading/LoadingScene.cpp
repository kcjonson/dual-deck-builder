// Continue (campaign-save-and-load.md): the save read strictly and its map made again on a worker, as founding makes
// one, then the compound, or the run where it was on the road. A save that won't load, its fingerprint another map's or
// anything else the rules refuse, says why and offers a new campaign in its place; there are no migrations.

#include "MapJob.h"
#include "Words.h"
#include "scenes/GameScene.h"
#include "scenes/founding/FoundingScene.h"

#include <rules/core/ContentError.h>
#include <rules/map/MapPipeline.h>

#include <nlohmann/json.hpp>

#include <exception>
#include <memory>
#include <utility>

namespace game {

	namespace {

		using rules::campaign::MapMaking;

		class LoadingScene final : public GameScene<> {
		  public:
			const char* name() const override { return scenes::kLoading; }

			std::string exportState() const override {
				return nlohmann::json{{"progress", shown}, {"failure", failure}, {"loading", job != nullptr}}.dump();
			}

			void update(const app::FrameContext& /*frame*/) override {
				if (!job) {
					return;
				}
				if (const std::optional<MapProgress> progress = job->progress()) {
					if (std::string text = progressText(*progress); text != shown) {
						shown = std::move(text);
						if (ui::Text* line = progressLine.get()) {
							line->setText(shown);
						}
					}
				}
				if (!job->done()) {
					return;
				}
				std::unique_ptr<MapJob<Session>> finished = std::move(job);
				try {
					Session	   loaded = finished->take();
					const bool ended = loaded.campaign.end.has_value();
					const bool onTheRoad = loaded.campaign.run.has_value() && loaded.campaign.run->route.has_value();
					game().session = std::move(loaded);
					app().scenes().switchTo(ended ? scenes::kCampaignEnd : onTheRoad ? scenes::kRun : scenes::kCompound);
				} catch (const rules::map::MapPipelineCancelled&) {
					app().scenes().switchTo(scenes::kMainMenu);
				} catch (const rules::ContentError& error) {
					showFailure(error.what());
				} catch (const std::exception& error) {
					LOG_ERROR(Game, "LoadingScene: the load threw: %s", error.what());
					showFailure(error.what());
				}
			}

		  protected:
			void enter() override {
				std::optional<nlohmann::json> save = game().store.saveJson();
				if (!save) {
					LOG_ERROR(Game, "LoadingScene: there's no save to continue; back to the main menu");
					app().scenes().switchTo(scenes::kMainMenu);
					return;
				}
				game().session.reset();
				page = kit::openPage(*this, page, "Continue");
				shown = "Making the area map";
				progressLine = kit::text(page.body, shown, "progress");
				kit::button(page.footer, "back", "Back", [this] {
					if (job) {
						job->cancel();
					} else {
						app().scenes().switchTo(scenes::kMainMenu);
					}
				});
				job = std::make_unique<MapJob<Session>>([load = game().maps.load, json = std::move(*save)](const MapMaking& making) {
					return load(json, making);
				});
			}

		  private:
			void showFailure(const std::string& reason) {
				failure = reason;
				page = kit::openPage(*this, page, "Continue", "This campaign can't be continued.");
				kit::text(page.body, failure, "failure");
				kit::button(
					page.footer,
					"start_fresh",
					"Start a new campaign",
					[this] { app().scenes().reset<FoundingScene>(); },
					ui::ButtonVariant::Primary
				);
				kit::button(page.footer, "back", "Back", [this] { app().scenes().switchTo(scenes::kMainMenu); });
			}

			std::unique_ptr<MapJob<Session>> job;
			ui::Ref<ui::Text>				 progressLine;
			std::string						 shown;
			std::string						 failure;
		};

	} // namespace

	std::unique_ptr<app::Scene> scenes::makeLoadingScene() {
		return std::make_unique<LoadingScene>();
	}

} // namespace game
