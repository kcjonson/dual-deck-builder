# Wasteland Wheels, the game (game-app.md): its scenes on salal's app and ui over the rules and the AI. The game's code
# is a library the executable and the tests share; ddb_check_layering() in the root holds what each links.
find_package(nlohmann_json CONFIG REQUIRED)

add_library(ddb_game STATIC
    CampaignStore.cpp
    DevRoutes.cpp
    GameRules.cpp
    Session.cpp
    Words.cpp
    scenes/SceneKit.cpp
    scenes/Scenes.cpp
    scenes/battle/BattleScene.cpp
    scenes/compound/CompoundScene.cpp
    scenes/debrief/DebriefScene.cpp
    scenes/end/CampaignEndScene.cpp
    scenes/founding/FoundingScene.cpp
    scenes/loading/LoadingScene.cpp
    scenes/loadout/LoadOutScene.cpp
    scenes/map/AreaMapScene.cpp
    scenes/menu/MainMenuScene.cpp
    scenes/run/RunScene.cpp
    scenes/settings/SettingsScene.cpp
    scenes/splash/SplashScene.cpp
)
add_library(ddb::game ALIAS ddb_game)

target_compile_features(ddb_game PUBLIC cxx_std_20)
target_include_directories(ddb_game PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(ddb_game PUBLIC ddb::rules ddb::ai salal::app salal::ui)
set_target_properties(ddb_game PROPERTIES FOLDER apps)

# The base pack is read from the source tree, as the balance sim reads it, until playtest builds ship their packs.
add_executable(wasteland-wheels Main.cpp)
target_link_libraries(wasteland-wheels PRIVATE ddb::game)
target_compile_definitions(wasteland-wheels PRIVATE DDB_PACKS_DIR="${PROJECT_SOURCE_DIR}/packs")
set_target_properties(wasteland-wheels PROPERTIES FOLDER apps)

# The renderer's base shader with no hooks, as a game with none gets it.
salal_base_shader(wasteland-wheels)

# The placeholder font atlas and its licence, beside the exe on every build, where AppConfig::fontAtlases' paths resolve.
set(game_fonts
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/JetBrainsMono-SDF.png
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/JetBrainsMono-SDF.json
    ${CMAKE_CURRENT_SOURCE_DIR}/fonts/OFL.txt
)
add_custom_target(wasteland-wheels-fonts
    COMMAND ${CMAKE_COMMAND} -E make_directory $<TARGET_FILE_DIR:wasteland-wheels>/fonts
    COMMAND ${CMAKE_COMMAND} -E copy_if_different ${game_fonts} $<TARGET_FILE_DIR:wasteland-wheels>/fonts
    COMMENT "Staging the game's font atlas"
    VERBATIM
)
set_target_properties(wasteland-wheels-fonts PROPERTIES FOLDER apps)
add_dependencies(wasteland-wheels wasteland-wheels-fonts)

ddb_add_tests(game DEFINITIONS DDB_PACKS_DIR="${PROJECT_SOURCE_DIR}/packs")
