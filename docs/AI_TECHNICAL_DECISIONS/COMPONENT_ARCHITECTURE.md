# Component Architecture

## Decision
Implement a three-tier component hierarchy: Layer (base) → Component (interactive) → Panel (container)

## Date
Early development phase

## Context
Need for a flexible UI system that supports:
- Both interactive and non-interactive elements
- Container/child relationships
- Clean separation of concerns
- WebGL-based rendering

## Rationale
- Separation of positioning (Layer) from interaction (Component)
- Panel as specialized container avoids Component overhead
- Clean inheritance hierarchy
- Follows game engine patterns

## Architecture

### Layer (Base Class)
**Purpose**: Base class for all visual elements with positioning and hierarchy

**Responsibilities**:
- Basic positioning in local coordinates (x, y, width, height)
- Child management (addChild, removeChild, getChildren)
- Layout calculation and propagation
- Coordinate-aware rendering with transform context

### Component (Interactive Layer)
**Purpose**: Extends Layer to add interactive behavior

**Responsibilities**:
- Implements Interactive interface (onMouseDown, onWheel, etc.)
- Base for all interactive UI elements
- Inherits all Layer positioning and rendering

**Examples**: Rectangle, Text, Circle, Triangle, Button, Input

### Panel (Non-Interactive Container)
**Purpose**: Container for grouping components with background and scrolling

**Responsibilities**:
- Content layer management (UI vs user content separation)
- Background rendering (automatically managed)
- Scrolling support with content bounds
- Coordinate transformation for scrolled content

**Architecture**:
```
Panel
├── Background Rectangle (UI element - always visible)
├── Content Layer (holds user-added children)
│   ├── Child 1 (user content)
│   ├── Child 2 (user content)
│   └── Child N (user content)
└── Future: Scrollbars, resize handles (UI elements)
```

## Benefits
- Clear separation of concerns
- Avoids unnecessary overhead for containers
- Flexible composition patterns
- Easy to extend with new component types

## Trade-offs
- More classes to understand
- Panel can't directly receive input events
- Need to be careful about which class to extend

## Usage Examples
```typescript
// Interactive element
const button = new Button('Click Me');  // Extends Component

// Non-interactive container
const panel = new Panel({ scrollable: true });  // Just positioning/rendering

// Mix and match
panel.addChild(button);  // Panel contains interactive button
```

## Status
Implemented and in use throughout the codebase