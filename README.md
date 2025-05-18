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

#### Testing & Linting

```bash
# Run tests
npm test

# Run tests with watch mode
npm run test:watch

# Generate test coverage report
npm run test:coverage

# Run linting
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

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

## CI/CD Pipeline

This project uses GitHub Actions for Continuous Integration and Deployment:

- **CI Workflow**: Runs tests and linting on all PRs and pushes to main/master
- **Web Build**: Builds and verifies the web version of the application
- **Electron Build**: Builds and packages the desktop version for Windows and macOS

Branch protection rules are set up to ensure that PRs can only be merged if:

- All tests pass
- Code passes linting
- Builds succeed for all target platforms

See [.github/BRANCH_PROTECTION.md](.github/BRANCH_PROTECTION.md) for details on the branch protection configuration.

### Deployment

#### GitHub Pages

```bash
npm run deploy
```

## VS Code Integration

This project is configured for optimal development experience in Visual Studio Code, with the following features:

### Run & Debug

- **Run Menu Integration**: Access all project tasks from the Terminal > Run Task... menu
- **Quick Start**:
  - Press `Ctrl+Shift+B` (`Cmd+Shift+B` on macOS) to run the default web server
  - Use Terminal > Run Build Task to build the project

### Debugging

- Open the "Run and Debug" sidebar (`Ctrl+Shift+D`)
- Choose a launch configuration:
  - **Debug Web**: Launch and debug the web version
  - **Debug Electron Main**: Debug the Electron main process
  - **Debug Electron Renderer**: Debug the Electron renderer process
  - **Debug Tests**: Run and debug tests
  - **Debug Electron (Main + Renderer)**: Debug both Electron processes simultaneously

### Output & Monitoring

- The Problems panel (`Ctrl+Shift+M`) shows errors and warnings from ESLint, TypeScript, and webpack
- Console logs are formatted for easy monitoring (for both Copilot monitoring and human developers)
- Use the VS Code Output panel to view application logs
- Terminal integration for direct console output

### Testing

- Run tests with the "Run Tests" task or using the Testing sidebar
- Debug tests with the "Debug Tests" launch configuration
- Check test coverage with `npm run test:coverage`

## Project Structure

- `src/renderer/game`: Game-specific logic
- `src/renderer/engine`: Reusable game engine components
- `src/electron`: Electron-specific code
- `public`: Static web assets

## License

MIT
