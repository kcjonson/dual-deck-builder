# CLAUDE.md - AI Assistant Instructions

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

1. Create a new class extending `Screen` in `src/renderer/game/screens/`
2. Implement required methods: `onActivate()`, `onDeactivate()`, `onUpdate()`, `onRender()`
3. Register the screen in `Game.ts`
4. Add navigation logic

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

- Vertex shaders in `src/assets/shaders/vertex.glsl`
- Fragment shaders in `src/assets/shaders/fragment.glsl`
- Use the `Shader` class for compilation and usage

## Important Notes for Claude

1. **Always update `/docs/AI_DEVELOPMENT_HUB.md`** with:

   - Changes made
   - Design decisions
   - Implementation notes
   - Future considerations
   - Current TODOS

2. **Todo Management**: When asked to update todos or create new task lists, always write them to the AI Development Hub document, not just the internal todo system

3. **Follow existing patterns** in the codebase rather than introducing new paradigms

4. **Test your changes** - ensure the game still builds and runs

5. **Consider both platforms** - web and Electron (mac and windows) versions should work seamlessly

6. **Performance first** - this is a game that needs smooth performance

7. **Keep the vision** - refer to the game design documents for guidance

## Quick Start Commands

```bash
# Development
npm start              # Start web dev server
npm run start:electron # Start Electron version

# Testing
npm test              # Run tests
npm run test:watch    # Run tests in watch mode

# Building
npm run build:web     # Build for web
npm run build:electron # Build for Electron

# Deployment
npm run deploy        # Deploy to GitHub Pages
```

## References

- Development Hub: `/docs/AI_DEVELOPMENT_HUB.md` (for current status, tasks, and implementation details)
- Game Design Docs: See AI Development Hub for links to all design documents

## Memories and Best Practices

- Always use descriptive variable names
- Do not try and preserve legacy/deprecated code or documention that is no longer correct. Prefer deletion and removal to keep the codebase clean.

Remember: This is a game about synergy, both in its mechanics and in how we develop it. Keep the code clean, the documentation updated, and the vision clear!