# Worldsim draw core: immediate draw API, retained shapes, batching, and render order

Research report for the backend-agnostic 2D UI rendering spec (TypeScript/WebGL2 port).
Source repo: `C:/Users/kevin/Code/worldsim` (read-only). All `file:line` cites below are relative to that root; line numbers are from the working tree as of 2026-09-07 (HEAD includes commit `251a776`).

Scope: the `Renderer::Primitives` immediate-mode API, the `BatchRenderer` uber-shader batcher, the `UI::` component/shape tree that sits on top, clipping, the coordinate system, and above all the render-ordering rules. Text and fonts are covered only where they touch batching and order.

---

## 0. One-paragraph summary of how ordering actually works

There is no depth buffer anywhere in the 2D path (`glDisable(GL_DEPTH_TEST)`, `BatchRenderer.cpp:557`). Everything is a painter's algorithm: the last quad written wins, and alpha blending is straight `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` over whatever is already in the framebuffer (`BatchRenderer.cpp:553-554`). Order is decided by three stacked mechanisms: (1) the scene's hand-written pass order plus explicit `Primitives::flush()` barriers, which partition a frame into independent sort domains; (2) inside the UI component tree, each parent stable-sorts its children by a `short zIndex` and draws itself before its children; (3) inside one flush, every `add*` call on the batcher records a `DrawGroup {indexStart, indexCount, zIndex}` and, only if any group carries a non-zero z, all groups are stable-sorted by z and the index buffer is re-emitted in that order. Ties (including the default z of 0) keep submission order, which is what makes "shadow quad first, then fill" and "parent before child" hold without any special casing. Drop shadows and glows are separate SDF quads emitted immediately before their owner at the same z (`Primitives.cpp:284-293`), so they land beneath the owner and above everything submitted earlier. Overlays (menus, tooltips, toasts) float by carrying a large z into the global batch sort; dialogs float by being rendered last among the UI roots; the world never sorts above the UI because a `flush()` sits between them (`GameScene.cpp:1035-1040`). Clip rects and transforms are baked into every vertex at add time, so re-ordering never disturbs clipping or scrolling.

---

## 1. Layer cake: component tree down to GL

### 1.1 The layers, top to bottom

| Layer | Where | Nature | Emits |
|---|---|---|---|
| Scene / app code | `apps/world-sim/scenes/game/GameScene.cpp:959-1061`, `GameUI.cpp:552-632` | Hand-ordered passes, calls `flush()` barriers | calls into both layers below |
| Retained component tree | `libs/ui/component/Component.h`, `Container.h`, `libs/ui/components/**`, `libs/ui/layout/LayoutContainer.*` | Persistent objects, per-parent z-sort, clip + content-offset containers | calls the immediate API from `render()` |
| Retained leaf shapes | `libs/ui/shapes/Shapes.h/.cpp` (`Rectangle`, `Circle`, `Line`, `Text`) | Persistent leaf objects; `render()` is one immediate call | `drawRect`/`drawCircle`/`drawLine`/`addTextQuad` |
| Immediate draw API | `libs/renderer/primitives/Primitives.h/.cpp` (`Renderer::Primitives::*`) | Free functions with `.Args{}` structs; owns clip/transform stacks and the font renderer pointer | `BatchRenderer::add*` |
| Batcher | `libs/renderer/primitives/BatchRenderer.h/.cpp` | CPU vertex/index accumulation, per-call `DrawGroup`s, z-sort, multi-atlas draw splitting, one VAO/VBO/IBO, one uber shader; also GPU instancing for the world | `glDrawElements` / `glDrawElementsInstanced` |
| GL wrappers | `libs/renderer/gl/*.h`, `libs/renderer/shader/Shader.*`, `ShaderPreprocessor.*` | RAII handles, `#include` preprocessor for GLSL | GL |

The docs describe this as a four-layer stack (components, Primitives API, BatchRenderer, OpenGL), `docs/technical/ui-framework/colonysim-integration-architecture.md:17-74`, and the founding principle is "Immediate Mode API, Retained Mode Implementation" (`docs/technical/ui-framework/primitive-rendering-api.md:18-41`).

### 1.2 Immediate draw API surface (`Renderer::Primitives`)

Verbatim from `libs/renderer/primitives/Primitives.h`:

```cpp
// Initialization / wiring
void init(Renderer* renderer);                       // :44
void shutdown();                                     // :45
void setCoordinateSystem(CoordinateSystem* c);       // :48
void getLogicalViewport(int& w, int& h);             // :58   logical (DPI-independent) size
void setFontRenderer(ui::FontRenderer* f);           // :73   dependency injection (ui lib owns fonts)
ui::FontRenderer* getFontRenderer();                 // :82
void setFontAtlas(unsigned int atlasTexture, float pixelRange = 4.0F); // :93 default atlas
void setTileAtlas(unsigned int, const std::vector<glm::vec4>&);       // :97 (tile pass, not batcher)
BatchRenderer* getBatchRenderer();                   // :109  escape hatch used by Text/TextInput/world
using FrameUpdateCallback = void (*)();
void setFrameUpdateCallback(FrameUpdateCallback);    // :117-118 (font LRU frame counter)

// Frame lifecycle
void beginFrame();                                   // :122
void endFrame();  // Flushes all batches               :123
void flush();     // Draw-order barrier                :129
void setViewport(int width, int height);             // :132  PHYSICAL framebuffer size
void getViewport(int& width, int& height);           // :135

// Projection helpers
Foundation::Mat4 getScreenSpaceProjection();         // :140
Foundation::Mat4 getWorldSpaceProjection();          // :143
float PercentWidth(float); float PercentHeight(float);
Foundation::Vec2 PercentSize(float, float); Foundation::Vec2 PercentPosition(float, float); // :146-149

// Draw calls
struct RectArgs      { Foundation::Rect bounds; Foundation::RectStyle style; const char* id = nullptr; int zIndex = 0; };            // :154-159
struct LineArgs      { Vec2 start; Vec2 end; Foundation::LineStyle style; const char* id = nullptr; int zIndex = 0; };                // :161-168
struct TrianglesArgs { const Vec2* vertices; const uint16_t* indices; size_t vertexCount; size_t indexCount;
                       Foundation::Color color; const Foundation::Color* colors = nullptr; const char* id = nullptr; int zIndex = 0; }; // :171-180
struct CircleArgs    { Vec2 center; float radius; Foundation::CircleStyle style; const char* id = nullptr; int zIndex = 0; };         // :192-198
struct TextArgs      { std::string text; Vec2 position; float scale = 1.0F; Color color = white; FontFamily font = Roboto;
                       Color shadowColor = transparent; Vec2 shadowOffset{0,0};
                       HorizontalAlign hAlign = Left; VerticalAlign vAlign = Top; float boxWidth = 0; float boxHeight = 0;
                       float letterSpacing = 0; TextTransform transform = None; const char* id = nullptr; float zIndex = 0.0F; };    // :216-239
void drawRect(const RectArgs&);        // :183
void drawLine(const LineArgs&);        // :186
void drawTriangles(const TrianglesArgs&); // :189
void drawCircle(const CircleArgs&);    // :213
void drawText(const TextArgs&);        // :252

// Clipping (shader-based, per-vertex; see section 4)
void pushClip(const Foundation::ClipSettings&);      // :272
void popClip();                                      // :275
Foundation::Vec4 getCurrentClipBounds();             // :279  (minX, minY, maxX, maxY), (0,0,0,0) = none
bool IsClipActive();                                 // :282
void pushClipRoundedRect(const Rect&, float r);      // :293  AABB approximation only
void pushClipCircle(const Vec2&, float r);           // :298  AABB approximation only
void pushClipPath(const std::vector<Vec2>&);         // :303  AABB approximation only
// Legacy, no GL effect at all (dead stack):
void PushScissor(const Rect&); void PopScissor(); Rect getCurrentScissor(); // :314-316

// Transform stack (baked into vertices at add time)
void PushTransform(const Mat4&); void PopTransform(); Mat4 getCurrentTransform(); // :319-321

struct RenderStats { uint32_t drawCalls, vertexCount, triangleCount; }; RenderStats getStats(); // :325-331
```

Note the type inconsistency: `zIndex` is `int` on rect/line/triangles/circle but `float` on text (`:238`), and `short` on components (`Component.h:91`); the batcher stores `float` (`BatchRenderer.h:232`). Fractional z (`+0.1F`) is used by text-over-background inside composite widgets (e.g. `Tooltip.cpp:157`, `Toast.cpp:214`, `Select.cpp:349`).

### 1.3 Style structs (`libs/foundation/graphics/PrimitiveStyles.h`, `ClipTypes.h`, `Color.h`, `Rect.h`)

```cpp
enum class BorderPosition { Inside, Center, Outside };                       // PrimitiveStyles.h:14-18
struct BorderStyle   { Color color = white; float width = 1.0F; float cornerRadius = 0.0F; BorderPosition position = Center; }; // :21-26
struct LinearGradient{ Color from; Color to; bool horizontal = false; };     // :31-35  per-corner vertex colors
struct BoxShadow     { Color color = {0,0,0,0.5}; float blur = 8.0F; float spread = 0.0F; Vec2 offset = {0,0}; }; // :40-45 outset only
struct RectStyle     { Color fill = white; optional<BorderStyle> border; optional<LinearGradient> gradient; optional<BoxShadow> boxShadow; }; // :48-53
struct LineStyle     { Color color = white; float width = 1.0F; };            // :56-59
struct CircleStyle   { Color fill = white; optional<BorderStyle> border; };   // :62-65
enum class HorizontalAlign { Left, Center, Right }; enum class VerticalAlign { Top, Middle, Bottom }; // :68-71
enum class TextTransform { None, Uppercase };                                 // :74
struct TextStyle     { Color color = white; float fontSize = 16.0F; HorizontalAlign hAlign; VerticalAlign vAlign; bool wordWrap = false; }; // :77-83

struct ClipRect        { optional<Rect> bounds; };                            // ClipTypes.h:24-26 (fast path)
struct ClipRoundedRect { optional<Rect> bounds; float cornerRadius = 8; };    // :29-32  NOT IMPLEMENTED (AABB)
struct ClipCircle      { Vec2 center; float radius = 50; };                   // :35-38  NOT IMPLEMENTED (AABB)
struct ClipPath        { std::vector<Vec2> vertices; };                       // :41-43  NOT IMPLEMENTED (AABB)
using ClipShape = std::variant<ClipRect, ClipRoundedRect, ClipCircle, ClipPath>; // :46
enum class ClipMode { Inside, Outside };                                      // :52-55  Outside NOT IMPLEMENTED
struct ClipSettings    { ClipShape shape; ClipMode mode = Inside; };          // :61-64

struct Color { float r, g, b, a; ... toVec4() ... };                          // Color.h:11-46  straight (non-premultiplied) floats
struct Rect  { float x, y, width, height; ... intersection(a,b) ... };        // Rect.h:11-67  top-left origin
```

Corner radius lives on `BorderStyle`, not `RectStyle`; a rounded fill with no visible border is done with `width = 0.0F` (e.g. `ScrollContainer.cpp:108-109`, `Button.cpp:190-191`).

### 1.4 Batcher surface (`Renderer::BatchRenderer`)

```cpp
struct UberVertex {               // BatchRenderer.h:39-46, 80 bytes, matches uber.vert locations 0-5
    Vec2 position;   // screen-space (logical px), transform already applied
    Vec2 texCoord;   // UV for text, rectLocalPos (SDF coords from rect center) for shapes
    Vec4 color;      // fill RGBA (straight alpha)
    Vec4 data1;      // shapes: (border.rgb, borderWidth); shadow: (blur,0,0,0); text: 0
    Vec4 data2;      // shapes: (halfW, halfH, cornerRadius, borderPos 0|1|2); text: (pixelRange,0,0,-1); shadow: (halfW,halfH,cr,-3)
    Vec4 clipBounds; // (minX,minY,maxX,maxY) logical px, (0,0,0,0) = no clip
};
constexpr float kRenderModeText = -1.0F;   // :49
constexpr float kRenderModeShadow = -3.0F; // :50   (instanced = -2.0 lives only in the shaders)

void addQuad(const Rect& bounds, const Color& fill, const optional<BorderStyle>& border = nullopt,
             float cornerRadius = 0, const optional<LinearGradient>& gradient = nullopt, float zIndex = 0); // :71-78
void addShadowQuad(const Rect& bounds, const BoxShadow&, float cornerRadius, float zIndex = 0);            // :83
void addTriangles(const Vec2* v, const uint16_t* i, size_t vc, size_t ic, const Color&, const Color* perVertex = nullptr, float zIndex = 0); // :87-95
void addTextQuad(const Vec2& pos, const Vec2& size, const Vec2& uvMin, const Vec2& uvMax, const Color&,
                 const Vec2& runOrigin, GLuint atlasTexture = 0, float zIndex = 0);                          // :113-122
void setFontAtlas(GLuint atlasTexture, float pixelRange = 4.0F);   // :126
void flush(); void beginFrame(); void endFrame();                  // :131-135
void setViewport(int w, int h); void getViewport(int&, int&) const; void setCoordinateSystem(CoordinateSystem*); // :139-145
void setClipBounds(const Vec4&); void clearClipBounds(); const Vec4& getClipBounds() const;                // :151-157
void setTransform(const Mat4&); const Mat4& getTransform() const;                                          // :165-168
GLuint getShaderProgram() const;                                   // :183
InstancedMeshHandle uploadInstancedMesh(const renderer::TessellatedMesh&, uint32_t maxInstances = 10000);  // :192
void releaseInstancedMesh(InstancedMeshHandle&);                   // :196
void drawInstanced(const InstancedMeshHandle&, const InstanceData*, uint32_t count, Vec2 cameraPos, float zoom, float pixelsPerMeter); // :206-213

// private state that matters for the spec
std::vector<UberVertex> vertices; std::vector<uint32_t> indices; std::vector<GLuint> vertexAtlas; // :217-223 (atlas tag per vertex, 0 = shape)
struct DrawGroup { uint32_t indexStart; uint32_t indexCount; float zIndex; };                     // :229-233
std::vector<DrawGroup> drawGroups; bool anyExplicitZ = false;                                     // :234-235
Vec4 currentClipBounds{0,0,0,0};                                                                  // :273
enum class TransformClass : uint8_t { kIdentity, kTranslateOnly, kGeneral };                      // :279
Mat4 currentTransform{1}; TransformClass transformClass; Vec2 transformTranslation;               // :282-284
struct TextSnapCache { float pixelRatio; Vec2 translation; Vec2 runOrigin; Vec2 delta; };         // :289-295
```

### 1.5 The retained layer, and how it is implemented on top of the immediate one

`IComponent` (`Component.h:27-96`) is the render-only interface: `virtual void render() = 0`, `handleEvent`, `containsPoint`, layout getters, plus data members `float margin`, `SizeMode widthMode/heightMode`, `float fillWeight`, `short zIndex{0}` (`:88-91`), `bool visible{true}` (`:95`). `ILayer` adds `update` and `layout` (`:106-112`). `Component` (`:199-382`) owns children in a non-growable `MemoryArena` (`:125-182`), returns generational `LayerHandle`s (`Layer.h:12-40`), and implements:

```cpp
void render() override {                 // Component.h:305-315
    ensureRenderOrder();
    for (auto* child : renderOrder) {
        if (!child->visible) continue;
        RenderContext::setZIndex(child->zIndex);
        child->render();
    }
}
void ensureRenderOrder() {               // :373-381
    if (childrenNeedSorting) {
        renderOrder = children;          // copy: LayerHandle indexes into `children`, never reorder it
        std::stable_sort(renderOrder.begin(), renderOrder.end(), [](a, b){ return a->zIndex < b->zIndex; });
        childrenNeedSorting = false;
    }
}
bool dispatchEvent(InputEvent& event) {  // :338-359  reverse renderOrder, highest z first, stop on consume
```

`RenderContext` (`libs/ui/core/RenderContext.h:10-20`) is a `thread_local short` set by the parent loop and read by the leaf shapes:

```cpp
void Rectangle::render() { Primitives::drawRect({.bounds = ..., .style = style, .id = id, .zIndex = RenderContext::getZIndex()}); } // Shapes.cpp:14-18
void Circle::render()    { Primitives::drawCircle({... .zIndex = RenderContext::getZIndex()}); }  // :20-24
void Line::render()      { Primitives::drawLine({... .zIndex = RenderContext::getZIndex()}); }    // :26-28
void Text::render()      { ... batchRenderer->addTextQuad(pos, size, uvMin, uvMax, textColor, runOrigin); } // :222-229, NO atlas, NO zIndex (both default 0)
```

So the retained layer is a thin object graph whose only job at draw time is to walk the tree in (zIndex, insertion) order and re-issue immediate calls every frame. Nothing is cached between frames on the GPU for UI; the whole batch is rebuilt and re-uploaded per flush.

`Container` (`Container.h:31-110`) adds the two "decoupled primitives" (Flutter/Unity pattern, `docs/technical/ui-framework/clipping.md:70-73`): `setClip(optional<ClipSettings>)`, `setContentOffset(Vec2)`, and:

```cpp
void render() override {                 // Container.h:77-105
    if (hasOffset) Primitives::PushTransform(glm::translate(I, {offset.x, offset.y, 0}));
    if (m_clip) Primitives::pushClip(*m_clip);      // after transform, so the clip stays fixed on screen
    Component::render();
    if (m_clip) Primitives::popClip();
    if (hasOffset) Primitives::PopTransform();
}
bool handleEvent(InputEvent& e) override { e.position -= offset; handled = dispatchEvent(e); e.position = orig; } // :38-55
```

`ScrollContainer` (`ScrollContainer.cpp`) is a `Container` that sets `clip = {contentPos, viewport minus 8px scrollbar}` and `contentOffset = {contentPos.x, contentPos.y - scrollY}` (`:211-230`), renders children via `Container::render()`, then draws the scrollbar track and thumb afterwards with plain `drawRect` and no zIndex so they paint on top by submission order (`:76-111`). `LayoutContainer::render` computes layout if dirty then calls `Container::render()` (`LayoutContainer.cpp:63-69`). `Dialog` clips its children to the content area and offsets them so children live in a (0,0) content space (`Dialog.cpp:407-416`).

Composite widgets (`Button`, `Panel`, `Dialog`, `Menu`, `Toast`, ...) are not built from shape children; their `render()` issues immediate calls directly. Whether they forward a z is per-widget: `Menu`, `ContextMenu`, `Tooltip`, `Toast`, `DropdownButton`, `Select`, `Icon`, `TreeView` pass their own `zIndex` member (and `+1`, `+2`, `+0.1F` offsets for layers inside themselves); `Button` (`Button.cpp:171,184,188,201,217`), `Panel` (`Panel.cpp:99-167`), `Dialog` (`Dialog.cpp:293-375`), and `ScrollContainer`'s scrollbar pass nothing (z 0). `TextInput` reads `RenderContext` for its background/selection/cursor (`TextInput.cpp:544, 621, 666`) but its glyphs go through `addTextQuad` at z 0 (`:586-593`).

---

## 2. Frame lifecycle

### 2.1 Per-frame sequence (engine)

`Application::run` loop (`libs/engine/application/Application.cpp:204-269`): `preFrameCallback` -> `SceneManager::update` -> `glClearColor/glClear(GL_COLOR_BUFFER_BIT)` (`:240-241`, color only, no depth/stencil clear) -> `SceneManager::render()` (`:245`) -> `overlayRenderer()` (`:253-261`) -> `glfwSwapBuffers` (`:267`) -> `postFrameCallback`.

`AppLauncher` wires the primitives into those hooks: `preFrameCallback` calls `Renderer::Primitives::beginFrame()` (`AppLauncher.cpp:392`), `overlayRenderer` is exactly `Renderer::Primitives::endFrame()` (`:461`; the ui-sandbox does the same then serves UI-tree snapshot requests, `apps/ui-sandbox/Main.cpp:99-102`), and `postFrameCallback` copies `Primitives::getStats()` into the metrics (`:464-478`).

`beginFrame` clears the CPU accumulators and stats (`BatchRenderer.cpp:677-686`) and fires the font-cache frame callback (`Primitives.cpp:170-179`). `endFrame` is just `flush()` (`BatchRenderer.cpp:688-690`).

### 2.2 What `flush()` does, in order (`BatchRenderer.cpp:528-675`)

1. Early out if no vertices.
2. Resolve draw order (`:533-550`): if `anyExplicitZ && !drawGroups.empty()`, `std::stable_sort(drawGroups)` by `zIndex` ascending and rebuild a fresh `sortedIndices` by concatenating each group's index range; otherwise emit `indices` as-is. Sorting is by group (one per `add*` call), never by triangle.
3. GL state: `glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); glDisable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE);` (`:553-560`).
4. Upload: `glBufferData(GL_ARRAY_BUFFER, ..., GL_DYNAMIC_DRAW)` and `glBufferData(GL_ELEMENT_ARRAY_BUFFER, ...)` with the full arrays every flush (buffer respecification / orphaning, `:563-568`).
5. Bind uber shader + VAO (`:571-572`).
6. Uniforms every flush (`:577-608`): `u_projection` = `CoordinateSystem::CreateScreenSpaceProjection()` (logical pixels) or `ortho(0,vw,vh,0,-1,1)` fallback; `u_transform` = identity (transforms were baked at add time, so different parts of one batch can carry different transforms); `u_viewportHeight` = logical height * pixelRatio (physical); `u_pixelRatio`; `u_instanced = 0`; `u_atlas = 0`.
7. Multi-atlas draw splitting (`:610-658`): bind `defaultFontAtlas`, walk triangles in emit order, and start a new `glDrawElements(GL_TRIANGLES, count, GL_UNSIGNED_INT, offset)` only when a text triangle's atlas tag differs from the bound one. Shapes are tagged 0 and never force a split.
8. Cleanup (`:661-663`): unbind VAO, unbind texture, `glDisable(GL_BLEND)`.
9. Accumulate stats, clear `vertices/indices/vertexAtlas/drawGroups`, reset `anyExplicitZ` (`:666-674`).

### 2.3 What triggers a flush

Only explicit calls. Nothing state-driven flushes: no texture change, clip change, transform change, blend change or z change ever forces a draw, because all of those are per-vertex data or resolved at flush. The callers are:

- `Primitives::endFrame()` once per frame (the UI's single flush in the common case).
- `Primitives::flush()` as a deliberate draw-order barrier: `GameScene.cpp:984` (after committed construction, before the entity pass), `GameScene.cpp:1040` (world/UI barrier), `DecorativePlanet.cpp:92` and `WorldCreatorScene.cpp:253` (before blitting a 3D FBO so the starfield primitives land beneath the blit).
- `BatchRenderer::flush()` from world renderers before they issue raw GL: `ChunkRenderer.cpp:133-137`, `BakedChunkRenderer.cpp:158-159`, and interleaved at sorted depth positions in `InstancedEntityRenderer.cpp:139,174`.

Within a flush there is one draw call plus one extra per font-atlas switch encountered in emit order. Draw-call counts in the metrics are dominated by the world (per-chunk tile draws, baked chunk draws, instanced runs): 391 -> 392 draw calls per frame in a 90-building test scene, where "the entire committed pass adds ONE draw call" (`docs/development-log/entries/2026-07-03-construction-layering-story-b.md:71-73`). Before `2026-06-09` the metrics counted only batcher flushes and reported 3 draw calls per frame (`2026-06-09-render-performance-analysis.md:36-37`), which is a fair picture of the UI's own cost: a handful of draw calls. A frame's UI submits "dozens to low hundreds" of draw groups (`2026-06-16-ui-salvage-reconcile-onto-main.md:31-32`).

### 2.4 Per-frame state summary

- No UBOs; plain `glUniform*` per flush (`BatchRenderer.cpp:584-608`). Uniform locations cached at init (`:45-56`).
- Vertex attribute layout fixed at init: locations 0..5 for the batch VAO (`:79-104`), 6..7 reserved for instancing (`:826-835`, `instancing.glsl:12-13`).
- The default font atlas texture is bound to unit 0 at the start of each flush; the instanced path sets `u_instanced = 1` and its own uniforms (`:889-903`).
- `u_bakedAlpha` is explicitly initialized to 1.0 at init because uniforms default to 0 (`:58-62`).
- Viewport dimensions (physical) are pushed on init and on every framebuffer resize (`AppLauncher.cpp:104,182`), and again by `BakedChunkRenderer` mid-frame (`:162`).

---

## 3. Render order (the full story)

### 3.1 Is there a z-index? Global or per-parent?

Both, and they are different systems that only partially agree:

- **Per-parent component z** (`IComponent::zIndex`, `short`, `Component.h:88-91`). `Component::render()` stable-sorts the parent's children by it (`:373-381`); ties keep insertion order (CSS-like, deliberately, `2025-11-18-layer-system-api-improvements.md:49-52`). It never crosses a parent boundary. It is also the key for reverse-order event dispatch (`:338-359`) and for the layout lint's "overlapping siblings must differ in zIndex" rule (`libs/ui/debug/LayoutLint.h:19-22`, `LayoutLint.cpp:78-87`).
- **Global-per-flush batch z** (`DrawGroup::zIndex`, `float`). Every `add*` call records one group (`recordGroup`, `BatchRenderer.cpp:120-128`). At flush, if any group's z is non-zero, all groups in that flush are stable-sorted by z (`:540-549`). This is what lets a menu nested deep in a dropdown paint over widgets in other subtrees.

The two connect only through `RenderContext`: the parent loop stores the child's `zIndex` in a thread-local (`Component.h:312`), and the leaf shapes `Rectangle/Circle/Line` copy it into their draw args (`Shapes.cpp:16,22,27`). `Icon` copies its own member into its draw (`Icon.cpp:202,244`). `Text` does not (`Shapes.cpp:222-229`). Composite widgets choose independently (section 1.5).

### 3.2 Is sorting stable? By what key? Tree order or sorted?

Stable at both levels (`std::stable_sort`, `Component.h:376`, `BatchRenderer.cpp:541`). Key is the single scalar z, ascending, larger drawn later (on top). Within equal z, submission order, which for the tree means: parent's own draws, then children in (zIndex, insertion) order, recursively. Roots are not sorted at all; `GameUI::render()` draws them in hand-written order (`GameUI.cpp:552-631`: top bar, debug overlay, zoom panel, gameplay bar, config strip, build menu, colonist list, info panel, task list, minimap, resources, global task list, toasts, then the three dialogs last).

The z=0 fast path is important: when nothing in the flush carries a non-zero z, the index buffer is used untouched and draw order is exactly tree/submission order (`:538-550`). The moment one draw carries a non-zero z (a popup opens, or any shape child with `zIndex = 1`), the whole flush is re-emitted in sorted order.

### 3.3 How child order and zIndex combine (worked example)

`Component::render` for a panel with children `[bg(z 0), close_bg(z 2), close_text(z 3), title(z 1)]` (`TaskListView.cpp:52-115`) renders `bg, title, close_bg, close_text`. Batch groups produced: `bg -> z 0` (Rectangle via RenderContext), `title -> z 0` (Text ignores RenderContext), `close_bg -> z 2`, `close_text -> z 0`. If any non-zero z exists anywhere in the same flush (it does, z 2), the sorted emit order is `[all z 0 groups in submission order] ... [close_bg at z 2] ...`, so the close button's "X" text is emitted before its z-2 background and is hidden under it. This is the concrete consequence of the two-domain design and is discussed in section 10.

### 3.4 Shadows: drawn beneath their owner, above what's behind

`drawRect` emits the outer box-shadow as its own SDF quad first and the fill quad second, both with `args.zIndex` (`Primitives.cpp:284-293`; header comment "Emit before the element's own quad so it sits behind", `BatchRenderer.h:80-83`). Two consecutive groups with equal z stay adjacent and ordered through a stable sort, so the shadow can only ever be directly beneath its owner. It composites over whatever was submitted earlier at the same or lower z, exactly like CSS `box-shadow` painting over an earlier sibling's background. Shadow geometry: SDF rect grown by `spread`, quad grown by `blur` (`BatchRenderer.cpp:290-357`); shader alpha `1 - smoothstep(-blur, blur, dist)` (`uber.frag:176-195`), matched to CSS Gaussian falloff by a later commit (`91d6ed5 Match box-shadow falloff to CSS`). Glow is the same primitive with zero offset and a colored, spread-grown shadow (`Panel.cpp:90-95`, `Dialog.cpp:304`).

Text shadow (`TextArgs.shadowColor/shadowOffset`) is a second full pass of glyph quads emitted before the main pass at the same z (`Primitives.cpp:462-465`).

### 3.5 How alpha blending order is guaranteed; depth test

Straight alpha `over` with no depth test and no depth writes (`BatchRenderer.cpp:553-557`, `drawInstanced` `:868-871`, `BakedChunkRenderer.cpp:176-179`). The only guarantee is emission order; there is no opaque/transparent split and no front-to-back opaque pass. The design doc `docs/technical/ui-framework/batched-text-rendering.md:169-216` proposes a two-pass scheme (opaque front-to-back with depth writes, transparent back-to-front with depth test) plus premultiplied alpha (`:513-520`), and the leftover `BatchKey`/`DrawCommand`/`g_commandQueue`/`GetColorBatchKey`/`GetTextBatchKey` in `Primitives.cpp:28-84,147-166` are that design's dead scaffolding: nothing references them. The depth-buffer option was rejected on the record for the world as well: "Every world pass draws alpha-blended, anti-aliased cel-shaded edges; GL_DEPTH_TEST hard-rejects fragments and tears transparent/AA edges" (`docs/technical/rendering/world-depth-sorting.md:83`). SDF edges are 1px alpha ramps, so a depth test would produce dark/aliased seams wherever two shapes meet; painter order is load-bearing for the anti-aliasing, not just for transparency.

### 3.6 Overlays: how tooltips, dialogs, context menus, toasts and popups get on top

There is no deferred/overlay render list. One was built and reverted the same day: commit `b5dc8be` ("Add a top overlay layer so popups paint above all UI", `submitOverlay(zIndex, fn)` drained by `endFrame` after all normal UI), replaced by `f1ff5ac` ("UI z-index: global sorted draw queue in BatchRenderer") whose message calls the overlay queue a "dead-end" (`2026-06-16-ui-salvage-reconcile-onto-main.md:13-35`). Current mechanisms:

| Overlay | Mechanism | Value | Where |
|---|---|---|---|
| Dropdown / Select menu | batch z on all its draws (rendered inline by its trigger) | 1000 (+1 hover wash, +2 label) | `DropdownButton.cpp:44`, `Select.cpp:40`, `Menu.cpp:143-173` |
| Context menu | batch z | 400 (+1, +2) | `ContextMenu.cpp:19,300-334` |
| Tooltip | batch z | 500 (+0.1 for text) | `TooltipManager.cpp:112`, `Tooltip.cpp:132-188` |
| Toasts | batch z | 2000 + stack index (+0.1/+0.2/+1) | `GameUI.cpp:152`, `ToastStack.cpp:60`, `Toast.cpp:196-267` |
| Modal dialogs | root render order (drawn last) plus a full-screen scrim; batch z 0 | component z `z_modal` = 200 only for the lint | `GameUI.cpp:119-123,618-631`, `Dialog.cpp:291-379`, `ColonistDetailsDialog.cpp:79-81` |
| Placement ghost, previews | batch z in the world flush | 1000, 899-910 | `GhostRenderer.cpp:108`, `DrawingSystem.cpp:1374-1953` |

The design tokens define a different ladder (`libs/ui/theme/Tokens.h:106-113`: `z_base 0, z_panel 10, z_raised 20, z_overlay 100, z_modal 200, z_toast 300, z_tooltip 400`, mirrored in `docs/design/ui/design-system/tokens.md:141-148`), but the widgets use the literal 400/500/1000/2000 values above. The token ladder is currently aspirational except `z_modal` and `z_panel` used as lint markers.

Because dialogs draw at batch z 0 and only win by root order, anything with a batch z above 0 that is submitted in the same flush paints over an open dialog's scrim and panel: every open popup (intended), but also any HUD `Rectangle`/`Icon` child with a lint-motivated positive z (see section 10, item 3).

### 3.7 The world/UI split and mid-frame barriers

`GameScene::render` (`GameScene.cpp:959-1043`) draws terrain (raw GL, flushes the batch first), committed construction (batched, z 50-64) then `Primitives::flush()` (`:983-984`), the Y-sorted entity pass (raw instanced draws interleaved with batched CPU triangles that are flushed at their sorted position, `InstancedEntityRenderer.cpp:109-174`), previews/overlays (batched, z 56-71 and 899-910), selection and move marker (z 100), placement ghost (z 1000), then `Primitives::flush()` (`:1040`) and `gameUI->render()` (`:1043`), and finally `endFrame` from the overlay renderer. The comment at `:1035-1039` states the rule: "Batched groups only z-sort within one flush, so this keeps the world zIndex space ... and the UI zIndex space ... independent, no world primitive can ever sort above the UI." The bug that motivated it (construction z 50-64 and previews z 899-910 sorting above panels at z 0 and even above dialogs, because everything after the entity pass shared one `endFrame` flush) is documented in `2026-07-03-construction-layering-story-b.md:17-25`.

World depth ordering itself is a separate CPU painter's sort by ground-contact Y (`libs/engine/world/rendering/WorldDepthSort.h:3-14`, `docs/technical/rendering/world-depth-sorting.md`); the doc explicitly says the UI DrawGroup z-sort "stays a clean UI-only primitive" and is not reused for the world (`:78,84`). The consequence for the batcher: mixing raw GL draws with batched draws requires flushing the batch before every raw draw so submission order stays equal to depth order (`InstancedEntityRenderer.cpp:109-114`).

### 3.8 Ordering invariants, numbered

1. Within one flush, final draw order is `stable_sort(groups, by z ascending)`, one group per `add*` call; equal z keeps submission order. If no group has non-zero z, order is exactly submission order.
2. z has meaning only within a flush. `flush()` is a hard barrier: everything submitted before it paints beneath everything after it regardless of z. Distinct passes (world vs UI, backdrop vs 3D blit) get their own z spaces this way.
3. Within a subtree, a parent's own draws precede its children's; children are visited in stable (component zIndex, insertion) order; invisible children and their subtrees are skipped; UI roots are visited in hand-written code order.
4. A `Rectangle`/`Circle`/`Line` shape draws at batch z equal to its own component `zIndex` (via `RenderContext`); an `Icon` draws at its own `zIndex`; a `Text` shape always draws at batch z 0; composite widgets pick their own z (most pass nothing, i.e. 0).
5. A rect's box-shadow group is emitted immediately before its fill group at the same z; a text shadow pass is emitted immediately before the main glyph pass at the same z. Stable sorting keeps them adjacent, so a shadow is always directly beneath its owner.
6. There is no depth buffer, no depth writes, and no opaque/transparent partition. Blending is straight-alpha `over`. Correct transparency and correct SDF/MSDF anti-aliasing both depend entirely on back-to-front emission.
7. Clip bounds and the current transform are captured into each vertex at add time (`BatchRenderer.cpp:220-230, 385-391, 468-505`). Sorting, atlas splitting, or later push/pop cannot change what a vertex is clipped to or where it lands.
8. Raw GL passes must call `BatchRenderer::flush()` before drawing (terrain, baked chunks, instanced runs, FBO blits). Batched draws submitted after a raw pass paint over it.
9. Multi-atlas text splits draw calls in emit order and never reorders triangles, so z is exact across atlas switches.
10. `Component::ensureRenderOrder` sorts a copy (`renderOrder`), never `children`, because `LayerHandle` indexes into `children` (`Component.h:368-371`, test `Layer.test.cpp:115-134`).
11. z = 0 is the "organic" sentinel at the batch level; an explicit 0 is indistinguishable from "unset". (The 2025-11-18 layer work called the same 0-as-sentinel pattern a design smell and moved to -1; the batch level reintroduced it.)
12. Input dispatch order is the reverse of per-parent render order (`Component.h:338-359`), not the reverse of global batch order. A widget floated by a large batch z is still hit-tested only where its parent's dispatch reaches it.
13. Circle borders are 64 `drawLine` segments emitted after the fill with z 0 regardless of `CircleArgs.zIndex` (`Primitives.cpp:389-398`); they are ordered with their fill only on the z-0 fast path.
14. Content offset (scroll) is applied before the clip push, so the clip rect stays fixed in screen space while children translate (`Container.h:76-92`, `clipping.md:261-264`).
15. The batcher has no notion of "opaque"; a fully opaque quad drawn later always replaces earlier pixels within its AA interior, so overdraw is the cost of every panel background.

### 3.9 What breaks when order is wrong (recorded incidents)

- Text invisible under button backgrounds because text rendered immediately while rects were batched and flushed later (`batched-text-rendering.md:17-23`); then, after batching text, text still rendered behind because of a premature text flush in `LayerManager::RenderLayers` (`2025-11-25-completed-sdf-text-rendering-epic-phase-5-polish.md:34-48`). Fix: one batch, one flush.
- TopBar/GameplayBar backgrounds given explicit `zIndex = 500/400` rendered on top of their children at z 0 (`2025-12-28-information-systems.md:28-32,56-60`). Fix: no z on backgrounds, rely on insertion order.
- Dropdown/select menus painted behind sibling widgets because z was per-parent only and "dropped at the BatchRenderer boundary" (`2025-12-27-ui-complex-components.md:100`, `2026-06-16-...:15-19`). Fix: global batch z-sort.
- Committed construction and drawing previews sorted above HUD panels and dialogs because they shared the UI's flush (`2026-07-03-construction-layering-story-b.md:17-25`). Fix: mid-frame `flush()` barriers.
- Colonists always drew over trees because dynamic entities were a later pass than baked flora (`world-depth-sorting.md:21`). Fix: CPU Y-sort with interleaved flushes.

---

## 4. Clipping

**Mechanism.** Per-vertex axis-aligned clip rect evaluated in the fragment shader; nothing else. `pushClip` computes an AABB for whatever `ClipShape` was given, intersects it with the parent's, pushes it, and sets `BatchRenderer::currentClipBounds` (`Primitives.cpp:553-571`). Every subsequently added vertex copies `currentClipBounds` into `UberVertex::clipBounds` (attribute location 5). The shader discards fragments outside it (`uber.frag:86-103`):

```glsl
if (v_clipBounds.z > v_clipBounds.x) {                     // (0,0,0,0) means no clip
    vec4 physicalClipBounds = v_clipBounds * u_pixelRatio;  // logical -> physical px
    float physicalY = u_viewportHeight - gl_FragCoord.y;    // GL bottom-left -> UI top-left
    if (gl_FragCoord.x < physicalClipBounds.x || gl_FragCoord.x > physicalClipBounds.z ||
        physicalY < physicalClipBounds.y || physicalY > physicalClipBounds.w) discard;
}
```

Zero GL state changes and full batching preserved; this is the whole point (`clipping.md:114-125`, `2025-11-29-shader-based-rect-clipping-phase-1-complete.md:33-42,75`). The instanced world path zeroes `v_clipBounds` so entities are never clipped (`uber.vert:57,73`).

**Nesting.** Intersection of AABBs (`IntersectClipBounds`, `Primitives.cpp:529-551`); `popClip` restores the parent's precomputed bounds (`:573-588`). Depth is unlimited (a `std::stack`). Benchmarks for push/pop and nesting exist in `Clipping.bench.cpp`.

**Interaction with batching and ordering.** None: clipping is data, not state, so clipped and unclipped geometry share one draw call, and z-sorting cannot move a vertex out of its clip. This is a real strength worth keeping.

**Rounded / circle / path clips and `ClipMode::Outside`.** Declared in `ClipTypes.h` but all collapse to the bounding box (`Primitives.cpp:482-522`); the stencil "Phase 3-5" of `clipping.md:299-311` was never built, no stencil bits are requested at window creation (`AppLauncher.cpp:128-131` has no `GLFW_STENCIL_BITS`), and no `glScissor`/`glStencil*` call exists in the 2D path (the only scissor references are state save/restore in `libs/planet-view/PlanetRenderer.cpp:142-207`).

**Transforms.** The clip rect is never transformed. `pushClip` uses the raw rect (`ComputeClipBounds`, `:471-480`) and the shader compares in screen space, while `PushTransform` only affects vertex positions (`TransformPosition`, `BatchRenderer.cpp:16-23`). `Container::render` deliberately pushes the transform first so the viewport stays fixed while content scrolls (`Container.h:76-92`). The corollary is that any clip rect must be supplied in absolute screen coordinates even when the container itself lives inside an offset parent; `ScrollContainer` derives its clip from its own `position` (`ScrollContainer.cpp:211-223`), so a `ScrollContainer` nested inside a content-offset `Container`/`Dialog` clips at the wrong place unless its position is already absolute. Treat this as a hazard to verify in the port, not a confirmed live bug.

**Empty intersection bug.** `IntersectClipBounds` returns `(0,0,0,0)` when two clips do not overlap (`:545-548`), and `(0,0,0,0)` is also the "no clipping" sentinel (`:478-479`, shader `:90`). A nested region that should be entirely hidden becomes entirely unclipped instead. The port needs a distinct "clip everything" representation (or discard the draws on the CPU).

**Legacy scissor API.** `PushScissor/PopScissor` only track a rect; the GL application is a `TODO` (`Primitives.cpp:630-660`). `TextInput::render` wraps its text in it (`TextInput.cpp:123-139`), so overflowing input text is not clipped today.

---

## 5. Primitive shading (the uber shader)

Files: `libs/renderer/shaders/uber.vert` (92 lines), `uber.frag` (222 lines), `includes/instancing.glsl` (attributes 6-7, camera uniforms, groundcover deform). `text.vert/text.frag` are a leftover single-channel text shader that nothing loads. `tile.vert/tile.frag` is the separate terrain pass (data textures, `texelFetch`), out of scope here. GLSL is `#version 330 core` with a custom `#include` preprocessor (`ShaderPreprocessor.h:3-9`).

**Vertex layout** (attributes, all `GL_FLOAT`, stride 80, `BatchRenderer.cpp:79-104`): 0 `a_position vec2`, 1 `a_texCoord vec2`, 2 `a_color vec4`, 3 `a_data1 vec4`, 4 `a_data2 vec4`, 5 `a_clipBounds vec4`. Instanced meshes use only 0 and 2 (position + color, `InstancedMeshVertex`, `InstanceData.h:81-84`) plus per-instance 6 `(worldPos.xy, rotation, scale)` and 7 `colorTint` with divisor 1 (`BatchRenderer.cpp:826-835`; `InstanceData` is 32 bytes, 16-aligned, `InstanceData.h:20-49`).

**Vertex shader** (`uber.vert:37-92`): three paths selected by `uniform int u_instanced`: 0 = batched (pass-through, `gl_Position = u_projection * u_transform * vec4(a_position, 0, 1)`), 1 = instanced (`instanceToScreen` from `instancing.glsl:36-80`), 2 = baked world-space (`worldToScreen`, `:91-94`). Paths 1 and 2 write `v_data2.w = -2.0` and zero clip bounds.

**Fragment shader modes**, branched on `v_data2.w` (`uber.frag:72-221`):

| `data2.w` | Mode | Inputs | Output |
|---|---|---|---|
| in (-2.5, -1.5) | instanced/baked flat color | `v_color`, `u_bakedAlpha` | `vec4(rgb, a * u_bakedAlpha)`, returns before the clip test |
| >= 0 (0 Inside, 1 Center, 2 Outside) | SDF rounded rect with border | `texCoord` = rect-local pos, `data2.xy` half size, `data2.z` radius, `data1` = (border.rgb, width) | `mix(fill, border, borderBlend)`, alpha `shapeAlpha * mix(fill.a, 1.0, borderBlend)` |
| -1 | MSDF text | `texCoord` UV, `data2.x` pixelRange, `u_atlas` | `vec4(rgb, a * opacity)` |
| -3 | box-shadow / glow | `texCoord` SDF coords, `data2` (halfW, halfH, r, -3), `data1.x` blur | `vec4(rgb, a * (1 - smoothstep(-blur, blur, dist)))` |

**SDF and anti-aliasing.** `sdRoundedBox` (Inigo Quilez, `uber.frag:34-43`) with radius clamped to the half-size. Edge AA is `1 - smoothstep(-px, +px, dist)` where `px = length(vec2(dFdx(dist), dFdy(dist)))` (`:123-125,147`), i.e. one screen pixel wide under any transform or DPI. Border position modes set `(borderInner, borderOuter)` to `(-w, 0)`, `(-w/2, +w/2)`, `(0, +w)` (`:127-141`); the CPU expands the quad by the outward extent so Center/Outside borders are not cut off, while `shapeParams` keeps the original half-size (`BatchRenderer.cpp:192-213`). Fragments with `shapeAlpha < 0.001` are discarded (`:150-152`). The whole design and its performance rationale (5x fewer vertices than the old 4-line borders, ~25 ALU/pixel) is `docs/technical/ui-framework/sdf-rendering.md`.

**Gradients** are per-corner vertex colors interpolated by the GPU (`BatchRenderer.cpp:145-166`), composed with the SDF, so they batch with everything else.

**Tessellated geometry** (`addTriangles`: circles, lines, icons, ghosts, animated colonists) is tagged as a shape with `shapeParams = (0,0,0,1)` and zero rect-local coords (`BatchRenderer.cpp:373-391`). That makes `dist == 0` exactly and `pixelSize == 0`, so `shapeAlpha = 1 - smoothstep(0.0, 0.0, 0.0)`, which GLSL defines as undefined (`edge0 >= edge1`). It renders opaque on the tested desktop drivers, so the code works by accident. A port must add an explicit flat mode rather than inherit this.

**Text (MSDF)**: median of RGB, `screenPxRange` from `fwidth(v_texCoord)` and `textureSize(u_atlas, 0)`, `opacity = smoothstep(-0.5, 0.5, screenPxDistance)` (`:49-59,197-221`). Atlases are `GL_RGB`, linear filtered, clamp-to-edge (`libs/ui/font/FontRenderer.cpp:292-297`), one per `FontFamily` (`FontFamily.h:12-20`: Roboto, ChakraPetch, Barlow, JetBrainsMono).

**Alpha model**: straight (non-premultiplied) colors in, straight color out, `GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA`. Border color has no alpha channel in the vertex (`data1.a` is width) and the border region is forced to alpha 1.0 (`uber.frag:171`), so fades that multiply `.a` into border colors (`Dialog.cpp:286-303`, `Tooltip.cpp:128`) leave borders opaque. No gamma, sRGB, or linear-light handling anywhere: colors are 0..1 floats treated as display values; no `GL_FRAMEBUFFER_SRGB`, no sRGB textures, no MSAA hint.

**Texture usage**: one `sampler2D u_atlas` on unit 0; shapes ignore it. No texture arrays, no atlas of images for UI (icons are tessellated SVG triangles, `Icon.cpp:228-246`; there is no `drawTexture` despite the 2025 design doc listing one).

**Uniforms** (`uber.vert:23-24`, `uber.frag:16-26`, `instancing.glsl:16-31`): `u_projection`, `u_transform`, `u_atlas`, `u_bakedAlpha`, `u_viewportHeight` (physical), `u_pixelRatio`, `u_instanced`, `u_cameraPosition`, `u_cameraZoom`, `u_pixelsPerMeter`, `u_viewportSize` (logical), and the groundcover deform set.

---

## 6. Coordinate system and DPI

- Two spaces (`CoordinateSystem.h:9-23`, `.cpp:7-26`): logical pixels (window coordinates, what all public APIs, layout, and mouse input use) and physical pixels (framebuffer). `pixelRatio = framebufferWidth / windowWidth`, cached and invalidated on resize (`:91-125`).
- Screen projection: `glm::ortho(0, logicalW, logicalH, 0, -1, 1)`, origin top-left, Y down, built from the live GLFW window size each flush (`CoordinateSystem.cpp:33-48`, used at `BatchRenderer.cpp:577-582`). World projection is centered with Y up (`:50-65`) but the batcher never uses it; world-space code converts to screen itself (`camera.worldToScreen(...)`, e.g. `GameScene.cpp:1020`).
- `glViewport` is the only physical-pixel call (`setFullViewport`, `:80-89`; resize callback `AppLauncher.cpp:94-110` calls `glViewport(0,0,w,h)` with framebuffer size, marks the pixel ratio dirty, and pushes the physical size to `Primitives::setViewport`). The batcher needs the physical height and ratio only for the fragment-shader clip test (`BatchRenderer.cpp:590-602`).
- Off-screen rendering (`AssetRenderer.cpp:48-70`) sets `setCoordinateSystem(nullptr)` so the fallback `ortho(0, vw, vh, 0)` matches the FBO exactly.
- Pixel mapping policy: 1 logical unit = 1 logical pixel, no virtual resolution; shapes keep constant pixel size on resize (`2025-10-26-pixel-perfect-ui-rendering-window-sizing.md:5-31`). A global UI scale is planned as `logicalSize = framebufferSize / uiScale` at the `getLogicalViewport` level, applied to layout not as a bitmap zoom, with input hit-testing in the same scaled space (`docs/design/ui/ui-scale-setting.md:20-50`).
- Pixel snapping: only text, and only the run origin, snapped to the physical grid (`round(origin * pixelRatio) / pixelRatio`) under identity or translate-only transforms, with every glyph shifted by the same delta so kerning/advances are untouched (`BatchRenderer.cpp:430-455`, cache in `TextSnapCache`). Shapes are not snapped; SDF AA handles fractional edges. Under rotation/scale nothing is snapped.
- Transform classification (`setTransform`, `:725-743`) exists to keep the per-vertex path cheap: identity skips the multiply, translate-only enables text snapping, general goes through the 4x4.
- Y flip for text UVs: atlas UVs are flipped in `addTextQuad` (`:465-505`) because the atlas origin is bottom-left; `gl_FragCoord` flip for clipping happens in the shader.

---

## 7. Text integration (brief)

`Primitives::drawText` (`Primitives.cpp:401-466`) and `UI::Text::render` (`Shapes.cpp:88-231`) both end in `BatchRenderer::addTextQuad` per glyph: one 4-vertex quad with `data2 = (pixelRange, 0, 0, -1)`, per-vertex atlas tag, current clip, current transform, and z. Glyph quads come from `ui::FontRenderer::generateGlyphQuads` (`FontRenderer.h:114`) as `GlyphQuad { position, size, uvMin, uvMax, color, runOrigin }` (`:85-92`). Text therefore batches with shapes in one VBO and one draw call per atlas run, in exact submission/z order; that unification was the "uber shader epic" (`2025-11-30-uber-shader-epic-complete.md`). `drawText` handles text-transform, alignment inside an optional box, letter spacing, per-family atlas, and a shadow pass; `UI::Text` handles wrapping and box/point alignment and always uses the default (Roboto) atlas at z 0. The font renderer keeps an LRU glyph-quad cache advanced by the frame callback (`Primitives.cpp:143-145,175-178`). Everything else about fonts is another agent's topic.

---

## 8. Performance decisions on record

- SDF rects replaced 4-line borders: 4 vertices instead of 20 per bordered rect, corner radius for free, "~3x faster" projected (`sdf-rendering.md:39-65,568-645`). Corner radius and border position are per-vertex, so style changes never break a batch (`:1544-1554`).
- One uber shader for shapes + text: zero shader switches, one draw call, correct z-ordering (`2025-11-30-uber-shader-epic-complete.md:6-13`). Draw splitting by atlas was added later for multiple font families with no reordering (`BatchRenderer.cpp:610-622`).
- Shader clipping instead of `glScissor`: zero draw calls added, versus a flush per scissor change ("per-command scissor problem ... ColonySim experience", `clipping.md:267-281`).
- Global z-sort cost gate (`ZSort.bench.cpp`, `f1ff5ac` commit message): at 10k draw calls, baseline 94us, fast path 105us (+10us always-on for the group records), sorted with ~2% explicit z 282us, paid only on frames with an open popup. Sorting groups rather than triangles and the "no explicit z means no sort" fast path are the two design levers.
- Groups are per draw call, so sorting cost is O(draw calls), not O(triangles); the emit index list is rebuilt, the vertex array is not touched.
- Text snap delta cached per run (`251a776`), glyph quads LRU-cached.
- Tile pass moved off the uber shader to data textures, deleting the tile branch and shrinking `UberVertex` from 96 to 80 bytes (`2026-06-10-render-performance-overhaul.md:23-29`).
- World geometry never goes through per-call groups: baked chunk VBOs and GPU instancing (up to 2M instances per mesh, `BatchRenderer.cpp:747-751`; ~486k grass tufts at 1.75ms, `2026-06-27-groundcover-render-path.md:5`). The world-depth doc rejects routing entities through `add*` groups precisely because it would defeat instancing and pay a full sort plus index rebuild each frame (`world-depth-sorting.md:84`).
- Measured cost of the mid-frame flush barrier: +0.9ms scene-render CPU at 90 buildings, attributed to uploading a separate batch mid-frame and to driver-side sync on reusing the same VBO within a frame (`2026-07-03-construction-layering-story-b.md:78-84`); flagged as a follow-up ("same-VBO in-frame reuse hazard").
- Every flush respecifies VBO and IBO with `glBufferData` (orphaning); reservations are 10k vertices / 15k indices (`BatchRenderer.cpp:26-31`).
- Circles are 64-segment fans; borders are 64 line quads; the docs note SDF circles/lines as future work (`sdf-rendering.md:1606-1620`).

---

## 9. OpenGL-specific features vs WebGL2

Inventory from `grep` over `libs/` and `apps/` (non-test):

| Feature | Where | WebGL2 status / note |
|---|---|---|
| GLSL 3.30 core, `#include` via custom preprocessor | all shaders, `ShaderPreprocessor.*` | Rewrite as GLSL ES 3.00 (`#version 300 es`, precision qualifiers, `out vec4` ok). Keep a string-level include step. |
| `dFdx/dFdy/fwidth`, `textureSize`, `discard` | `uber.frag:56-57,125` | Core in ES 3.00. Derivatives inside branches are fine here because the branch is per-primitive uniform data. |
| VAOs, `glVertexAttribPointer` float attributes | `BatchRenderer.cpp:72-109` | Core. |
| `GL_UNSIGNED_INT` element indices | `BatchRenderer.cpp:641,655` | Core in WebGL2 (was an extension in WebGL1). |
| `glDrawElementsInstanced`, `glVertexAttribDivisor` | `BatchRenderer.cpp:830-835,921` | Core. |
| `glBufferData` per flush with `GL_DYNAMIC_DRAW`, `glBufferSubData` for instances | `:564-568,918` | Available; per-call overhead is higher in the browser, prefer fixed-capacity buffers + `bufferSubData`. |
| Timer queries `GL_TIME_ELAPSED`, `glGetQueryObjectui64v` | `libs/renderer/gl/GLQuery.h`, `metrics/GPUTimer.cpp` | Only via `EXT_disjoint_timer_query_webgl2`, widely disabled. Metrics only; drop or feature-detect. |
| `glGetIntegerv` / `glIsEnabled` state save-restore around raw passes | `ChunkRenderer.cpp:139-146,204-219`, `BakedChunkRenderer.cpp:170-179,262-277`, `PlanetRenderer.cpp:232-262` | Synchronous `getParameter` is slow in WebGL; track state in JS instead. |
| `GL_RGB` 8-bit MSDF atlas, `GL_RGBA8` FBO color | `FontRenderer.cpp:292`, `RenderToTexture.cpp:9` | Fine; RGB needs `UNPACK_ALIGNMENT` care, RGBA is simpler. |
| `GL_RGBA32UI` data textures + `texelFetch` (tile pass) | `ChunkRenderer.cpp:76,90`, `tile.frag:54-57` | Core in WebGL2 (integer textures). Out of scope for UI. |
| Fullscreen triangle via `gl_VertexID` | `libs/planet-view/shaders/blit.vert:8-9` | Core in ES 3.00. |
| `glBlendFuncSeparate` | `PlanetRenderer.cpp:244,257` | Core. |
| `glReadPixels` (screenshots, asset bake) | `DebugServer.cpp:365`, `AssetRenderer.cpp:73` | Core; async via PBO fences if needed. |
| FBO render-to-texture | `RenderToTexture.*`, planet view | Core. |
| `glClear(GL_COLOR_BUFFER_BIT)` only; no depth/stencil buffers requested | `Application.cpp:240-241`, `AppLauncher.cpp:128-131` | Request `depth:false, stencil:false` on the context; never allocate them. |
| Not used at all: UBOs, SSBOs, geometry shaders, `glMultiDraw*`, texture arrays, sRGB framebuffers, MSAA, `glLineWidth`, `GL_LINES`, persistent mapping | (grep negative) | Nothing blocks the port. Lines are already quads, which sidesteps WebGL's 1px line limit. |
| Straight-alpha output + `SRC_ALPHA/ONE_MINUS_SRC_ALPHA` | `BatchRenderer.cpp:553-554`, `uber.frag` | A WebGL canvas is premultiplied by default; straight-alpha blending leaves wrong destination alpha and composites incorrectly over the page. Either create the context with `alpha:false` or (better) premultiply in the shader and blend `ONE, ONE_MINUS_SRC_ALPHA`. |
| Thread-local `RenderContext`, static `g_*` singletons | `RenderContext.cpp:7`, `Primitives.cpp:63-84` | Module-level state in TS; the thread-local is just a global. |
| Undefined `smoothstep(0,0,0)` for tessellated triangles | `uber.frag:147` with `addTriangles` params | ANGLE (D3D11/Metal/Vulkan) may resolve NaN differently from native drivers. Add an explicit flat mode. |
| `gl_FragCoord` bottom-left origin, physical pixels | `uber.frag:94-96` | Same in WebGL; `u_viewportHeight = canvas.height`, `u_pixelRatio = devicePixelRatio` (or the ratio actually used to size the canvas). |

---

## 10. Gotchas, bugs, and lessons (from code and dev log)

1. **Two z domains that don't compose.** Component `zIndex` is per-parent, but `Rectangle/Circle/Line/Icon` copy it into the global batch sort while `Text` and most composite widgets draw at 0. Any HUD shape given a positive z for the layout lint (`SpeedButton.cpp:29,39` z 501/502; `TaskListView.cpp:73` z 2; `ResourcesPanel.cpp:98-106`, `GlobalTaskListView.cpp:41-85` z 1; `GameplayBar.cpp:57` z -1) becomes a global layer: it sorts above every z-0 draw in the flush, including an open dialog's scrim and panel (`Dialog.cpp:293-304`, batch z 0) and a context menu at 400 in the 501/502 case, and a `Text` sibling at "z 3" (`TaskListView.cpp:92`) is emitted before a `Rectangle` sibling at z 2 and is hidden by it. The 2025-12-28 lesson ("don't set zIndex on backgrounds", `2025-12-28-information-systems.md:56-60`) is the same failure from the other side.
2. **Dialog stacking is by root order only.** Comments say so (`ColonistDetailsDialog.cpp:79-81`, `GameUI.cpp:119-123`), and it works because nothing behind it carries z, until item 1 bites. The token ladder (`Tokens.h:106-113`) is not what the widgets use (400/500/1000/2000).
3. **Empty clip intersection unclips** (`Primitives.cpp:545-548` vs sentinel `:478,590-594`, shader `uber.frag:90`).
4. **Clip rects are screen-space and never transformed**; nested clip containers inside offset containers must compute absolute rects (section 4).
5. **Legacy `PushScissor` is a no-op**; `TextInput` text overflow is unclipped (`Primitives.cpp:640-641`, `TextInput.cpp:129`).
6. **Circle borders drop `zIndex`** (`Primitives.cpp:396`) and circles/lines/icons have no AA (tessellated).
7. **Tessellated triangles depend on undefined `smoothstep`** (section 5).
8. **Border alpha is ignored and borders are forced opaque** (`uber.frag:171`, `data1.a` is width), so widget fade-ins fade fills and text but not borders.
9. **Dead code and doc drift**: `BatchKey/DrawCommand/g_commandQueue` (`Primitives.cpp:28-84,147-166`) and `text.vert/.frag` are unused; `batched-text-rendering.md` describes an unbuilt two-pass depth/premultiplied design; `primitive-rendering-api.md` describes scissor-flush batching rules (`:226-231`) and a `DrawTexture` API that never existed; `clipping.md` "Files to Modify" lists stencil work that was never done. Trust the code over these three docs.
10. **z sentinel**: explicit 0 == unset at the batch level (`recordGroup`, `BatchRenderer.cpp:124-126`), the very smell the 2025-11-18 layer refactor removed at the layer level (`2025-11-18-layer-system-api-improvements.md:47,89`).
11. **Sort must not touch `children`** or handles break (`Component.h:368-371`, regression test `Layer.test.cpp:115-134`).
12. **Premature flushes kill ordering**: the 2025-11-25 text-behind-buttons bug came from flushing text early (`...phase-5-polish.md:34-48`); the reverse (not flushing before raw GL) produced construction-over-UI and colonist-over-tree bugs. The rule is "flush only at pass boundaries, and always at pass boundaries".
13. **Mid-frame flushes cost real CPU** (+0.9ms at 90 buildings) and reuse the same VBO within a frame, which the team suspects stalls the driver (`2026-07-03-construction-layering-story-b.md:78-84`). A ring of buffers or per-pass buffers is the standard fix.
14. **DPI in the clip test**: `gl_FragCoord` is physical while the API is logical; the first implementation scaled bounds on the CPU (`2025-11-29-...:44-51`), the current one scales in the shader with `u_pixelRatio`. Either way the ratio must reach the shader.
15. **Hardcoded projection** once scaled shapes with the window (`2025-10-26-...:5-18`); projection must follow the logical size every flush.
16. **Metrics blind spots**: draw-call metrics once counted only batcher flushes (3/frame) and the GPU timer window excluded `endFrame` (`2026-06-09-...:36-37,43`; `2026-07-03-...:74-77`). Instrument the flush itself.
17. **Overlay-queue detour**: a CSS-top-layer style deferred list was implemented and reverted within hours in favor of the global sort (`b5dc8be` -> `f1ff5ac`), on the grounds that it needed opt-in routing per widget and a portal-like registration. The sort needs neither.
18. **Event order vs paint order** can disagree (invariant 12): a popup at z 1000 paints over a later root, but a click reaches it only through its own parent's dispatch; `Container::handleEvent` also un-offsets coordinates so scrolled children hit-test correctly (`Container.h:38-55`).
19. **UV flip and run snapping**: atlas V is flipped per glyph (`BatchRenderer.cpp:465-505`); fractional run origins blur MSDF edges, hence snapping (`:430-436`).
20. **`u_bakedAlpha` defaulted to 0** and made instanced draws invisible until explicitly set to 1 at init (`BatchRenderer.cpp:58-62`): initialize every uniform.
21. **Text ignores the component z** entirely (`Shapes.cpp:222-229`), which is why widgets that need text above their own background use `drawText` with `zIndex + 0.1F` rather than a `Text` child.

---

## 11. Critique: keep, discard, change

### Essential to keep (the actual design, in backend-agnostic terms)

- One accumulating batch per pass, one shader, per-vertex "material" data (mode, SDF params, border, clip rect) so nothing ever breaks a batch. The whole UI is one draw call per pass plus one per font atlas.
- Painter's algorithm with no depth buffer; emission order is the correctness mechanism for both transparency and 1px SDF/MSDF anti-aliasing.
- Draw groups per API call with a stable sort by z that is skipped entirely when no z is present. Cheap, deterministic, and it made popups work without portals.
- `flush()` as an explicit barrier that partitions the frame into independent z domains (world vs UI, backdrop vs blit). This is the single most important ordering rule in the codebase and the one the owner is describing.
- Shadow/glow as a separate SDF quad emitted immediately before its owner at the same z; text shadow as a pre-pass. Both fall out of stable sorting for free.
- Per-vertex rectangular clipping with nesting by intersection; transform applied at add time (content offset before clip so the viewport stays fixed).
- Stable per-parent child sort, parent-before-children traversal, insertion order as the default layering (backgrounds first).
- Logical-pixel coordinate space with a pixel ratio that only the viewport and the clip test see; text run-origin snapping; SDF rounded rects with Inside/Center/Outside borders and per-corner gradient colors.
- The rejection record: no depth test (tears AA edges), no per-scissor flushes, no overlay/portal list, no triangle-level sorting, no `shared_ptr` scene graph.

### Incidental to C++/OpenGL (drop or replace)

- GLEW/GLFW wrappers, RAII GL handles, `thread_local` RenderContext, the `MemoryArena` + generational `LayerHandle` storage (a TS port can use plain arrays with stable sorting on a copy, keeping only the "never reorder the children array" rule if handles are indices).
- `std::variant` clip shapes with AABB fallbacks: expose only `ClipRect` until a real rounded/circle clip exists.
- `glBufferData` orphaning per flush, per-flush uniform re-upload, `glGetIntegerv` state restore around raw passes.
- Timer queries, the `#include` preprocessor (fold shader files at build time), the instancing/groundcover branch of the uber shader (world only; the UI spec does not need `u_instanced`).
- The dead command-queue structs, legacy scissor API, legacy `text.vert/frag`.

### What to change in the port

1. **One z model, not two.** Either make the component z purely local (never forwarded to the batch, popups implemented by a small set of named layers that map to flush barriers or z bands) or make it a resolved global stacking value computed during traversal (e.g. parent z band + local z, CSS stacking-context style), applied uniformly to every draw including `Text` and composite widgets. Today's mixture (`Rectangle` forwards, `Text` doesn't, `Button` doesn't, `Icon` does) is the source of every remaining ordering bug. A reasonable spec: draw calls take an explicit z that is always resolved from the tree by the framework, never by widgets, with `+0.x` sub-layers reserved for a widget's internal parts.
2. **Make "no z" explicit** (`undefined`/`null`, not 0) so an explicit 0 can be a real layer.
3. **Premultiplied alpha end to end** (shader multiplies rgb by a; blend `ONE, ONE_MINUS_SRC_ALPHA`), which also fixes WebGL canvas compositing and lets borders carry alpha (store border color as a full RGBA and a separate width slot).
4. **Explicit flat-shaded mode** for tessellated triangles instead of the degenerate SDF path; consider SDF circles and SDF capsule lines so all primitives are anti-aliased and circle borders stop being 64 draw groups.
5. **Clip representation** with three states (none, rect, everything-clipped) and clip rects transformed into screen space by the framework when pushed under an offset; keep the per-vertex approach.
6. **Flush barriers as first-class "layers"** in the spec (e.g. `beginLayer(name)`/`endLayer()`), each with its own z space, and document the rule: raw/foreign draws must sit at layer boundaries.
7. **Buffer strategy**: fixed-capacity growable typed arrays, `bufferSubData` into a small ring of buffers so mid-frame flushes do not reuse the buffer the GPU may still be reading.
8. **Keep the ordering invariants as tests**: a headless test that submits groups with mixed z and asserts the emitted index order (the C++ side only has a benchmark), a test for empty clip intersection, and a test that shadow precedes fill.
9. **Input**: hit-test in the same resolved order as paint (reverse of the final z order within the same layer), so floated popups and their hit regions agree.
10. Drop the `GL_RGB` atlas for RGBA, precompute physical clip bounds on the CPU if `devicePixelRatio` is fixed per frame (saves a multiply per fragment), and keep `u_viewportHeight`/`u_pixelRatio` semantics exactly as they are, since that DPI split is where two of the recorded bugs lived.
