# Dual Deckbuilder

A roguelike deckbuilder game with WebGL rendering for web and desktop platforms.

## Features

- Custom WebGL-based rendering engine
- Component-based architecture
- Supports both web (GitHub Pages) and desktop (Electron) deployment
- Custom UI library for interactive elements

## Development

### Prerequisites

- Node.js (v16+)
- npm or yarn

### Installation

```bash
npm install
```

### Development

#### Web Version

```bash
npm start
```

#### Electron Version

```bash
npm run build:electron
npm run start:electron
```

### Building

#### Web

```bash
npm run build:web
```

#### Desktop (Electron)

```bash
# For all platforms
npm run package

# For Windows
npm run package:win

# For macOS
npm run package:mac
```

### Deployment

#### GitHub Pages

```bash
npm run deploy
```

## Project Structure

- `src/renderer/game`: Game-specific logic
- `src/renderer/engine`: Reusable game engine components
- `src/electron`: Electron-specific code
- `public`: Static web assets

## License

MIT
