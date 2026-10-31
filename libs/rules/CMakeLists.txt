add_library(ddb_rules STATIC
    Rules.cpp
)
add_library(ddb::rules ALIAS ddb_rules)

target_compile_features(ddb_rules PUBLIC cxx_std_20)

# libs/ is the include root, so the game's headers read <rules/...> and can't collide
# with salal's own roots (<random/...>, <math/...>).
target_include_directories(ddb_rules
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/..>
)

target_link_libraries(ddb_rules PUBLIC salal::foundation)

set_target_properties(ddb_rules PROPERTIES FOLDER libs)

ddb_add_tests(rules)
