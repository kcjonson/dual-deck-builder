# Wasteland Wheels in C++ on salal. The TypeScript version it ports from is frozen
# under _legacy/ and has nothing to do with this build.
#
# The dependency rule, salal's (salal/docs/architecture.md): the game's rules,
# libs/rules, link salal::foundation and nothing above it, so they stay deterministic
# and testable headless. ddb_check_layering() at the bottom holds that.

# 3.25 for CMAKE_MSVC_DEBUG_INFORMATION_FORMAT (CMP0141): the Windows preset
# selects /Z7 embedded debug info, which ccache requires to cache MSVC objects.
cmake_minimum_required(VERSION 3.25)

# Refuse Visual Studio's bundled vcpkg. A developer shell (vcvars64, VsDevCmd) sets
# VCPKG_ROOT to it, over your own checkout, and the preset's toolchain follows: no
# binary cache, every port built from source. vcpkg installs the manifest's ports
# inside project(), so the check sits before it.
if(CMAKE_TOOLCHAIN_FILE)
    block(SCOPE_FOR VARIABLES)
        string(REPLACE "\\" "/" toolchain "${CMAKE_TOOLCHAIN_FILE}")
        string(TOLOWER "${toolchain}" toolchain_lower)
        if(toolchain_lower MATCHES "^(.*/microsoft visual studio/.+/vc/vcpkg)(/|$)")
            string(LENGTH "${CMAKE_MATCH_1}" bundled_length)
            string(SUBSTRING "${toolchain}" 0 ${bundled_length} bundled)
            message(FATAL_ERROR
                "CMAKE_TOOLCHAIN_FILE is in Visual Studio's bundled vcpkg (${bundled}); a developer shell sets VCPKG_ROOT to it.\n"
                "Set VCPKG_ROOT to your own vcpkg checkout, then configure with --fresh or delete the build directory.")
        endif()
    endblock()
endif()

project(dual_deck_builder VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# MSVC enforces C++20 declaration order for designated initializers (C7560);
# the matching error on Clang catches the same portability break locally.
if(MSVC)
    add_compile_options(/utf-8)
else()
    include(CheckCXXCompilerFlag)
    check_cxx_compiler_flag("-Werror=reorder-init-list" DDB_HAS_WERROR_REORDER_INIT_LIST)
    if(DDB_HAS_WERROR_REORDER_INIT_LIST)
        add_compile_options(-Werror=reorder-init-list)
    endif()
endif()

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set_property(GLOBAL PROPERTY USE_FOLDERS ON)

include(CTest)
include(cmake/DdbTesting.cmake)

# The engine, pinned to a tag. Its vcpkg.json is ignored here (manifest mode reads
# only the top-level manifest); this repo's provides every port it needs. To build
# against the sibling checkout instead of the tag:
#   cmake --preset windows -DFETCHCONTENT_SOURCE_DIR_SALAL=C:/Users/kevin/Code/salal
include(FetchContent)
FetchContent_Declare(salal
    GIT_REPOSITORY https://github.com/kcjonson/salal.git
    GIT_TAG        v0.30.1
    GIT_SHALLOW    TRUE
)
# The game links app, which hosts ui; its dev server is compiled into Debug and RelWithDebInfo only, and needs
# cpp-httplib there. salal_base_shader() needs glslangValidator, the glslang port's tools, as a host dependency.
set(SALAL_BUILD_UI ON)
set(SALAL_BUILD_APP ON)
set(SALAL_BUILD_SANDBOX OFF)
set(SALAL_BUILD_TESTS OFF)
FetchContent_MakeAvailable(salal)

add_subdirectory(libs/rules)
add_subdirectory(libs/ai)
add_subdirectory(apps/balance-sim)
add_subdirectory(apps/wasteland-wheels)

# Every target a directory and the directories under it define.
function(_ddb_targets_under dir out)
    get_property(targets DIRECTORY ${dir} PROPERTY BUILDSYSTEM_TARGETS)
    get_property(subdirs DIRECTORY ${dir} PROPERTY SUBDIRECTORIES)
    foreach(sub IN LISTS subdirs)
        _ddb_targets_under(${sub} more)
        list(APPEND targets ${more})
    endforeach()
    set(${out} ${targets} PARENT_SCOPE)
endfunction()

# Only an app links salal's renderer, ui, or app, or GL: nothing under libs/ does, its tests included. The rules link
# nothing above salal::foundation, and never the AI, scripting, or an app, which depend on them; the AI links the rules
# and nothing else (rules-ai-and-packs.md). The balance sim is headless too: its core links the rules and the AI and
# nothing else, and its tool links its core. The game's core links the rules, the AI, and salal's app and ui, and the
# game links its core and the renderer its base shader is compiled against (game-app.md).
function(ddb_check_layering)
    get_property(top_dirs DIRECTORY ${PROJECT_SOURCE_DIR} PROPERTY SUBDIRECTORIES)
    set(lib_targets "")
    foreach(dir IN LISTS top_dirs)
        if(dir MATCHES "^${PROJECT_SOURCE_DIR}/libs/")
            _ddb_targets_under(${dir} under)
            list(APPEND lib_targets ${under})
        endif()
    endforeach()
    if(NOT TARGET ddb_rules OR NOT "ddb_rules" IN_LIST lib_targets)
        message(FATAL_ERROR "ddb_check_layering: found no targets under libs/, so it checks nothing.")
    endif()
    foreach(target IN LISTS lib_targets)
        get_target_property(direct ${target} LINK_LIBRARIES)
        get_target_property(iface ${target} INTERFACE_LINK_LIBRARIES)
        foreach(dep IN LISTS direct iface)
            if(dep MATCHES "(^|[:<])salal(_|::)(renderer|ui|app)>?$" OR dep MATCHES "(^|[:<])(OpenGL::|GLEW::|glfw>?$)")
                message(FATAL_ERROR "Dependency rule: ${target} links ${dep}; only an app links salal's renderer, ui, or app (salal/docs/architecture.md).")
            endif()
            if(dep MATCHES "(^|[:<])ddb(_|::)game>?$")
                message(FATAL_ERROR "Dependency rule: ${target} links ${dep}; the game depends on the libraries, never the other way.")
            endif()
        endforeach()
    endforeach()
    get_target_property(direct ddb_rules LINK_LIBRARIES)
    get_target_property(iface ddb_rules INTERFACE_LINK_LIBRARIES)
    foreach(dep IN LISTS direct iface)
        if(dep MATCHES "(^|[:<])salal(_|::)(renderer|ui|app)>?$" OR dep MATCHES "(^|[:<])(OpenGL::|GLEW::|glfw>?$)")
            message(FATAL_ERROR "Dependency rule: ddb_rules links ${dep}; the rules link salal::foundation only (salal/docs/architecture.md).")
        endif()
        if(dep MATCHES "(^|[:<])ddb(_|::)(ai|scripting|balance_sim)>?$")
            message(FATAL_ERROR "Dependency rule: ddb_rules links ${dep}; the AI, scripting, and apps depend on the rules, never the other way.")
        endif()
    endforeach()
    get_target_property(direct ddb_ai LINK_LIBRARIES)
    get_target_property(iface ddb_ai INTERFACE_LINK_LIBRARIES)
    foreach(dep IN LISTS direct iface)
        if(NOT dep MATCHES "^(\\$<LINK_ONLY:)?ddb(_|::)rules>?$")
            message(FATAL_ERROR "Dependency rule: ddb_ai links ${dep}; the AI links ddb::rules only, which brings salal::foundation.")
        endif()
    endforeach()
    get_target_property(direct ddb_balance_sim LINK_LIBRARIES)
    get_target_property(iface ddb_balance_sim INTERFACE_LINK_LIBRARIES)
    foreach(dep IN LISTS direct iface)
        if(NOT dep MATCHES "^(\\$<LINK_ONLY:)?ddb(_|::)(rules|ai)>?$")
            message(FATAL_ERROR "Dependency rule: ddb_balance_sim links ${dep}; the balance sim links ddb::rules and ddb::ai only.")
        endif()
    endforeach()
    get_target_property(direct balance-sim LINK_LIBRARIES)
    foreach(dep IN LISTS direct)
        if(NOT dep MATCHES "^ddb(_|::)balance_sim$")
            message(FATAL_ERROR "Dependency rule: balance-sim links ${dep}; the tool links the sim's core only.")
        endif()
    endforeach()
    get_target_property(direct ddb_game LINK_LIBRARIES)
    get_target_property(iface ddb_game INTERFACE_LINK_LIBRARIES)
    foreach(dep IN LISTS direct iface)
        if(NOT dep MATCHES "^(\\$<LINK_ONLY:)?(ddb(_|::)(rules|ai)|salal(_|::)(app|ui))>?$")
            message(FATAL_ERROR "Dependency rule: ddb_game links ${dep}; the game's core links ddb::rules, ddb::ai, and salal's app and ui only.")
        endif()
    endforeach()
    get_target_property(direct wasteland-wheels LINK_LIBRARIES)
    foreach(dep IN LISTS direct)
        if(NOT dep MATCHES "^(ddb(_|::)game|salal(_|::)renderer)$")
            message(FATAL_ERROR "Dependency rule: wasteland-wheels links ${dep}; the game links its core, and the renderer its base shader names.")
        endif()
    endforeach()
endfunction()

ddb_check_layering()
