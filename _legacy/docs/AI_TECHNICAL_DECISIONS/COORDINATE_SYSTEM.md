# Coordinate System & Rendering Architecture

## Overview

This document describes the local coordinate system and transform-based rendering architecture used in the Wasteland Wheels UI system. This approach enables nested containers and scrollable panels without requiring parent references or complex layout engines.

## Core Principles

### 1. Local Coordinate Spaces

- Each container (Panel, Layer) defines its own coordinate system starting at (0,0)
- Children position themselves using local coordinates relative to their immediate parent
- No child ever needs to know about its parent - maintains clean separation

### 2. Transform Context During Rendering

- Coordinate transformation happens during the render phase, not layout
- Each parent passes down accumulated transforms through a `RenderContext`
- Children render at their local position + accumulated parent transforms

### 3. Separation of Layout and Rendering

- **Layout**: Calculates logical positions and sizes in local coordinates
- **Render**: Applies coordinate transformations and draws to screen

## Architecture Components

### Layer (Base Class)

**Purpose**: Base class for all visual elements with positioning and hierarchy management

**Responsibilities**:

- Basic positioning in local coordinates (x, y, width, height)
- Child management (addChild, removeChild, getChildren)
- Layout calculation and propagation
- Coordinate-aware rendering with transform context

**Position System**: Uses local coordinates relative to parent container

### Component (Interactive Layer)

**Purpose**: Extends Layer to add interactive behavior (mouse, keyboard, touch events)

**Responsibilities**:

- Implements Interactive interface (onMouseDown, onWheel, etc.)
- All interactive UI elements extend this
- Inherits all Layer positioning and rendering behavior

**Examples**: Rectangle, Text, Circle, Triangle, Button, Input

### Panel (Non-Interactive Container)

**Purpose**: Container that groups other components with background and optional scrolling

**Responsibilities**:

- Content layer management (separates UI elements from user content)
- Background rendering (automatically managed)
- Scrolling support with content bounds calculation
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

## Coordinate System Details

### Local Coordinates

Children always position themselves relative to their parent's origin:

```typescript
// Child positioned 50px right, 100px down from parent's top-left
child.setPosition(50, 100);

// Parent's actual screen position doesn't matter to child
panel.setPosition(200, 300); // Panel at screen (200, 300)
// Child renders at screen position (250, 400) automatically
```

### RenderContext Interface

```typescript
interface RenderContext {
	offsetX: number; // Accumulated X offset from all parents
	offsetY: number; // Accumulated Y offset from all parents
	// Future: scale, rotation, clipping bounds
}
```

### Transform Propagation

Each level in the hierarchy adds its transform to the context:

```typescript
// Root level - no context
rootLayer.render(); // context = { offsetX: 0, offsetY: 0 }

// Panel level - adds its position
panel.render(context); // context = { offsetX: 200, offsetY: 300 }

// Child level - uses accumulated transform
child.render(context); // Renders at (localX + 200, localY + 300)
```

## Layout vs Render Separation

### Layout Phase

**Purpose**: Calculate logical positioning and sizing in local coordinates

**Responsibilities**:

- Determine where children should be positioned relative to parent
- Calculate container content bounds
- Update scroll regions and content dimensions
- Propagate layout calls to children

**Example**:

```typescript
panel.layout() {
  let y = 20; // Start 20px from top

  this.children.forEach(child => {
    child.setPosition(10, y);  // Local coordinates
    child.layout();            // Layout child recursively
    y += child.getHeight() + spacing;
  });

  this.contentHeight = y; // Total content size for scrolling
}
```

### Render Phase

**Purpose**: Apply coordinate transformations and draw to screen

**Responsibilities**:

- Apply coordinate transformation from parent context
- Handle scrolling offsets
- Pass transformed context to children
- Perform actual drawing operations

**Example**:

```typescript
panel.render(context = { offsetX: 0, offsetY: 0 }) {
  // Calculate this panel's screen position
  const screenX = context.offsetX + this.x;
  const screenY = context.offsetY + this.y;

  // Draw panel background at screen position
  renderer.drawRectangle(screenX, screenY, this.width, this.height);

  // Create context for children (including scroll offset)
  const childContext = {
    offsetX: screenX - this.scrollOffsetX,
    offsetY: screenY - this.scrollOffsetY
  };

  // Render children with transformed context
  this.children.forEach(child => {
    child.render(childContext);
  });
}
```

## Scrolling Implementation

### How Scrolling Works

1. **Content Bounds**: Panel calculates total content size during layout
2. **Scroll Offset**: Panel maintains scrollOffsetX/Y for current scroll position
3. **Transform Adjustment**: During render, scroll offset is subtracted from child context
4. **Input Handling**: Mouse wheel events update scroll offset and trigger re-render

### Content Layer Architecture

Panel uses a content layer to separate UI elements from user content:

```typescript
// User adds children to panel
panel.addChild(userComponent); // Goes to content layer

// Internally, panel structure:
Panel
├── background (UI element, never scrolls)
├── contentLayer
│   └── userComponent (scrolls with content)
└── scrollbar (future UI element, never scrolls)
```

This ensures scrollbars and backgrounds stay fixed while content scrolls.

## Implementation Examples

### Basic Container Usage

```typescript
const container = new Panel({
	width: 400,
	height: 300,
	style: { backgroundColor: '#333333' },
});

// Child uses local coordinates - positioned 50px from container's left edge
const child = new Rectangle({
	width: 100,
	height: 50,
	style: { backgroundColor: '#ff0000' },
});
child.setPosition(50, 20); // Local coordinates

container.addChild(child);
```

### Scrollable Container

```typescript
const scrollablePanel = new Panel({
	width: 300,
	height: 200,
	scrollable: true,
	scrollDirection: 'vertical',
	style: { backgroundColor: '#222222' },
});

// Add many children - panel will automatically become scrollable
for (let i = 0; i < 20; i++) {
	const item = new Text(`Item ${i}`, { style: { fontSize: 16 } });
	item.setPosition(10, i * 30); // Local coordinates
	scrollablePanel.addChild(item);
}
```

### Nested Containers

```typescript
const outerPanel = new Panel({ width: 500, height: 400 });
const innerPanel = new Panel({ width: 200, height: 150 });

// Inner panel positioned in outer panel's local coordinates
innerPanel.setPosition(50, 50);

// Component positioned in inner panel's local coordinates
const component = new Rectangle({ width: 100, height: 50 });
component.setPosition(25, 25); // 25px from inner panel's origin

innerPanel.addChild(component);
outerPanel.addChild(innerPanel);

// Final screen position: (50 + 25, 50 + 25) + outer panel's screen position
```

## Benefits of This Approach

### Clean Architecture

- No circular dependencies (children don't reference parents)
- Clear separation of concerns (layout vs rendering)
- Simple API (children just set local positions)

### Flexible and Extensible

- Easy to add new container types
- Scrolling works automatically for any container
- Future features (clipping, effects) integrate naturally

### Performance Friendly

- Coordinate transforms are lightweight
- Layout recalculation only when needed
- Rendering can be optimized with culling/clipping

### Game Engine Patterns

- Follows established patterns from graphics/game engines
- Transform stacks are well-understood and debuggable
- Scales well for complex UI hierarchies

## Future Enhancements

### Clipping Bounds

Add the option to specify an overflow property

### Transform Effects

Extend RenderContext for advanced visual effects:

```typescript
interface RenderContext {
	offsetX: number;
	offsetY: number;
	scaleX?: number; // Scaling
	scaleY?: number;
	rotation?: number; // Rotation in radians
	opacity?: number; // Alpha blending
}
```
