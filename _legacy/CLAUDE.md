# CLAUDE.md - AI Assistant Instructions

> **Frozen.** This is the TypeScript proof of concept, kept as a reference while the game is rebuilt in C++ on salal at the repo root (see the root `CLAUDE.md`). No features, fixes or refactors here; only what keeps it building. Paths below are relative to `_legacy/`, and npm commands run from inside it. The CI, deploy and Specboard notes below describe how it used to work: GitHub Actions are off.

## Your instructions as a developer
- you are a game developer working on a professional game
- you should hold yourself to high code standards for orginization, performance and maintainence, and use industry best practices
- you should always read the relevant docs and seek to gain project knowledge and context via what we have documented
- if you do not have enough information to make an intellegent professional decision, please ask

## Project Overview

**Wasteland Wheels** is a deckbuilder roguelike game set in a post-apocalyptic world featuring vehicular combat with a unique "Symbiotic Driver System" where players control two drivers/vehicles simultaneously. Built with TypeScript, WebGL rendering, and designed for both web and desktop (Electron) platforms.

## Move fast, fail loud

**IMPORTANT**: this is an early prototype for playtesting. Speed beats stability, and the emphasis is on failing loud.

- Main is allowed to break, as long as it breaks loudly and the next session fixes it. Don't hold work back to make main bulletproof.
- Playtesting happens on the SFTP deploy of main (bearcavinteractive.com/playtest/dual-deckbuilder/) and locally. The Electron builds and other channels exist only so we don't fall too far behind on them.
- Fail loud in code. Throw, or log an error the console and the boot smoke will see, rather than catching and carrying on, returning a quiet default, or adding a fallback that hides a broken state. A crash we can see beats a game that silently plays wrong.
- Fail loud in CI. `.github/workflows/main.yml` runs every check after merge, and each failing one opens a `main is broken: <check>` issue under the `main-broken` label (a failed playtest deploy does too). At the start of a session, run `gh issue list --label main-broken`; fixing an open one comes before new work.
- The UI changes daily, so there are no screenshot baselines or pixel comparisons. Don't add them. See `docs/AI_TECHNICAL_DECISIONS/prototype-ci.md`.

## Project Structure

```
src/
├── renderer/
│   ├── engine/           # Reusable game engine components
│   │   ├── components/   # Base UI components (Rectangle, Text, Container, Stack)
│   │   ├── rendering/    # WebGL rendering system
│   │   ├── input/        # Input handling system
│   │   └── ui/          # Higher-level UI components (Button, Panel, Input)
│   ├── game/            # Game-specific logic
│   │   ├── core/        # Core game systems (Screen, State, Assets)
│   │   ├── mechanics/   # Game mechanics (Card, Deck, Battle)
│   │   └── screens/     # Game screens (MainMenu, Splash, Developer)
│   └── utils/           # Utility functions
├── electron/            # Electron-specific code
├── assets/             # Game assets
│   └── shaders/        # GLSL shader files
└── docs/               # Documentation
```

## Development Guidelines

### 1. Code Organization

- Keep engine code separate from game-specific code
- Use the component-based architecture for all UI elements
- Follow the existing patterns for screens and game states
- Maintain clear separation of concerns

### 2. Documentation Requirements

- **IMPORTANT**: Track all work, status, and progress on Specboard, never in the repo (see Important Notes below)
- Place detailed documentation in the `/docs/` folder where appropriate
- Include inline comments for complex logic
- Document new components with JSDoc comments

### 3. Testing Guidelines

- [docs/testing/README.md](../docs/testing/README.md) is the strategy. Look for actual regressions, never pixel changes: no golden images or screenshot diffs
- Before committing, run the relevant happy-path scripts (`docs/testing/happy-path/`) as a manual regression pass with the cheapest subagent fleet that can, and add lines when a feature lands
- Performance is strict: rendering or hot-path changes run `scripts/perf-capture.mjs` against `main`
- Keep unit tests bounded: look for a test covering the same path before adding one
- Write unit tests for new game mechanics
- Use the existing test setup with Jest
- Test UI components with the InputSystem mock
- Ensure cross-platform compatibility
- Test like a developer with a day's work in front of them: while iterating, run only the tests for what you touched (`npx jest <path>`, or `npm run test:changed` for everything that imports a changed file), then run the full `npm test` once when a block of related work is done, not after every edit or commit
- `npm test` skips the slow map-generation tests; run `npm run test:slow` when you change map generation (`src/renderer/game/map/`), and nightly CI runs them regardless
- `npm run test:smoke` builds the web bundle and boots it, then opens every game screen in a browser and fails on any console error; run it after changing boot, loading, or a screen's mount

### 4. Performance Considerations

- Keep draw calls minimal in the WebGL renderer
- Batch rendering operations where possible
- Profile and optimize the game loop
- Consider mobile performance for web version

## Working with the Codebase

### Adding New Screens

1. Create a new class extending `Screen` in `src/renderer/game/screens/<screen-name>/`
2. Implement lifecycle methods as needed: `onMount()`, `onUnmount()`, `onUpdate()`, `onRender()`, `onResized()`
3. Register the screen in `ScreenManager.screenConstructors` (`src/renderer/game/core/ScreenManager.ts`), and add it to `SCREENS` in `tests/smoke/screens/screens.spec.ts` so the boot smoke opens it
4. Navigate with `ScreenManager.navigate(screenName, data?)`; do not create UI in constructors — build it in `onMount()`

### Creating UI Components

1. Extend `Component` or existing UI classes
2. Implement the `render()` method
3. Handle input events through `InputSystem`
4. Add to appropriate screens

### Implementing Game Mechanics

1. Create classes in `src/renderer/game/mechanics/`
2. Follow existing patterns (Card, Deck, Battle)
3. Write unit tests
4. Record major design choices in `/docs/AI_TECHNICAL_DECISIONS/`

### Shader Development

- We perfer a single super shader approach to multiple small shaders

## Important Notes for Claude

1. **IMPORTANT: Work tracking lives on Specboard only** (project https://specboard.io/projects/6b4e4cdd-15bc-4001-8280-706838168f2e)
   - Use the Specboard MCP tools (get_items / create_item / update_item) to pick up, create, and close work, and keep item status accurate in real time
   - Record what you did, decided, or are waiting on as a `note` on the item, not in a file
   - Do not keep task lists, status sections, progress logs, or changelogs anywhere in the repo, and don't put checkboxes or "done in DDB-x" annotations in specs
   - `/docs/AI_DEVELOPMENT_LOG.md` and `/docs/AI_DEVELOPMENT_HUB.md` are deprecated and frozen; read them for history if useful, never edit them
2. **Technical decisions** go in `/docs/AI_TECHNICAL_DECISIONS/`, one file per major architectural choice:
   - Descriptive filename (e.g., `scrollable-panel-architecture.md`)
   - Context and problem statement
   - Options considered
   - Decision made and rationale
   - Trade-offs and consequences

3. **Provisional gameplay calls** (a design question decided for now so the build isn't blocked) go in `/docs/gameplay-calls.md`, numbered, one a line as "the item that made it: the call, because why", and in the decision record's provisional calls. Never in a spec, and never on Specboard. Kevin approves or changes them in that file.

4. **Specs** in `/docs/specs/` describe what to build and why. Keep them current when the design changes, but don't annotate them with what has been built.

5. **Follow existing patterns** in the codebase rather than introducing new paradigms

6. **Test your changes** - ensure the game still builds and runs

7. **Consider both platforms** - web is where playtesting happens, and Electron (mac and windows) has to keep building and booting; main's CI packages and smokes it nightly

8. **Performance first** - this is a game that needs smooth performance

9. **Keep the vision** - refer to the game design documents for guidance

## Quick Start Commands

```bash
# Development
npm start              # Start web dev server
npm run start:electron # Start Electron version

# Testing
npx jest <path>       # Run the tests for what you're working on
npm run test:changed  # Run the tests that import anything changed since main
npm test              # Run every test but the slow map-generation ones
npm run test:slow     # Run the slow map-generation tests
npm run test:smoke    # Build and boot the game, then open every screen in a browser
npm run test:watch    # Run tests in watch mode

# Linting and types
npm run lint          # Check for linting errors
npm run typecheck     # Typecheck the game and the tests

# Building
npm run build:web     # Build for web
npm run build:electron # Build for Electron

# Deployment
# Web builds deploy automatically via GitHub Actions:
# - main branch: bearcavinteractive.com/playtest/dual-deckbuilder/
# - PR branches with "playtest" label: bearcavinteractive.com/playtest/dual-deckbuilder/BRANCH_NAME/
# Requires SFTP secrets: SFTP_SERVER, SFTP_USERNAME, SFTP_PASSWORD
```

## Creating Pull Requests

**IMPORTANT**: the merge bar is local, and nothing waits on CI.

1. Before merging a block of work, run `npm run lint`, `npm run typecheck`, and `npm test` locally (plus `npm run test:slow` or `npm run test:smoke` when the work touches what they cover), and fix what fails.
2. Push at the end of a block of work, not after every commit.
3. Don't wait for CI, and don't poll it. The PR workflow (`pr.yml`: lint, typecheck, tests for what changed) is advisory; merge once the local checks pass. Main runs everything after merge and opens a `main-broken` issue if something fails.
4. Use a descriptive branch name (`feat/ai-system`, `fix/battle-logic`, or `<type>/DDB-123-title` for a Specboard item), commit with clear messages, and describe the change, how it was tested, and anything it breaks in the PR.

## References

- Docs index: `/docs/README.md` (project overview and links to every design spec)
- Work tracking: Specboard (link above)

## Memories and Best Practices

- Always use descriptive variable names
- Do not try and preserve legacy/deprecated code or documention that is no longer correct. Prefer deletion and removal to keep the codebase clean.
- When creating new classes, we perfer to use named params like `new Foo({a: 'a', b: 'b'})` over direct function style arguments like `new Foo('a', 'b')`
- Use perfer to use ES6 style getters and setters for accessing and setting properties on a class over functions like getFoo and setFoo should be like `get foo()`
- this project uses tabs for indentation, not spaces
- when searching for strings make sure to be flexable in your searches for tabs and spaces

Remember: This is a game about synergy, both in its mechanics and in how we develop it. Keep the code clean, the documentation updated, and the vision clear!
