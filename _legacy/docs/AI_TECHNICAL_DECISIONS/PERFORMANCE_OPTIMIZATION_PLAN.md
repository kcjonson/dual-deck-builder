# Performance Optimization Plan

## Context and Problem Statement

The current WebGL rendering implementation has severe performance issues, with the most critical being:

- **Character-by-character text rendering**: Each character is a separate draw call
- **No performance visibility**: No way to measure or monitor rendering metrics
- A simple UI screen with text can generate 200+ draw calls just for text rendering

## Implementation Plan

### Phase 1: Text Batching System

**Problem**: Text rendering currently makes one draw call per character. A card with name, description, and stats can require 50+ draw calls just for text.

**Solution**: Implement a text batching system that renders all text in a single draw call.

```typescript
// New TextBatchRenderer that accumulates all text geometry
class TextBatchRenderer {
  private vertexBuffer: Float32Array;
  private vertexCount: number;
  private maxVertices: number;
  
  // Add text to the batch instead of immediate rendering
  public addText(text: string, x: number, y: number, font: FontAtlas, color: Color): void;
  
  // Execute all text rendering in one draw call
  public flush(): void;
}
```

**Implementation Details**:
- Pre-allocate a large vertex buffer for text geometry (e.g., 10,000 characters worth)
- Each Text component adds its geometry to the batch instead of rendering immediately
- At the end of the frame, render all text with a single `gl.drawArrays()` call
- Since all text uses the same font atlas texture, no texture switching needed

**Expected Impact**: 
- 200 characters of text: 200 draw calls → 1 draw call
- 80-90% reduction in total draw calls for text-heavy screens

### Phase 2: Performance Monitor

**Problem**: No visibility into rendering performance makes optimization difficult.

**Solution**: Build a comprehensive performance monitoring system.

```typescript
class PerformanceMonitor {
  // Core metrics
  public drawCalls: number;
  public textCharactersRendered: number;
  public verticesDrawn: number;
  public frameTime: number;
  
  // Frame timing
  private frameTimes: number[] = [];
  private lastFrameStart: number;
  
  // Methods
  public beginFrame(): void;
  public endFrame(): void;
  public recordDrawCall(vertexCount: number): void;
  public recordTextBatch(characterCount: number): void;
  
  // Get averaged stats over last N frames
  public getStats(): {
    fps: number;
    avgFrameTime: number;
    drawCallsPerFrame: number;
    textBatchEfficiency: number; // characters per draw call
  };
}
```

**Integration Points**:
- Hook into Renderer to count draw calls
- Track text batching efficiency
- Display real-time stats in Developer Screen
- Optional overlay for performance debugging

**Display Format**:
```
FPS: 60 | Draw Calls: 12 | Text Batch: 247 chars/1 call | Frame: 16.2ms
```

## Migration Strategy

1. **Add Performance Monitor First**: Get baseline metrics before optimization
2. **Implement Text Batching**: Build alongside existing text rendering
3. **Gradual Migration**: Update Text components to use batching one screen at a time
4. **Verify Impact**: Use performance monitor to confirm improvements

## Success Metrics

- Text rendering draw calls reduced by 95%+ 
- Real-time performance visibility
- Zero regressions in text rendering quality
- Measurable FPS improvement on text-heavy screens

This focused plan addresses the most critical performance issue (text rendering) while providing the tools needed to measure and verify the optimization's impact.