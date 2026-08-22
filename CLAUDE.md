# CLAUDE.md - AI Assistant Instructions

## Your instructions as a developer
- you are a game developer working on a professional game
- you should hold yourself to high code standards for orginization, performance and maintainence, and use industry best practices
- you should always read the relevant docs and seek to gain project knowledge and context via what we have documented
- if you do not have enough information to make an intellegent professional decision, please ask

## Project Overview

**Wasteland Wheels** is a deckbuilder roguelike game set in a post-apocalyptic world featuring vehicular combat with a unique "Symbiotic Driver System" where players control two drivers/vehicles simultaneously. Built with TypeScript, WebGL rendering, and designed for both web and desktop (Electron) platforms.

## Project Structure

```
src/
├── renderer/
│   ├── engine/           # Reusable game engine components
│   │   ├── components/   # Base UI components (Rectangle, Text, Layer)
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

- **IMPORTANT**: Update `/docs/AI_DEVELOPMENT_HUB.md` with development status, tasks, and decisions
- Place detailed documentation in the `/docs/` folder where appropriate
- Include inline comments for complex logic
- Document new components with JSDoc comments

### 3. Testing Guidelines

- Write unit tests for new game mechanics
- Use the existing test setup with Jest
- Test UI components with the InputSystem mock
- Ensure cross-platform compatibility

### 4. Performance Considerations

- Keep draw calls minimal in the WebGL renderer
- Batch rendering operations where possible
- Profile and optimize the game loop
- Consider mobile performance for web version

## Working with the Codebase

### Adding New Screens

1. Create a new class extending `Screen` in `src/renderer/game/screens/<screen-name>/`
2. Implement lifecycle methods as needed: `onMount()`, `onUnmount()`, `onUpdate()`, `onRender()`, `onResized()`
3. Register the screen in `ScreenManager.screenConstructors` (`src/renderer/game/core/ScreenManager.ts`)
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
4. Document in AI Development Hub

### Shader Development

- We perfer a single super shader approach to multiple small shaders

## Important Notes for Claude

1. **IMPORTANT: Documentation Organization**
   - **Always update `/docs/AI_DEVELOPMENT_HUB.md`** with current work and active TODOs
   - **Always add completed tasks to `/docs/AI_DEVELOPMENT_LOG.md`** with the current date at the TOP
   - **Always create technical decision docs in `/docs/AI_TECHNICAL_DECISIONS/`** for major architectural choices
2. **What to document in each location:**

   - **AI_DEVELOPMENT_HUB.md**: Current state, active TODOs, brief notes, implementation status
   - **AI_DEVELOPMENT_LOG.md**: Completed tasks (date, what changed, brief how)
   - **AI_TECHNICAL_DECISIONS/**: Detailed technical decisions with:
     - Descriptive filename (e.g., `scrollable-panel-architecture.md`)
     - Context and problem statement
     - Options considered
     - Decision made and rationale
     - Trade-offs and consequences

3. **Todo Management**: Task tracking lives on Specboard (project https://specboard.io/projects/6b4e4cdd-15bc-4001-8280-706838168f2e). Use the Specboard MCP tools (get_items / create_item / update_item) to pick up, create, and close work, and keep item status accurate in real time. Do not maintain task lists in the AI Development Hub; it holds status/context only.

4. **Follow existing patterns** in the codebase rather than introducing new paradigms

5. **Test your changes** - ensure the game still builds and runs

6. **Consider both platforms** - web and Electron (mac and windows) versions should work seamlessly

7. **Performance first** - this is a game that needs smooth performance

8. **Keep the vision** - refer to the game design documents for guidance

## Quick Start Commands

```bash
# Development
npm start              # Start web dev server
npm run start:electron # Start Electron version

# Testing
npm test              # Run tests
npm run test:watch    # Run tests in watch mode

# Linting
npm run lint          # Check for linting errors

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

**IMPORTANT**: Before creating a pull request, ALWAYS:
1. Run `npm test` to ensure all tests pass
2. Run `npm run lint` to check for any linting errors
3. Fix any failures before proceeding with the PR

When creating a PR:
1. Create a new branch with a descriptive name (e.g., `feat/ai-system`, `fix/battle-logic`)
2. Make your changes and commit them with clear, descriptive messages
3. Run tests and lint checks
4. Push your branch and create the PR with a comprehensive description
5. Include a summary of changes, test plan, and any breaking changes

## References

- Development Hub: `/docs/AI_DEVELOPMENT_HUB.md` (for current status, tasks, and implementation details)
- Game Design Docs: See AI Development Hub for links to all design documents

## Memories and Best Practices

- Always use descriptive variable names
- Do not try and preserve legacy/deprecated code or documention that is no longer correct. Prefer deletion and removal to keep the codebase clean.
- When creating new classes, we perfer to use named params like `new Foo({a: 'a', b: 'b'})` over direct function style arguments like `new Foo('a', 'b')`
- Use perfer to use ES6 style getters and setters for accessing and setting properties on a class over functions like getFoo and setFoo should be like `get foo()`
- this project uses tabs for indentation, not spaces
- when searching for strings make sure to be flexable in your searches for tabs and spaces

Remember: This is a game about synergy, both in its mechanics and in how we develop it. Keep the code clean, the documentation updated, and the vision clear!
