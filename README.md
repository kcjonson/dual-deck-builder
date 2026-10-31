# Wasteland Wheels

A roguelike deckbuilder with vehicular combat in a post-apocalyptic setting. You drive two vehicles at once, each with its own driver and deck.

This is the C++ early alpha, built on [salal](https://github.com/kcjonson/salal). The TypeScript proof of concept it grew from is frozen in [`_legacy/`](_legacy/).

## Building

Needs CMake 3.25+, vcpkg with `VCPKG_ROOT` set, Ninja, ccache, and MSVC on Windows or Clang/GCC elsewhere.

```bash
cmake --preset windows
```

```bash
cmake --build --preset windows
```

```bash
ctest --test-dir build -C Debug
```

On macOS and Linux use the `default` preset with `-DCMAKE_BUILD_TYPE=Debug`, then `cmake --build build` and `ctest --test-dir build`.

`node scripts/format.mjs` checks formatting with clang-format 21; `--fix` applies it.

## Docs

[docs/README.md](docs/README.md) indexes the specs, the decision records and the port plan. [CLAUDE.md](CLAUDE.md) has the conventions.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Contributions are under the terms in [CONTRIBUTING.md](CONTRIBUTING.md).
