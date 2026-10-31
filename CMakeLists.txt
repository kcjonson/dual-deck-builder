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
    GIT_TAG        v0.19.0
    GIT_SHALLOW    TRUE
)
set(SALAL_BUILD_UI OFF)
set(SALAL_BUILD_APP OFF)
set(SALAL_BUILD_SANDBOX OFF)
set(SALAL_BUILD_TESTS OFF)
FetchContent_MakeAvailable(salal)

add_subdirectory(libs/rules)
add_subdirectory(libs/ai)

# The rules link nothing above salal::foundation, and never the AI or scripting, which depend on them; the AI
# links the rules and nothing else (rules-ai-and-packs.md).
function(ddb_check_layering)
    get_target_property(direct ddb_rules LINK_LIBRARIES)
    get_target_property(iface ddb_rules INTERFACE_LINK_LIBRARIES)
    foreach(dep IN LISTS direct iface)
        if(dep MATCHES "(^|[:<])salal(_|::)(renderer|ui|app)>?$" OR dep MATCHES "(^|[:<])(OpenGL::|GLEW::|glfw>?$)")
            message(FATAL_ERROR "Dependency rule: ddb_rules links ${dep}; the rules link salal::foundation only (salal/docs/architecture.md).")
        endif()
        if(dep MATCHES "(^|[:<])ddb(_|::)(ai|scripting)>?$")
            message(FATAL_ERROR "Dependency rule: ddb_rules links ${dep}; the AI and scripting depend on the rules, never the other way.")
        endif()
    endforeach()
    get_target_property(direct ddb_ai LINK_LIBRARIES)
    get_target_property(iface ddb_ai INTERFACE_LINK_LIBRARIES)
    foreach(dep IN LISTS direct iface)
        if(NOT dep MATCHES "^(\\$<LINK_ONLY:)?ddb(_|::)rules>?$")
            message(FATAL_ERROR "Dependency rule: ddb_ai links ${dep}; the AI links ddb::rules only, which brings salal::foundation.")
        endif()
    endforeach()
endfunction()

ddb_check_layering()
