find_package(nlohmann_json CONFIG REQUIRED)

add_library(ddb_rules STATIC
    core/Card.cpp
    core/Condition.cpp
    core/Deck.cpp
    core/Driver.cpp
    core/Effect.cpp
    core/Escort.cpp
    core/JsonReader.cpp
    core/Opponent.cpp
    core/RandomStreams.cpp
    core/Road.cpp
    core/Vehicle.cpp
    packs/Pack.cpp
)
add_library(ddb::rules ALIAS ddb_rules)
add_subdirectory(map)

target_compile_features(ddb_rules PUBLIC cxx_std_20)

# libs/ is the include root, so the game's headers read <rules/...> and can't collide
# with salal's own roots (<random/...>, <math/...>).
target_include_directories(ddb_rules
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/..>
)

# PUBLIC: JsonReader.h, which every definition's reader takes, names nlohmann::json.
target_link_libraries(ddb_rules PUBLIC salal::foundation nlohmann_json::nlohmann_json)

set_target_properties(ddb_rules PROPERTIES FOLDER libs)

ddb_add_tests(rules)
if(TARGET ddb_rules_tests)
    target_compile_definitions(ddb_rules_tests PRIVATE DDB_PACKS_DIR="${PROJECT_SOURCE_DIR}/packs")
endif()
