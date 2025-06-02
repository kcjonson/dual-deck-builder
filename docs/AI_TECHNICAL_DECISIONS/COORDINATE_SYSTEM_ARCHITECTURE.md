# Coordinate System & Transform-Based Rendering Architecture

## Decision
Implement a local coordinate system with transform-based rendering for UI components

## Date
Implemented during coordinate system refactoring

## Context
Need for a flexible UI system that supports:
- Nested containers and scrollable panels
- Clean component architecture without parent references
- Performance-optimized rendering
- Future extensibility for effects and transformations

## Rationale
- Game engine patterns are well-established and proven
- Transform stacks enable clean separation of concerns
- Local coordinates simplify component development
- No circular dependencies between parents and children

## Architecture

### Core Principles

1. **Local Coordinate Spaces**
   - Each container defines its own coordinate system starting at (0,0)
   - Children position themselves using local coordinates
   - No child needs to know about its parent

2. **Transform Context During Rendering**
   - Coordinate transformation happens during render phase
   - Each parent passes accumulated transforms via `RenderContext`
   - Children render at local position + accumulated transforms

3. **Separation of Layout and Rendering**
   - Layout: Calculates logical positions in local coordinates
   - Render: Applies coordinate transformations and draws

### Implementation

```typescript
// RenderContext Interface
interface RenderContext {
  offsetX: number; // Accumulated X offset from all parents
  offsetY: number; // Accumulated Y offset from all parents
  // Future: scale, rotation, clipping bounds
}

// Transform Propagation Example
// Root level - no context
rootLayer.render(); // context = { offsetX: 0, offsetY: 0 }

// Panel level - adds its position
panel.render(context); // context = { offsetX: 200, offsetY: 300 }

// Child level - uses accumulated transform
child.render(context); // Renders at (localX + 200, localY + 300)
```

### Scrolling Implementation
```typescript
panel.render(context = { offsetX: 0, offsetY: 0 }) {
  // Calculate screen position
  const screenX = context.offsetX + this.x;
  const screenY = context.offsetY + this.y;

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

## Benefits
- Clean architecture with no circular dependencies
- Simple API for component developers
- Performance-friendly transform calculations
- Follows established game engine patterns
- Easy to extend with new transform effects

## Trade-offs
- More complex than direct screen positioning
- Requires understanding of transform stacks
- Debug tools needed for complex hierarchies

## Future Extensions
- Clipping bounds for overflow handling
- Scale and rotation transforms
- Opacity/alpha blending
- Custom shader effects per container

## Status
Implemented and working for basic transforms and scrolling