add_library(ddb_sim STATIC
    Sim.cpp
)
add_library(ddb::sim ALIAS ddb_sim)

target_compile_features(ddb_sim PUBLIC cxx_std_20)

# libs/ is the include root, so the game's headers read <sim/...> and can't collide
# with salal's own roots (<random/...>, <math/...>).
target_include_directories(ddb_sim
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/..>
)

target_link_libraries(ddb_sim PUBLIC salal::foundation)

set_target_properties(ddb_sim PROPERTIES FOLDER libs)

ddb_add_tests(sim)
