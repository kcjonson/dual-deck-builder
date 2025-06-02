# UI Component API Design (CSS-in-JS Style)

## Decision
Adopt a React/CSS-in-JS inspired API for UI components

## Date
Early in development (based on refactoring commits)

## Context
The developer has 15 years of web development experience with React and CSS, making a familiar API pattern crucial for development efficiency.

## Rationale
- Familiar CSS nomenclature reduces cognitive load
- Style objects separate concerns cleanly
- Optional IDs eliminate unnecessary verbosity when direct references exist
- Leverages existing developer expertise

## Implementation

### New API Design (Implemented)
```typescript
// Text component with CSS-like styling
const text = new Text('Hello World', {
  style: {
    fontSize: 20,      // Number or string with 'px'
    color: '#ffffff',  // Hex colors only
    textAlign: 'center',
    left: 150,         // Always absolute positioning
    top: 25
  }
});

// Rectangle with familiar CSS properties
const rect = new Rectangle({
  style: {
    width: 100,
    height: 100,
    backgroundColor: '#ff3333',
    borderRadius: 8,
    border: '2px solid #ffffff'
  }
});

// Button with integrated styling
const button = new Button('Click Me', {
  style: {
    width: 200,
    height: 50,
    fontSize: 16
  }
});

// Components no longer require IDs
const layer = new Layer();  // No ID needed
const panel = new Panel({   // Style is optional
  style: {
    backgroundColor: '#333333cc'  // Hex with alpha
  }
});
```

## Benefits
- Familiar syntax for web developers
- Single object for all styling concerns
- No IDs required - components are just object references
- CSS property names match web standards (camelCase)
- Hex colors only for consistency
- Always absolute positioning (no layout engine complexity)
- Optional style objects with sensible defaults

## Key Differences from Web CSS
- No relative positioning or layout engine
- Colors must be hex strings (e.g., '#ffffff', '#333333cc')
- No units required for numeric values (assumed pixels)
- Limited CSS properties (only what's implemented)

## Trade-offs
- Limited to absolute positioning only
- No cascading styles or inheritance
- Manual layout required (no flexbox/grid)
- Performance optimized over flexibility

## Status
Implemented and in use throughout the codebase