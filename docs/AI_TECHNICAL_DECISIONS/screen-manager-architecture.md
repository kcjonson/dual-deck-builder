# Screen Manager Architecture

## Date: July 3, 2025

## Context and Problem Statement

The current screen management system has several issues:

1. **All screens are created at startup** in `Game.createScreens()`, consuming memory for screens that may never be visited
2. **Screens create interactive components in constructors** (e.g., CardShowcaseScreen creates Card components immediately)
3. **These components register global input handlers** that remain active even when their screen is inactive
4. **This causes input conflicts** where clicks are intercepted by invisible screens, leading to unexpected navigation

Additionally, the Game class has too many responsibilities, handling screen management alongside game initialization, rendering, and developer tools.

## Decision

Implement a dedicated `ScreenManager` class that handles screen lifecycle and navigation, with lazy screen creation and proper unmount.

## Detailed Design

### 1. ScreenManager Class

```typescript
// src/renderer/game/core/ScreenManager.ts

export type ScreenName = 
    | 'splashScreen'
    | 'mainMenuScreen'
    | 'developerScreen'
    | 'cardShowcaseScreen'
    | 'driverSelectionScreen'
    | 'combatScreen'
    | 'battleResultScreen';

export class ScreenManager {
    private renderer: Renderer;
    private currentScreenName: ScreenName | null = null;
    private currentScreen: Screen | null = null;
    
    constructor(renderer: Renderer) {
        this.renderer = renderer;
    }
    
    /**
     * Navigate to a screen by name, creating it if needed
     */
    navigate(screenName: ScreenName, data?: unknown): void {
        // Destroy current screen completely
        if (this.currentScreen) {
            this.currentScreen.unmount();
            this.currentScreen = null;
            this.currentScreenName = null;
        }
        
        // Create new screen
        const screen = this.createScreen(screenName);
        if (!screen) {
            console.error(`Unknown screen: ${screenName}`);
            return;
        }
        
        // Mount new screen
        screen.mount(data);
        this.currentScreen = screen;
        this.currentScreenName = screenName;
    }
    
    /**
     * Create a screen instance
     */
    private createScreen(screenName: ScreenName): Screen | null {
        switch (screenName) {
            case 'splashScreen':
                return new SplashScreen(this.renderer);
                
            case 'mainMenuScreen':
                return new MainMenuScreen(this.renderer);
                
            // ... other screens
        }
    }
    
    update(dt: number): void {
        this.currentScreen?.update(dt);
    }
    
    render(): void {
        this.currentScreen?.render();
    }
    
    resize(width: number, height: number): void {
        this.currentScreen?.resize(width, height);
    }
}
```

### 2. Screen Base Class Updates

Add a reference to ScreenManager for navigation:

```typescript
export abstract class Screen {
    protected screenManager: ScreenManager | null = null;
    
    setScreenManager(manager: ScreenManager): void {
        this.screenManager = manager;
    }
    
    protected navigate(screenName: ScreenName, data?: unknown): void {
        this.screenManager?.navigate(screenName, data);
    }
}
```

### 3. Screen Navigation Pattern

Instead of callbacks, screens directly call navigate:

```typescript
// Before (in Game.ts):
mainMenuScreen.setOnStartGame(() => {
    this.showScreen('driverSelectionScreen');
});

// After (in MainMenuScreen.ts):
private onStartGameClick(): void {
    this.navigate('driverSelectionScreen');
}
```

### 4. Game Class Simplification

Game class focuses on high-level concerns:

```typescript
export class Game {
    private screenManager: ScreenManager;
    
    constructor(renderer: Renderer) {
        this.screenManager = new ScreenManager(renderer);
    }
    
    async initialize(): Promise<void> {
        // Initialize game systems
        await AssetManager.initialize();
        
        // Start with splash screen
        this.screenManager.navigate('splashScreen');
    }
}
```

## Implementation Steps

### Phase 1: Create ScreenManager Infrastructure
1. Create `ScreenManager` class in `src/renderer/game/core/`
2. Add `ScreenName` type with all screen identifiers
3. Implement `navigate()`, `createScreen()`, and lifecycle methods
4. Add `screenManager` reference to Screen base class

### Phase 2: Update Screen Base Class
1. Add `setScreenManager()` method to Screen
2. Add protected `navigate()` helper method
3. Ensure all screens properly unmount in `unmount()`
4. Document that screens should not create UI in constructors

### Phase 3: Refactor Individual Screens
1. Move UI creation from constructors to `onMount()` for each screen:
   - CardShowcaseScreen: Move `loadCards()` to `onMount()`
   - DeveloperScreen: Move component creation to `onMount()`
   - Any other screens creating components in constructors
2. Replace callback-based navigation with direct `navigate()` calls
3. Remove all `setOnX()` callback methods

### Phase 4: Update Game Class
1. Remove screen creation and storage from Game
2. Remove `showScreen()` method
3. Create and use ScreenManager instance
4. Update initialization to use ScreenManager
5. Delegate update/render to ScreenManager

### Phase 5: Testing and Validation
1. Test all screen transitions
2. Verify no input handling issues
3. Check memory usage (screens should be garbage collected)
4. Ensure all screens properly unmount

## Consequences

### Positive
- **Solves input handling bug**: Screens only exist when active
- **Reduces memory usage**: Only active screen is in memory
- **Better separation of concerns**: Game class is simpler
- **Cleaner navigation**: No callback spaghetti
- **Easier to extend**: Adding new screens is straightforward

### Negative
- **Slightly slower transitions**: Screens created on demand (negligible)
- **No screen state persistence**: Screens start fresh each time
- **More refactoring required**: All screens need updates

### Neutral
- **Different navigation pattern**: More like web apps than traditional games
- **No screen stack/history**: Could add if needed later

## Alternatives Considered

1. **Keep eager creation, fix unmount**: Less refactoring but doesn't address memory usage
2. **Screen-aware InputSystem**: Complex and doesn't fix architectural issues
3. **Move UI creation to onMount only**: Simpler but keeps architectural problems

## References

- Current implementation: `/src/renderer/game/Game.ts`
- Screen base class: `/src/renderer/game/core/Screen.ts`
- Example problematic screen: `/src/renderer/game/screens/card-showcase/CardShowcaseScreen.ts`