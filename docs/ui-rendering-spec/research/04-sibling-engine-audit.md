# D. Current engine audit: dual-deck-builder TypeScript/WebGL renderer and UI layer

Read-only audit of the worktree at `C:/Users/kevin/Code/dual-deck-builder/.claude/worktrees/webgl-ui-rendering-spec-bcf458`, HEAD `49ae3c7` (2026-08-22), branch `claude/webgl-ui-rendering-spec-bcf458`, audited 2026-09-07. Every engine file, every screen, all docs, the toolchain configs, and the Specboard board (project `dual-deck-builder`, keys `DDB-*`) were read. Nothing was executed: `node_modules` is absent in this worktree and in the main checkout, so lint, tests, and tsc could not be run here. The last verified toolchain state is the 2026-08-22 survey recorded in `docs/AI_DEVELOPMENT_HUB.md:9` (128/128 tests, 0 lint errors, 9 warnings, web build compiles) plus the CI notes on `DDB-1` (all platforms green including Electron packaging after PR #15).

Line numbers are for this HEAD. All paths are relative to the worktree root unless absolute.

Size of what is being compared:

| Area | Lines | Files |
|---|---|---|
| `src/renderer/engine/rendering` | 2223 | Renderer 800, TextRenderer 572, FontAtlas 213, Shader 149, Texture 147, PerformanceMonitor 142, ScissorBatcher 132, RendererContext 44, RenderContext 24 |
| `src/renderer/engine/components` | 1782 | Layer 451, Text 279, Component 251, Arrow 227, Polygon 183, Rectangle 142, Circle 135, Triangle 114 |
| `src/renderer/engine/ui` | 1304 | Input 467, Panel 414, Button 299, DeveloperOverlay 124 |
| `src/renderer/engine/input` | 600 | InputSystem 480 + test 120 |
| `src/renderer/engine/types` | 125 | Style |
| engine total | 5914 | |
| `src/renderer/game/screens` | 6647 | 7 screens, 8 developer sections, 8 combat layers, 2 driver-selection panels |
| `src/renderer/game/ui` | 944 | Card 501, Vehicle 443 |
| shaders | 57 | vertex.glsl 13, fragment.glsl 44 |

---

## 1. Rendering pipeline today

### Context creation

`Renderer.ts:35`: `this.gl = this.canvas.getContext('webgl') as WebGLRenderingContext;`

WebGL1, no context attributes, so browser defaults apply: `alpha: true`, `antialias: true`, `premultipliedAlpha: true`, `depth: true`, `stencil: false`, `preserveDrawingBuffer: false`. Nothing checks for or uses WebGL2, VAOs (`OES_vertex_array_object`), or instancing (`ANGLE_instanced_arrays`). The canvas is `<canvas id="game-canvas">` in `public/index.html:40`, absolutely positioned full-window, body `overflow: hidden` (`index.html:8-20`).

The mismatch between `premultipliedAlpha: true` and the non-premultiplied blend function below is masked because `clearColor(0,0,0,1)` (`Renderer.ts:55`) makes the drawing buffer opaque.

### GL state

- `Renderer.ts:53-54`: `gl.enable(BLEND); gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`, set once, never changed. Straight (non-premultiplied) alpha.
- `Renderer.ts:155-157`: `clear()` clears `COLOR_BUFFER_BIT` only.
- Depth test never enabled, stencil never used. Painter's algorithm only.
- One shader program for the whole app, created in `src/index.ts:48-53` from the two GLSL imports and bound via `renderer.useShader(shader)` (`Renderer.ts:162`). `useShader` uploads projection and view matrices once per shader switch.

### Shaders

`src/assets/shaders/vertex.glsl` (13 lines): attributes `aPosition` (vec2), `aTexCoord` (vec2); uniforms `uModelMatrix`, `uViewMatrix`, `uProjectionMatrix`; `gl_Position = P * V * M * vec4(aPosition, 0, 1)`.

`src/assets/shaders/fragment.glsl` (44 lines), `precision mediump float`, uniforms `uTexture`, `uColor`, `uUseTexture`, `uStrokeColor`, `uStrokeWidth`, `uShapeSize`. What it can do:

- Solid fill: `gl_FragColor = uColor` (`:38`, `:41`).
- Texture as an alpha mask: `gl_FragColor = vec4(uColor.rgb, texColor.r * uColor.a)` (`:16`). Any texture is treated as a font mask; an RGBA image would render as a tinted silhouette. This is the only texture path.
- Axis-aligned inset stroke in UV space (`:19-39`): distance to the nearest quad edge in UV, stroke width converted from pixels via `uShapeSize`, `smoothstep` anti-aliasing on the inner edge only. Works only for the unit quad (UV 0..1); the circle/triangle/polygon paths draw without UVs and use `gl.lineWidth` strokes instead.

Not present: rounded corners, SDF of any kind, gradients, drop shadows, per-vertex colour, opacity other than `uColor.a`, texture + stroke together, dashed lines. The `Style.borderRadius` values (29 uses in game code) are parsed into `Rectangle.cornerRadius` (`Rectangle.ts:41-43`, `:96-99`) and never reach the renderer (`Rectangle.render`, `:119-127`, passes fill, border colour, border width only; `Renderer.drawRectangle` at `:291` has no radius parameter). Every "rounded" or "circle-via-borderRadius" rectangle is square today.

`Shader.ts:97-148`: every `setFloat/setInt/setBool/setVector2/setVector4/setMatrix4` calls `gl.getUniformLocation` on each use; no location cache. `drawQuad` also calls `getAttribLocation` twice per draw (inside `Renderer.ts:176-289`).

### Vertex format and geometry submission

- Static unit quad: 4 vertices of `[x, y, u, v]`, positions in -1..1, stride 16 bytes (`Renderer.ts:67-110`, `:255`), 6 indices. A model matrix translates and scales the unit quad into place (`:198` and following). One `drawElements(TRIANGLES, 6)` per rectangle (`:270`), `recordDrawCall(4)` (`:271`).
- Dynamic buffer: `maxDynamicVertices = 1024` (`:26`), position-only (stride 0) for circles (32-segment fan + optional `LINE_STRIP` stroke, `:416-505`), triangles (`:510-582`), polygons (fan triangulation, convex only, `triangulatePolygon` `:658-669`). Each draw re-uploads with `bufferSubData` and enables/disables attribute arrays.
- `drawLine` (`:306-356`) exists, never sets `uUseTexture`/`uStrokeWidth`, and has zero callers.
- Custom texcoord quads go through the dynamic buffer (`:234-252` region of `drawQuad`).
- Per-draw allocations: `mat4.create()` at `:198`, `:326`, `:450`, `:542`, `:615`, `:787`, plus `new Float32Array` for circle/polygon vertices every frame.

Net: one draw call per shape, uniforms re-looked-up per draw, no batching of shapes at all. The hub's "~30 draw calls per frame" figure (`AI_DEVELOPMENT_LOG.md:653`) is for the developer screen after text batching; combat draws roughly one call per rectangle (cards alone are 2 rects + badge each).

### Projection, coordinate system, DPI, resize

`Renderer.ts:113-152` `resize()`:

- `dpr = window.devicePixelRatio || 1`; backing store `canvas.width = innerWidth * dpr` (`:122`), CSS size set to `innerWidth px`; `gl.viewport(0, 0, canvas.width, canvas.height)` (`:130`).
- `mat4.ortho(proj, 0, displayWidth, displayHeight, 0, -1, 1)` (`:134-142`): origin top-left, y down, units are CSS pixels. View matrix is identity.
- Window `resize` listener registered in the constructor (`:50`). Each `Screen` registers its own window resize listener on mount (`Screen.ts:49-50`) and re-lays out through `onResized`; `ScreenManager.resize` (`ScreenManager.ts:125`) exists but has no caller. Renderer's listener runs first because it was added first; nothing synchronises the two.
- No pixel snapping for shapes. Text glyph origins are `Math.round`ed in CSS px (`TextRenderer.ts:217-218`, `:364-365`), which is a half-pixel on 2x displays.

### Scissor handling

Two independent implementations of the same save/restore pattern:

- `Layer.render` (`Layer.ts:396-449`): when `overflow === 'hidden'` and the layer has a size, save `gl.getParameter(SCISSOR_BOX)` if scissor was on (a synchronous GL state query per clipped layer per frame, `:405`), convert to device pixels with the y flip `webglY = floor((canvas.height/dpr - screenY - height) * dpr)` (`:410-416`), `renderer.enableScissor(...)`, render children, restore or disable.
- `Panel.render` (`Panel.ts:320-367`): the same logic, applied to the content layer only, also when `scrollable`.
- `Renderer.enableScissor/disableScissor` (`:691-721`) flush pending batched text before every scissor change and notify the text renderer.

Nested clips replace rather than intersect: a child with `overflow: hidden` that is larger than its parent's clip escapes the parent's clip while it renders. `RenderContext` carries no clip rect (`RenderContext.ts:15` says "Future: scale, rotation, clipping bounds").

`ScissorBatcher.ts` (132 lines) groups `Renderable`s by scissor-rect key and renders them region by region. It has zero call sites (grep) and is listed for deletion in `DDB-14`. The "scissor batching" mentioned in the log refers to text flushing on scissor change, not to this class.

### Text path

- `FontAtlas.ts`: one face, created as `new FontAtlas(this.gl, 'Arial', 32)` (`Renderer.ts:58`). A 512 CSS-px canvas scaled by `devicePixelRatio` (`FontAtlas.ts:40-49`), `context.font = '32px Arial'`, `textBaseline = 'top'` (`:52-53`). `generateAtlas` (`:68-121`) rasterises the 95 printable ASCII characters (`:75`) left to right with `padding = 1` and a uniform row height of `ceil(32 * 1.2) = 39` px (`:79-80`); glyph metrics are `advance = measureText(char).width`, `offsetX = offsetY = 0` (`:109-111`); no kerning, no bearings, no fallback glyphs. Uploaded RGBA, `LINEAR` min/mag, no mipmaps (`:131-144`). `lineHeight = fontSize * 1.2` (`:60`); the real-metrics `measureText('Mg')` line is commented out (`:59`). `measureText(text)` (`:181-193`) sums advances of known glyphs and silently skips unknown ones.
- `Renderer.drawText` (`:361-410`) scales by `fontSize / 32` (`:381`), measures for `align`/`baseline` (`:384` and following), then hands off to `TextRenderer`. The `TextRenderer` is created lazily on the first `drawText` (`:377`), after `Game.render` has already called `beginTextBatch()` on a null renderer (`:765-770`), so the very first frame renders text in immediate mode.
- `TextRenderer.ts`: batch mode accumulates `{text, x, y, color, fontSize}` entries in a `Map<colorKey, TextEntry[]>` (`:36`, `:147-157`). `flush` (`:418-518`) binds the atlas, then per colour group builds the quad vertices (`buildVertexBufferForColor`, `:329-409`, 4 verts x 4 floats per glyph), uploads with `bufferSubData`, and issues one `drawElements` per colour. Capacity 10000 glyphs (`:53`). The vertex buffer is re-allocated with `bufferData(..., maxCharacters*16*4)` (640 KB) on every flush (`:456`), and there are several flushes per frame (one per scissor change plus the final one). Immediate mode (`drawTextImmediate`, `:167-235`; `drawQuad`, `:241-321`) creates and deletes two GL buffers per glyph (`:276-280`, `:319-320`).
- Glyph scaling: a 32 px bitmap stretched to 48/64 px titles (`MainMenuScreen.ts:48`, `SplashScreen.ts:55`) or shrunk to 8-10 px labels (`Card.ts:169`, `:182`, `DriverStatsDisplay.ts:99`, `ResourceBarLayer.ts:157`) with bilinear filtering and no mipmaps. `fontFamily` and `fontWeight` are parsed by `Text` (`Text.ts:48-53`) and never used; `DeveloperOverlay` asks for `monospace` (`DeveloperOverlay.ts:47`) and gets Arial.
- Non-ASCII glyphs used by game code render as nothing and measure as zero width: `⛡` (`ui/Vehicle.ts:246`), `⚙` (`ResourceBarLayer.ts:91`), `⛽` (`DriverStatsDisplay.ts:206`), `🛡`/`🔧` (`EnemyBattlefieldLayer.ts:123-125`), `←` (`DriverSelectionScreen.ts:147`).
- Text always paints after shapes within its scissor scope (see section 2); text of different colours paints in first-seen-colour order (`TextRenderer.ts:477`).
- `pendingFlush`/`hasPendingFlush`/`clearPendingFlush` (`TextRenderer.ts:40`, `:540-548`, `:555-572`) are set but never consulted; the eager flush in `Renderer.enableScissor` made them dead.

### Textures

`Texture.ts` loads images with mipmaps (`:42-74`) and has zero call sites; `AssetLoader` (`Assets.ts`) likewise. Both are on the dead-code list (`DDB-14`). The only texture in use is the font atlas.

---

## 2. Draw order today

### How order is determined

Depth-first tree order, full stop. `Layer.children` is an array; `addChild` pushes (`Layer.ts:227-231`); `render` iterates children in array order (`:429-433`). `Style.zIndex` is declared (`Style.ts:40`) and read nowhere. There is no sort, no bring-to-front, no insertion index. The only ordering tools are the order of `addChild` calls and remove-then-re-add, which `PlayerHandLayer.layoutCardElements` does explicitly ("Add divider first so it appears behind cards", `PlayerHandLayer.ts:406-439`, labels re-added last at `:449-459`, `:469-479`).

Panels insert an implicit background `Rectangle` and a `ScrollableContentLayer` (`Panel.ts:129-151`); `panel.addChild` redirects to the content layer (`:178-181`) and `panel.getChildren()` returns content children only (`:194-196`), so the background is invisible to callers.

### Text is reordered by batching

Because shapes draw immediately and text is queued until the next scissor change or end of frame, text always ends up on top of every shape drawn in the same scissor scope, regardless of tree order. Consequences:

- A rectangle that follows a text node in the tree cannot cover that text. `Card.ts` draws the name at `(12, 20)` (`:104-116`) and then the driver badge rectangle at `(10, 10)` 25x25 (`:191-203`) plus its `D1`/`D2` label (`:205-215`); at flush time the title's first glyphs and the badge label both paint over the badge. This is the mechanism behind `DDB-28` ("card titles render doubled", e.g. `RaRamming Speed2`, `Nit` over `Nitro Boost`): static reading finds exactly one draw per title, so the visible "truncated copy" is the title glyphs that fall inside the badge square. The overlay's `Text: N chars` counter (F5) would confirm or refute a genuine second draw.
- `DriverPanel`'s deck preview: the cycle `Button` is added after the deck container (`DriverPanel.ts:258`, `:273`), so its rectangle covers overflowing mini cards, but the mini cards' name/cost text flushes later and paints through the button (`DDB-31`, "cards render through/behind the cycle button"). The deck container is a plain `Layer` with no `overflow` (`:252-257`), so nothing clips it; rows are 80 px apart from `y = 40` (`:361-365`) inside a container of `panelHeight - portraitHeight - 220` px, which at 882 px tall is about 97 px, room for one row of a four-entry deck.

### Transparency

Alpha blending with straight alpha in tree order. Transparent fills still cost a full quad (Panels with `backgroundColor: 'transparent'` draw an invisible quad plus a visible 1 px `#4d4d4d` border, because `Panel.ts:135-137` defaults `borderColor` and `borderWidth: 1` independently of the fill). No group opacity; `SplashScreen` fades are commented out waiting for it (`SplashScreen.ts:111-127`, `DDB-41`).

### Shadows

None. `AI_DEVELOPMENT_LOG.md:777-778` claims "gradient rendering" and "borders and shadows" were added; a grep for `gradient|shadow` across `src/` returns nothing.

### Nesting and overlays

`Screen.rootLayer` (a `Layer` sized to the window, `Screen.ts:24-29`) -> game layers -> `Panel`s -> components. The single "above everything" element is `DeveloperOverlay`, rendered by `Game.render` after the screen (`Game.ts:118-121`). There is no popup, modal, tooltip, or toast layer; the card detail popup is a TODO (`CombatScreen.ts:536`). `SynergyPreviewPanel` and `CombatLogLayer` are ordinary late siblings in `rootLayer`.

### Concrete ordering and layout bugs visible in the code

1. `DDB-28` title overprint, mechanism above (`Card.ts:104-116` vs `:191-215`, plus text-after-shapes batching).
2. `DDB-30` Turn/phase overlap: `TurnPhaseDisplay` is 200x40 (`CombatScreen.ts:505-510`) with three top-baseline text rows at `y = 10` (16 px), `20` (20 px) and `30` (14 px) (`TurnPhaseDisplay.ts:127`, `:140`, `:153`). Pure geometry; not a measurement bug as `DDB-30` guesses.
3. `DDB-30` main-menu title off-centre: `MainMenuScreen.ts:46-52` creates the title without `textAlign`, then positions it at `centerX` (`:174`); left-aligned text starting at the centre. `SplashScreen.ts:53-59`/`:88` has the same defect.
4. `DDB-29` hand overflow: cards are a fixed 150x210 (`Card.ts:22`) at `cardY = 25` (`PlayerHandLayer.ts:404`) inside a layer that is 18% of the viewport (`CombatScreen.ts:494`); at 882 px tall the layer is 158 px, so 77 px of every card is scissored (`PlayerHandLayer.ts:45`), and with 10 cards the row is `10*150 + 9*10 + 20 = 1610` px wide, cut at both edges of a 1440 px window. The bands sum to 88% (7+23+40+18), leaving the 12% "black band" below the hand.
5. `CombatScreen` has two different layouts: construction (`:455-527`, resource bar on top at 7%, enemy 23%, battlefield 40%, hand 18%, log 240 px wide) and `onResized` (`:842-890`, enemy 25% at top, battlefield 40%, hand 20%, resource bar at the bottom at 5%, turn display moved to `(10,10)`, log 300 px wide). Any window resize during combat rearranges the screen.
6. Card hover "lift" is implemented by mutating `y` with a `% 10` heuristic (`Card.ts:358-378`); with `cardY = 25` the first `enabled` toggle after layout nudges every card down 5 px.
7. Hit testing ignores draw order: stacked vehicles overlap by 40 px (`BattlefieldLayer.ts:161-167`) and every one under the cursor receives the click (`InputSystem.ts:164-175`).
8. `DeveloperOverlay.updatePosition` runs once in the constructor (`DeveloperOverlay.ts:53`); after a resize the overlay stays at the old right edge. Its 7 lines of 14 px text need ~118 px but the background is 100 px tall (`:20-21`, `:105-113`).
9. `borderRadius` is a no-op everywhere (`Rectangle.ts:41-43`, `:119-127`); the gallery's "Circle (using borderRadius)" (`RectangleExamplesSection.ts:95-105`), card driver badges, and every Panel corner are square.
10. Circle/triangle/polygon strokes use `gl.lineWidth` (`Renderer.ts:498`, `:574`, `:646`); most WebGL implementations clamp line width to 1, so `borderWidth: 3` on shapes draws 1 px.
11. `Rectangle.setBackgroundColor` (inherited from `Layer`) is a visual no-op because `Rectangle.render` never calls `Layer.render`; the gallery's colour input does nothing (`InteractiveControlsSection.ts:77`, `:127`).
12. `CardShowcaseScreen.onRender` calls `this.rootLayer.render()` (`CardShowcaseScreen.ts:300-302`) after `Screen.render` already did (`Screen.ts:170-173`): the whole showcase is drawn twice per frame.

---

## 3. Object model today

### Hierarchy

- `Layer` (`Layer.ts:22`): the base node. Public `x, y, width, height`; protected `visible`, `children: Layer[]`, `parent`, `componentType`; private `backgroundColor`, `overflow`. Constructor takes `LayerOptions { x, y, width, height, visible, style, overflow }` (`:8-16`); `applyStyle` reads only `visibility`/`display` (`:66-74`).
- `Component` (`Component.ts:13`) `extends Layer implements Interactive`: `hovered/focused/enabled` flags with `setHovered/setFocused/setEnabled` and protected hooks `onHover/onUnhover/onFocus/onBlur/onEnabled/onDisabled` (`:38-135`); semantic hooks `onSelect/onDeselect/onActivate/onTarget/onUntarget/onCancel` with public triggers `select()/deselect()/activate()/target()/untarget()/cancel()` (`:145-239`) that nothing in the engine calls; `abstract render(context?)`; `unmount` unregisters from `InputSystem` (`:244-250`).
- Leaf components: `Rectangle`, `Circle`, `Text`, `Triangle`, `Polygon`, `Arrow` (unused, 0 constructions) all extend `Component`.
- `Panel` (`Panel.ts:98`) `extends Layer implements Interactive` (not `Component`); `Button` and `Input` extend `Component`.
- Game UI: `ui/Card` (`Card.ts:29`) and `ui/Vehicle` (`Vehicle.ts:12`) extend `Layer` directly, register with `InputSystem` themselves, and re-implement their own `enabled/hovered/selected` state and `onSelect/onEnabled` hooks rather than extending `Component`.

`docs/AI_TECHNICAL_DECISIONS/COMPONENT_ARCHITECTURE.md:37` says `Component` "implements Interactive interface (onMouseDown, onWheel, etc.)"; the actual `Interactive` interface is `containsPoint(x, y)` plus optional `onWheel` (`InputSystem.ts:9-12`).

### Lifecycle

- Construction builds the whole subtree (every screen constructs its UI in the constructor; only `CardShowcaseScreen` defers card loading to `onMount`, `CardShowcaseScreen.ts:260-267`). `CLAUDE.md` says "do not create UI in constructors; build it in `onMount()`" and `DDB-27` flags `BattleResultScreen` for it, but `MainMenu`, `Splash`, `Developer`, `DriverSelection`, and `Combat` all do the same. Harmless today because `ScreenManager.navigate` constructs and mounts back to back (`ScreenManager.ts:99-103`).
- `update(dt)` walks the tree (`Layer.ts:327-332`); only `Input` uses it (caret blink, `Input.ts:379-391`).
- `layout()` walks the tree (`Layer.ts:338-343`); implemented by `Text` (estimated self-sizing, `Text.ts:202-221`) and `Panel` (background/content sizing, `Panel.ts:271-287`); called only by `DeveloperScreen.onResized` and `CardShowcaseScreen.onResized`.
- `render(context?)` walks the tree; every leaf computes `screenX = ctx.offsetX + this.x` and calls the renderer singleton (`RendererContext.getInstance().getRenderer()`, 9 engine call sites: `Layer.ts:390,397`, `Rectangle.ts:116`, `Circle.ts:106`, `Text.ts:234`, `Triangle.ts:88`, `Polygon.ts:157`, `Panel.ts:321`, `Input.ts:231`). `Card.render` and `Arrow.render` bypass their class chain with `Layer.prototype.render.call(this, context)` (`Card.ts:465`, `Arrow.ts:225`).
- `unmount()` walks the tree (`Layer.ts:350-355`); `Screen.unmount` calls `rootLayer.unmount()` (`Screen.ts:81`). `removeChild` does not unmount, so rebuild-on-resize code that removes children without unmounting leaks `InputSystem` registrations (`DriverSelectionScreen.ts:306-332`, `DriverPanel.clearPanelContents` `:150-158`): the old buttons stay clickable at their old positions until the screen unmounts.
- No mount hook on `Layer`; `Screen` has `mount/unmount/onMount/onUnmount/onUpdate/onRender/onResized` (`Screen.ts:45-182`), with sync-or-async `onMount` handling (`:53-63`).

### Coordinates

Local to the parent. `RenderContext` is `{ offsetX, offsetY }` only (`RenderContext.ts:4-16`). Scroll is applied by `Panel.render` as a context offset (`Panel.ts:315-318`). World position is recomputed every frame per node; hit testing recomputes it per query by walking the parent chain recursively (`Layer.ts:257-321`; `ScrollableContentLayer.globalToLocal` adds the scroll offset, `Panel.ts:21-31`). No scale, rotation, or opacity in the context.

### Dirty flags and invalidation

None. Everything re-renders and re-batches every frame; there is no retained geometry, no per-node cache, no "needs layout" flag. Setters mutate fields directly (`Layer.ts:97-167`); `setSize` fires `onResized` when the size changes (`:138-150`); `Text.setText` re-wraps immediately (`Text.ts:78-82`).

### Visibility and opacity

`visible` boolean checked by the node itself and by the parent loop (`Layer.ts:378`, `:430`). `Arrow` overrides `isVisible()` (`Arrow.ts:205-210`). `DeveloperOverlay` keeps a separate `overlayVisible` flag. No opacity: `Style.opacity` (`Style.ts:29`) is never read; per-shape alpha comes only from the colour's alpha channel; no group opacity (`COORDINATE_SYSTEM.md:310` and `COORDINATE_SYSTEM_ARCHITECTURE.md:96` list it as future work; `DDB-41`).

### Style typing

`Style` (`Style.ts:5-41`) is CSS-flavoured: `backgroundColor`, `color`, `border`, `borderWidth`, `borderColor`, `borderRadius`, `fontSize`, `fontFamily`, `fontWeight`, `textAlign`, `verticalAlign`, `lineHeight`, `whiteSpace`, `textOverflow`, `display`, `visibility`, `opacity`, `transform`, `transformOrigin`, `filter`, `cursor`, `zIndex`. Colours are `string | [r,g,b,a]`; `StyleParser.parseColor` (`:52-107`) handles `#rgb/#rrggbb/#rrggbbaa`, `rgb()/rgba()`, `'transparent'`, and falls back to white. Implemented: colours, border width/colour, font size, alignment, line height, wrap/ellipsis, display/visibility. Ignored: `borderRadius`, `fontFamily`, `fontWeight`, `opacity`, `transform*`, `filter`, `cursor`, `zIndex`, and the style keyword in `border` shorthand (`Rectangle.parseBorderShorthand` takes width and colour only, `:54-63`). Styles are applied once in constructors; there is no `setStyle`, no restyle, no cascade; runtime changes go through `setFillColor` and friends. `Button` and `Input` ignore `options.style` entirely (see section 5).

### Constructor and accessor conventions

Engine constructors are positional-first: `new Text(text, options)`, `new Button(label, options)`, `new Input(placeholder, options)`, `new Shader(gl, vs, fs)`, `new Renderer(canvasId, perf)`, `new FontAtlas(gl, family, size, atlas)`, `new TextRenderer(gl, atlas, perf, max)`; developer sections are `(x, y, width)`. `Card` and `Vehicle` use a single named-params object (`Card.ts:53-59`, `Vehicle.ts:36-44`), as `CLAUDE.md` asks. Accessors: the engine is `getX()/setX()` throughout (`Layer.ts:97-202`, about 12 pairs on `Layer` alone; the board counts ~170 across the codebase, `DDB-24`); `CLAUDE.md` wants ES6 `get foo()`. Existing accessor-style examples to match: `Card.enabled`/`driver`, `Vehicle.data`/`hovered`/`vehicleId`, `TurnPhaseDisplay.turn`/`phase`/`activeDriver`, `ResourceBarLayer.resources`, `Model.id`.

---

## 4. Input today

### Event flow

`InputSystem` is a singleton (`InputSystem.ts:17-63`) set up once from `index.ts:44-45` with the canvas. `setup` (`:69-89`) attaches `mousemove/mousedown/mouseup/wheel/mouseleave` on the canvas and `keydown/keyup` on `window`. `unmount` (`:94-121`) removes listeners using fresh `.bind(this)` references, so the removals are no-ops and the handler maps are merely cleared; harmless in production (called once at shutdown), but repeated `setup` in tests stacks listeners.

Registration is static and per-component: `registerMouseOver/Out/Down/Up/Wheel/KeyDown/KeyUp(component, handler)` store one handler per component per event in `Map<Interactive, Handler>` (`:361-405`); `registerGlobalKeyDown/Up(key, handler)` keyed by `event.key` (`:410-433`); `setFocus/getFocus` (`:438-451`); `unregisterComponent` (`:464-479`). Handlers receive no event object or coordinates (`MouseHandler = () => void`, `:2`; wheel handlers get deltas; key handlers get `event.key`).

### Hit testing order

- Every `mousemove` runs `processMouseOverOut` (`:308-356`): union all components that have any over/down/up handler, call `containsPoint(mouseX, mouseY)` on each (each is a recursive parent-chain walk), build the hovered set, fire over/out on the set difference.
- `mousedown`/`mouseup` (`:145-195`) fire the handler of every hovered component. No occlusion, no z-order, no capture, no propagation/`stopPropagation`, no synthetic `click` (Button synthesises click as down-then-up-while-hovered, `Button.ts:210-221`; Card fires on mouseup, `Card.ts:262-270`).
- `wheel` (`:220-252`) calls `preventDefault` and dispatches to every registered wheel component containing the point, so nested scrollables would both scroll.
- `containsPoint` ignores visibility and clipping (`Layer.ts:257-268`): hidden components and components scrolled outside a `Panel` viewport still receive input. In `DeveloperScreen`, buttons scrolled up under the title still fire when clicked where they would be.
- Mouse coordinates are CSS px relative to the canvas rect (`:129-131`), the same space as the projection.
- No touch, pointer, or gamepad input; no double-click; no drag.

### Hover and press state

`Component.hovered` is set by `Button` from its own over/out handlers (`Button.ts:179-195`); `pressed` is Button-local. `Card` and `Vehicle` keep their own hovered flags. No press-capture: a press that starts on a button and releases elsewhere never resets anything except via the out handler.

### Keyboard and focus

One `focusedComponent` (`:43`). `keydown` (`:257-279`) checks global handlers by exact `event.key` first (calls `preventDefault` when matched), then the focused component's handler. Focus is set only by `Input.onMouseDown` (`Input.ts:321`) and cleared by clicking outside (the system calls an ad-hoc `onMouseDownOutside` if the focused object has one, `InputSystem.ts:156-161`), by Enter, or by unregister. There is no focus manager: no tab order, no Tab/arrow traversal, no focus ring, no keyboard activation of buttons or cards. `CombatScreen.ts:550-555` registers an Escape handler with `registerKeyDown(this.rootLayer, ...)`, but the root layer is never focused, so Escape-to-cancel-targeting is dead code; F6 (`:558-560`) works because it is global. `Game.ts:64-90` adds a separate `document` keydown listener for F12/F5/Escape outside `InputSystem`, so there are two keyboard paths.

### `Input.ts` text field

Single line. Printable input is `key.length === 1` appended (`Input.ts:367-371`), so Ctrl+V inserts `v`; Backspace deletes one char; Enter blurs; `maxLength` 100. No caret movement, selection, Delete/Home/End/arrows, clipboard, IME/composition, or shift handling. The caret x comes from `fontAtlas.measureText(value).width` at the atlas's 32 px base size with no scaling by the field's font size (`:235-243`), so it drifts right of the text on 14-16 px fields. Blink via `update(dt)` (`:379-391`). `onChange` fires on programmatic `setValue` too (`:119-131`). `setEnabled(false)` hides the value text (`:254`).

### Tests

`InputSystem.test.ts` (jsdom pragma at `:2`) creates a canvas, a real `Rectangle` (constructible without GL because the renderer is only touched in `render`), registers `jest.fn` handlers, dispatches `MouseEvent`s at `clientX/Y` inside and outside the rect, and asserts over/down/up/out fired (`:42-94`), then verifies `unregisterComponent` (`:96-119`). No keyboard, wheel, focus, or ordering tests. There is no injection API on `InputSystem` itself; the private handlers only run from DOM events.

---

## 5. UI components today

### Button (`Button.ts`)

Children: a `Rectangle` background (`:32-43`) and a centred `Text` (`:46-60`). Palette is hard-coded private fields `normalColor '#3333cc'`, `hoverColor`, `pressedColor`, `disabledColor` (`:17-20`). API: `setLabel/getLabel`, `setTextColor`, `setFontSize`, `setSize/setPosition` (re-fit children, `:115-148`), `setEnabled` (`:154-165`), `onClick(cb)` (`:171-174`), `setFillColor/setBorderColor/setBorderWidth/setCornerRadius` pass-throughs (`:227-257`), `unmount` (`:292-298`).

Gaps: `options.style` is never read, so the `fontSize`, `backgroundColor`, `borderRadius`, `color`, `border` that every caller passes (23 constructions, e.g. `ButtonExamplesSection.ts:56-64`, `MainMenuScreen.ts:71-77` with `fontSize: 24`, `ResourceBarLayer.ts:177-184`) are ignored; all buttons render identical blue 16 px. `setFillColor` sets the background directly but `onMouseOut` resets to `normalColor` (`:189-195`), so `DriverSelectionScreen`'s green START RUN (`:286`) and `ResourceBarLayer.setEndTurnEnabled` (`:246-251`) revert to blue after one hover. No focus/keyboard activation, no icon, no toggle state, no size-to-content.

### Input (`Input.ts`)

Covered in section 4. Children: background `Rectangle`, value `Text`, placeholder `Text`, caret `Rectangle` (`:39-98`). Styling API mirrors Button's pass-throughs (`:425-455`); `options.style` is ignored here too (the gallery's "Styled Input", `InputShowcaseSection.ts:66-76`, renders like the basic one). Callbacks: `onChange`, `setOnFocus`, `setOnBlur` (`:269-290`).

### Panel (`Panel.ts`)

Options `{ scrollable, scrollDirection, style: { backgroundColor, borderColor, borderWidth, borderRadius, border } }` (`:89-92`, `:112-159`); `scrollable` forces `overflow: 'hidden'` and registers a wheel handler (`:117-123`, `:154-158`). Public: `setSize` (re-fits background/content, `:164-173`), `addChild/removeChild/getChildren` (content layer, `:178-196`), `getContentLayer`, `setScrollOffset/getScrollOffset` (`:208-221`), `scroll(dx, dy)` clamped to `contentSize - size` (`:226-244`), `setContentSize/getContentSize` (`:251-266`), `layout`, `render`, `unmount`.

Scrolling reality: wheel scrolling works where the caller sets a content size (`DeveloperScreen.ts:160`, `CardShowcaseScreen.ts:173-174` with a "rough estimate"); `CombatLogLayer`'s panel is not `scrollable`, so its `setContentSize` (`CombatLogLayer.ts:186`) is inert and `scrollToBottom` is a TODO (`:247-249`). The wheel multiplier is `deltaY * 30` (`Panel.ts:389`) with `deltaY` passed through unnormalised from the DOM (`InputSystem.ts:224-226`); in Chrome's pixel mode one notch is ~100, so a notch scrolls 3000 px. No scrollbars are drawn at all (`:369` "TODO: Render scrollbars here"); the hub's "scrollbars draw but don't scroll" (`HUB:35`, `DDB-32`) is inaccurate in both halves. The five `Interactive` methods at `:374-400` are no-ops except `onWheel`. `ScrollableContentLayer.render` (`:36-83`) does CPU culling against the viewport when scrollable. Content size is never measured from children. Nested clip is replace-not-intersect.

### DeveloperOverlay (`DeveloperOverlay.ts`)

A `Layer` with a bordered `Rectangle` and one 7-line `Text` (`:27-50`); `toggle/show/hide` (`:59-75`); `update` rebuilds the stats string every frame while visible (`:89-116`); positioned top-right once (`:80-84`). Toggled by F5 in `Game.ts:75-78`.

### game/ui/Card (`Card.ts`)

Sizes MINI 50x70, NORMAL 150x210, LARGE 240x336 (`:20-24`). Children: rarity-coloured border rect, background rect, name (`nowrap` + `ellipsis`, which never truncates because `nowrap` bypasses wrapping, `Text.ts:148`), cost, description (wrapped, height-limited ellipsis), rarity, tags, target type, optional driver badge (`:73-216`). Registers over/out/down/up itself (`:225-231`). Handlers `setOnClick/setOnSelect/setOnActivate/setOnTarget` (`:290-307`); `setSelected/isSelected`; `enabled` accessor (`:327-342`); hover/selected visuals change border width/colour and lift `y` (`:358-378`); `render` delegates to `Layer.prototype.render` (`:463-466`). `static getDimensions(size)`.

### game/ui/Vehicle (`Vehicle.ts`)

Portrait, optional driver portrait/name/HP, name, HP bar built from two `Rectangle`s (`:149-172`), armour box, status container `Layer` (`:77-218`). Registers down/over/out (`:308-336`); subscribes to `CombatModel` per-property events (`:341-364`), which work since `fc1b697` (2026-08-22; the hub's `:25` "dead listeners" note predates the fix and was verified live per `DDB-1` notes). `onResized` removes and recreates every child (`:296-303`). `data` accessor triggers `updateVisuals`.

### Cross-cutting gaps

No theming or shared palette (StyleGuideSection paints one but nothing consumes it), no runtime restyle, no disabled/focus/pressed visuals beyond Button and Card fill swaps, no tooltips, scrollbars, lists, selects, checkboxes, sliders, tabs, dialogs, toasts, menus, trees, or a reusable progress bar.

---

## 6. Layout today

There is no automatic layout. `UI_COMPONENT_API_DESIGN.md:68` records the decision: "Always absolute positioning (no layout engine complexity)". `Layer.layout()` is a recursive hook with two implementers and two callers (section 3).

How screens position things:

- Percentages of the window: combat bands (`CombatScreen.ts:459-502`), driver-selection panels 35%/60%/20% (`DriverSelectionScreen.ts:86-137`), synergy panel at 37.5% (`:131`), title at 8% (`:78`), button at 85% (`:170`).
- Hard-coded pixels: menu buttons 300x60 spaced 20 (`MainMenuScreen.ts:177-179`), cards 150x210, combat log 240x200 (`CombatScreen.ts:514-515`), result panel 600x400 (`BattleResultScreen.ts:31-32`), overlay 280x100.
- Running cursors: every developer section increments `currentY` and ends with `this.setSize(this.width, currentY + N)` (e.g. `ButtonExamplesSection.ts:37-181`); `DeveloperScreen` stacks sections the same way and sets the panel's content height from the final cursor (`:113-160`).
- Direct `window.innerWidth/innerHeight` reads: 13/14 sites in game code (`MainMenuScreen.ts:37-38`, `:170-180`, `SplashScreen.ts:33-34`, `:78-79`, `DriverSelectionScreen.ts` throughout) alongside `rootLayer.getWidth()` elsewhere.
- Resize strategies differ per screen: `MainMenu`/`Splash`/`BattleResult` re-position; `DriverSelectionScreen.onResized` removes every child and rebuilds (`:306-332`, without unmount); `CombatScreen.onResized` applies a different layout than construction (section 2, bug 5); `DeveloperScreen`/`CardShowcase` call `rootLayer.layout()` then resize the scroll panel (`DeveloperScreen.ts:175-196`); `Vehicle.onResized` rebuilds its children; `ResourceBarLayer.onResized` only resizes its background (`:275-285`) so the END TURN button does not move.
- Text sizes used for layout are estimates: `Text.layout` uses `0.6 * fontSize` per character (`Text.ts:205-210`), wrapping uses `0.5 * fontSize` (`:154`), `SynergyPreviewPanel.estimateTextHeight/Width` use `0.6 * fontSize` (`:255-268`), `DriverStatsDisplay.getRequiredWidth` is a constant formula (`:268-273`). Real atlas metrics are used only for alignment inside the renderer and for the Input caret.

---

## 7. Performance monitoring today

`PerformanceMonitor.ts`: `beginFrame` (`:29-35`) and `endFrame` (`:40-60`) are called from the rAF loop (`index.ts:85`, `:101`); frame time is the interval between consecutive `beginFrame`s (`:41-44`), kept in a 60-entry history for avg/min/max and `fps = 1000 / avg` (`:94-107`); `recordDrawCall(vertexCount)` from every primitive draw and every text colour batch (`:66-69`); `recordTextCharacters` (`:75-77`); a cumulative draw-call average (`:58-59`, `:110-112`). `getStats()` (`:82-130`) returns `fps, avgFrameTime, minFrameTime, maxFrameTime, drawCallsPerFrame, verticesPerFrame, textEfficiency, currentDrawCalls, currentVertices, currentTextCharacters`.

The F5 overlay (`DeveloperOverlay.ts:101-116`) shows FPS with a hard-coded "(Target: 60)" label (displays run at 120 Hz per `LOG:563`), avg/min/max frame time, current and average draw calls, current vertices, current text characters.

Cost: one string rebuild per frame while visible and 1 rect + 7 text lines to draw; negligible.

Gaps: no GPU timing (`EXT_disjoint_timer_query` unused), no per-phase CPU split (update vs render vs text flush), no scissor-change or buffer-upload counts, no GL object counts, no per-screen or per-layer attribution, no history graph, no export/log, no min-FPS-over-window, `textEfficiency` is stale (returns raw characters; comment at `:114-115` says "once we implement batching"), `verticesPerFrame` reports the in-progress frame while `currentVertices` reports the last one (`:124` vs `:127`), the throttled 100 ms refresh the log describes (`LOG:607-608`) no longer exists, and the overlay never re-anchors on resize.

---

## 8. Screens and game loop

### Loop

`src/index.ts:83-105`: `requestAnimationFrame` loop, variable `dt = (now - last) / 1000` seconds, no fixed step, no dt clamp (a backgrounded tab returns with a multi-second dt; `SplashScreen` will skip straight to the menu), no pause/visibility handling. Order: `perf.beginFrame` -> `game.update(dt)` -> `renderer.clear()` -> `game.render()` -> `perf.endFrame` -> rAF. `Application.init` (`:22-67`) wires `PerformanceMonitor`, `Renderer('game-canvas', perf)`, `RendererContext.setRenderer`, `InputSystem.setup(canvas)`, the single `Shader`, `renderer.useShader`, `new Game(renderer, perf)`, `await game.init()`.

`Game.render` (`Game.ts:111-132`): `beginTextBatch` -> `ScreenManager.render()` -> `developerOverlay.render()` -> `disableScissor` if still on -> `flushTextBatch` -> `endTextBatch`. `Game.update` calls `ScreenManager.update(dt)` and the overlay's `update` (`:98-106`).

### ScreenManager and Screen

`ScreenManager` is a static class (`ScreenManager.ts:33`) with a `Map<ScreenName, new (renderer) => Screen>` (`:42-50`); `navigate(name, data)` unmounts and drops the current screen, constructs a fresh one, mounts it (`:76-106`). No caching, no stack/history, no transitions, no overlays across screens. `update/render/resize` are pass-throughs (`:111-127`).

`Screen` (`Screen.ts`): `rootLayer = new Layer({ width: innerWidth, height: innerHeight })` (`:24-29`); `mount(data)` adds a window resize listener and calls `onMount` (sync or promise, `:45-64`); `unmount` removes it, calls `onUnmount`, then `rootLayer.unmount()` (`:69-82`); `update` walks the tree then `onUpdate` (`:144-152`); `render` is `rootLayer.render()` then `onRender()` (`:166-174`).

### How a screen composes layers

`CombatScreen` is the model: constructor creates a background `Rectangle` then five band layers (`ResourceBarLayer`, `EnemyBattlefieldLayer`, `PlayerBattlefieldLayer`, `PlayerHandLayer`, `TurnPhaseDisplay`, `CombatLogLayer`) as children of `rootLayer` (`:438-527`), wires callbacks (`:532-563`), and subscribes to `Battle`/`Team`/`CombatModel` events (`:150-258`, `:568-575`); every state change calls `updateUIFromBattle` (`:361-433`), which pushes data into layers that rebuild their children (`PlayerHandLayer.setHand` + `setCardDriverMap` each recreate all `Card` components, `PlayerHandLayer.ts:65-69`, `:163-169`, `:186-212`; `CombatLogLayer.handleFullUpdate` recreates every entry `Text`, `:122-134`). `Model` (`Model.ts:27-43`, `:57-79`) emits a per-property event and then `'change'` with a frozen snapshot; `EventEmitter.on` returns an unsubscribe function (`EventEmitter.ts:17-34`).

### Engine API surface the game depends on

Call-site counts in `src/renderer/game` (tests excluded), from `grep -F`:

| API | Game call sites | Notes |
|---|---|---|
| `new Text(` | 90 | plus 4 in engine |
| `new Rectangle(` | 45 | plus 5 in engine |
| `new Button(` | 23 | |
| `new Input(` | 5 | gallery only |
| `new Panel(` | 4 | DeveloperScreen, CardShowcase, CombatLogLayer, sections (via `extends Panel`, 8 classes) |
| `new Layer(` | 4 | |
| `new Circle(`/`new Triangle(`/`new Polygon(` | 3/3/4 | gallery only |
| `new Arrow(` | 0 | dead |
| `.addChild(` | 204 | plus 13 engine |
| `.removeChild(` | 16 | |
| `.setPosition(` | 141 | |
| `.setSize(` | 23 | |
| `.setText(` | 24 | |
| `.setFillColor(` | 17 | |
| `.setBorderColor(` | 10 | |
| `.setVisible(` | 10 | |
| `.setWidth(`/`.setHeight(`/`.setY(` | 7/5/3 | |
| `.setOverflow(` | 3 | hand, resource bar, battlefield base |
| `.setContentSize(` / `.setScrollOffset(` | 3 / 1 | |
| `.setBackgroundColor(` | 2 | no-op on Rectangle |
| `getChildren(` | 9 | several index into `children[0..2]` |
| `onResized` overrides | 19 | |
| `window.innerWidth` / `innerHeight` | 13 / 14 | |
| `InputSystem.register*` | 9 | Card, Vehicle, CombatScreen |
| `registerGlobalKeyDown` | 2 | |
| `InputSystem.setFocus` / `getFocus` | 1 / 1 | DeveloperScreen unmount |
| `.unmount(` | 12 | |
| `.layout(` | 2 | |
| `style:` literals | 181 | 29 carry `borderRadius` |
| direct `Renderer.draw*` calls | 0 | all drawing goes through components; `Renderer` is imported by 10 game files only as the `Screen` constructor type |

Engine modules imported by game files: `Text` 25 files, `Rectangle` 22, `Panel` 11, `Layer` 11, `Button` 10, `Renderer` 10 (type), `InputSystem` 4, `Input` 2, `Style` 1, `RenderContext` 1 (`Card.ts`), `Circle`/`Triangle`/`Polygon` 1 each, `DeveloperOverlay`/`PerformanceMonitor` 1 (`Game.ts`).

---

## 9. Tooling

- TypeScript `^5.0.4` (`package.json:61`), `tsconfig.json`: target ES2020, module commonjs, lib DOM + ES2020, `strict`, `esModuleInterop`, `skipLibCheck` (added 2026-08-22), `moduleResolution: node`, `resolveJsonModule`, `sourceMap`, `paths @/*` (declared in tsconfig, webpack, and jest; used by no file), include `src/**/*` and `electron/**/*.ts`. `jsconfig.json` duplicates it (`DDB-12`).
- Webpack `^5.84` + `webpack-cli` 5 + `webpack-dev-server` 4.15 (port 9000, static `public/`, `webpack.web.js:13-20`), `ts-loader` 9.4, `raw-loader` 4 for `/\.(glsl|vs|fs|vert|frag)$/` (`webpack.common.js:18-21`); three entries `main`, `battle-simulator`, `ai-evaluator` (`:6-10`); `HtmlWebpackPlugin` per entry; `CopyWebpackPlugin` copies `src/assets` (so the GLSL files are also shipped as files nobody fetches), `cards.json`, and two DOM-UI scripts (`:52-71`). `NODE_ENV=production` is now set by the build scripts (`package.json:9-10`, fix `0c18c26`); mode/devtool derive from it (`webpack.web.js:6-7`).
- GLSL: imported as strings via `src/types.d.ts` module declarations (`*.glsl/*.vert/*.frag`); no preprocessing, includes, or minification. Jest maps them to `src/__mocks__/glslMock.js`, which exports `''` (`jest.config.js:12`).
- Jest `^29.5` + `ts-jest` 29.1, `testEnvironment: 'node'` by default (`jest.config.js:3`); four test files opt into jsdom via `@jest-environment jsdom` docblocks (`InputSystem`, `Battle`, `CombatMechanics`, `Vehicle`); `collectCoverage: true` on every run (`:14`, `DDB-19`); `jest.setup.js` stubs `requestAnimationFrame` and defines `global.WebGLRenderingContext` as a plain object with four constants (`:6-11`), not a GL implementation. WebGL cannot be exercised in Jest: no `headless-gl`, no `webgl-mock`, no `canvas` package for jsdom 2D (FontAtlas needs one). Of nine test files, one (`InputSystem.test.ts`) touches the engine, and only its GL-free parts. 128 tests as of 2026-08-22.
- ESLint `^8.41` with `@typescript-eslint` 5.59, `plugin:@typescript-eslint/recommended` only, `root: true` (added `fc1b697`), `no-unused-vars` with `_` prefix, `no-explicit-any` warn (`.eslintrc.js`). No indent rule (two combat files are 2-space indented: `EnemyBattlefieldLayer.ts` 58 lines, `PlayerBattlefieldLayer.ts` 28 lines, `DDB-26`), no `no-console`, no Prettier. Lint walks `dist/` and `coverage/` when present (`DDB-17`).
- CI (`.github/workflows`): `ci.yml` lint+test, `web-build.yml`, `electron-build.yml` (Windows + macOS lint/test/build/package), `deploy-sftp.yml` (main -> `bearcavinteractive.com/playtest/dual-deckbuilder/`), `deploy-pr-playtest.yml` (PRs labelled `playtest`), `cleanup-pr.yml`; all on Node 18 (EOL, `DDB-16`). Local Node is 24.16.
- Build outputs: `dist/web/` (content-hashed bundles, three HTML pages, `assets/`, `cards.json`), `dist/electron/{main.js, preload.js, renderer/}` (`webpack.electron.js:11-81`, separate main/preload/renderer configs; renderer targets `web`), `release/` from electron-builder (NSIS/DMG, `package.json:67-88`).
- Electron: the hub (`:27`, `:61`) still says broken, but `641ee3e` (2026-08-22, `DDB-11` done) split the webpack config, trimmed `preload.ts` to `{ isElectron, platform }` (`electron/preload.ts:6-9`), removed the `electron-squirrel-startup` require, deleted `forge.config.js`, and included `electron/` in tsconfig; `DDB-1` notes record `electron .` booting to the main menu and CI packaging green. Open: a filed bug for packaged `file://` asset loading (mentioned in `DDB-1` notes), and Electron 25 is EOL (`DDB-22`). No commit has touched the hub or log since the survey commit `fa52018`, so the hub's "Built but broken" section (`:21-30`) is stale for the Model events, double navigation, `endCombat`, production bundles, CI injection, and Electron items, all fixed the same day (`fc1b697`, `5deb673`, `96c8cf7`, `0c18c26`, `b3878d3`, `641ee3e`).
- `gl-matrix` 3.4 is the only runtime library and sits in `devDependencies` (bundled, so it works).

---

## 10. Documentation conventions to honour

From `CLAUDE.md` and `docs/AI_DEVELOPMENT_HUB.md:76-83`:

- `docs/AI_DEVELOPMENT_HUB.md` holds current state and context only (a dated "verified survey" with Working / Built but broken / In progress-never built lists, a Specboard pointer, project overview, design-doc links, code-style pointers). No task lists; Specboard is canonical (`HUB:42-55`).
- `docs/AI_DEVELOPMENT_LOG.md`: newest entry at the top, `## Title (YYYY-MM-DD)`, then `### Subtitle`, `**What Changed:**` bullets, `**Technical Details:**` or `**How:**` bullets, optional `**Benefits:**`/`**Results:**`, entries separated by a `=========================================` line. Dates before 2025-07-02 are known to be wrong by about six months (`LOG:7`).
- `docs/AI_TECHNICAL_DECISIONS/`: one file per major decision. `README.md:22-58` gives the template (`# Title`, `## Date`, `## Context`, `## Options Considered` numbered with Pros/Cons, `## Decision`, `## Rationale`, `## Consequences`, `## Implementation Notes`) and asks for kebab-case names (`coordinate-system-design.md`, `:14-20`) with an "Index of Decisions" (`:60-62`, never filled). In practice 8 of 9 files are `SCREAMING_SNAKE_CASE.md` with a looser `Decision / Date / Context / Rationale / Architecture / Benefits / Trade-offs / Status` shape; only `screen-manager-architecture.md` (2025-07-03) follows the naming and a fuller template with Implementation Steps and Alternatives. `COORDINATE_SYSTEM.md` and `COORDINATE_SYSTEM_ARCHITECTURE.md` duplicate each other. `LOG:766` links to `scrollable-panel-architecture.md`, which does not exist. New rendering decisions should use the README template and kebab-case, and the index should finally be populated.
- Plan files (user's global rule): `.claude/plans/<description>.md` inside the project (none exist yet); prefix `# COMPLETE - YYYY-MM-DD` only after the user confirms.
- Code conventions: tabs (the `.code-workspace` sets `insertSpaces: false`; nothing enforces it); named-param constructors `new Foo({a, b})` (`DDB-23`); ES6 accessors over `getFoo/setFoo` (`DDB-24`); JSDoc on public methods; delete rather than preserve legacy code; single quotes, semicolons; engine files PascalCase class-per-file; screen directories kebab-case except `battleResult/`; tests `*.test.ts` beside the source or in `__tests__/`.
- Process: `npm test` and `npm run lint` before a PR; draft PRs by default; commit messages without AI attribution; branch names `feat/...`, `fix/...`, `chore/...`.
- Specboard: pick up and close items with the MCP tools, keep status current, file discovered work with `discovered_from`. One correction for the board: `DDB-15` says "RenderContext.ts vs RendererContext.ts: only RendererContext is imported, delete or merge the other"; in fact `RenderContext` is imported by `Layer`, `Component`, every leaf component, `Button`, `Input`, `Panel`, `DeveloperOverlay`, `Arrow`, and `Card.ts`. Deleting it would break the build.

Doc-versus-code discrepancies worth fixing in the same pass: `COMPONENT_ARCHITECTURE.md:37` (Component's interface), `:71` ("Panel can't directly receive input events"; it implements `onWheel`); `UI_COMPONENT_API_DESIGN.md:21-59` puts `width/height/left/top` inside `style` (unsupported; `LayerOptions` takes them top-level) and says hex-only colours (`StyleParser` also takes `rgb()`/tuples); `LOG:587` claims the combat log renders only visible entries and `:588` auto-scrolls (it rebuilds everything and cannot scroll); `LOG:777-778` gradients and shadows (absent); `README.md:9`, `:96-102` still describe GitHub Pages deployment (SFTP now); `CLAUDE.md`'s "build UI in `onMount()`" is followed by no screen.

---

## 11. Gap analysis against a mature layered UI renderer

| Capability | Status | Evidence |
|---|---|---|
| Batching | Partial | Text batched per colour per scissor scope (`TextRenderer.ts:418-518`); every shape is its own draw call (`Renderer.ts:270`, `:473`, `:566`, `:632`); `ScissorBatcher` unused |
| Instancing | Missing | WebGL1 context (`Renderer.ts:35`); no `ANGLE_instanced_arrays`, no VAOs |
| SDF rounded rect + border | Missing | `fragment.glsl:19-39` is a UV-space inset stroke for axis-aligned quads; `borderRadius` dropped at `Rectangle.ts:119-127` |
| Drop shadows | Missing | no code; `LOG:778` claim is false |
| Opacity / group opacity | Missing | `Style.opacity` unread; `RenderContext.ts:15`; `SplashScreen.ts:111`; `DDB-41` |
| Clipping (rect, nested, rounded) | Partial | rect scissor via `overflow: 'hidden'` (`Layer.ts:396-449`, `Panel.ts:320-367`); nested replaces instead of intersecting; no rounded clip; hit testing ignores clips |
| Stable back-to-front ordering with z-index | Missing | tree order only; `zIndex` unread; text reordered above shapes by batching, grouped by colour |
| Overlay / popup layer | Partial | `DeveloperOverlay` drawn after the screen (`Game.ts:118-121`); no popup API; `CombatScreen.ts:536` TODO |
| MSDF or SDF text | Missing | canvas-rasterised 32 px Arial bitmap atlas scaled bilinearly (`FontAtlas.ts:39-63`, `TextRenderer.ts:176-177`) |
| Text wrapping / measurement | Partial | advance-sum `measureText` (`FontAtlas.ts:181-193`) used for alignment and the caret; wrapping and self-sizing use `0.5`/`0.6 * fontSize` estimates (`Text.ts:154`, `:205`); ASCII only, one face and weight, no kerning, no letter spacing, no rich text |
| DPI / pixel snapping | Partial | backing store scaled by DPR, ortho in CSS px, scissor in device px, atlas rasterised at DPR; glyphs rounded to CSS px, shapes unsnapped |
| Automatic layout (stacks/flex) | Missing | absolute positioning by decision (`UI_COMPONENT_API_DESIGN.md:68`); `Layer.layout()` has two implementers |
| Design tokens / theming | Missing | 181 inline style literals; Button/Input palettes are private fields; `StyleGuideSection` palette is decorative |
| Focus management / tab order | Missing | one `focusedComponent` set only by `Input` clicks (`InputSystem.ts:43`, `Input.ts:321`) |
| Keyboard navigation | Missing | global hotkeys F5/F6/F12/Escape only; no Tab/arrow/Enter activation; combat Escape handler dead (`CombatScreen.ts:550`) |
| Scroll containers with real scrolling | Partial | wheel scroll with clamping where content size is set manually (`Panel.ts:226-244`); no scrollbars (`:369`), no drag/touch/keyboard scroll, 30x wheel multiplier (`:389`), no content measurement, clip-unaware hit testing |
| Tooltips | Missing | |
| Dropdown / select | Missing | `DriverPanel`'s "selector" is a Button that cycles (`DriverPanel.ts:400-405`) |
| Slider | Missing | |
| Checkbox / toggle | Missing | |
| Tabs | Missing | |
| Dialogs / modals | Missing | |
| Toasts | Missing | |
| Context menus | Missing | |
| Tree view | Missing | |
| Progress bar | Partial | hand-built from two Rectangles in `Vehicle.ts:149-172`; not a component |
| Render-tree serialisation / inspection | Missing | nodes carry only a `componentType` string; no names, ids, dump, or debug outlines |
| Layout lint | Missing | |
| GPU timers | Missing | CPU frame interval only (`PerformanceMonitor.ts:41-44`) |
| Screenshot / test harness | Missing | no headless GL in Jest (`jest.setup.js:6-11`); verification is a manual playtest click-through |
| Deterministic input injection | Partial | `InputSystem.test.ts` dispatches DOM `MouseEvent`s on the canvas; no injection API on `InputSystem` |

---

## 12. Recommendation

### Keep as-is

- `PerformanceMonitor` (extend with GPU timers, phase timers, upload/scissor counters; keep `beginFrame/endFrame/recordDrawCall/getStats`).
- `Shader` compile/link helper (add a uniform/attribute location cache; keep the `setX` names).
- `StyleParser.parseColor/parseSize` and the `Style` interface keys (extend, do not rename; 181 literals depend on them).
- `Model`/`EventEmitter`, `ScreenManager`/`Screen` lifecycle, `Game.render` as the frame entry point.
- The `Layer` tree API names: `addChild/removeChild/getChildren/setPosition/setSize/setVisible/setX/setY/setWidth/setHeight/unmount` (204/16/9/141/23/10 call sites), `LayerOptions` shape, `overflow: 'hidden'`.
- `Text`'s public API (`setText/setColor/setAlign/setBaseline/setFontSize`) and `Panel`'s options and `setContentSize/scroll/setScrollOffset`.
- The `InputSystem.register*`/`unregisterComponent`/`registerGlobalKeyDown` call signatures (Card, Vehicle, Button, Input, CombatScreen depend on them) even if the dispatcher behind them is replaced.
- The developer gallery (`DeveloperScreen` and its sections) as the visual regression bed; it already exercises every primitive, text mode, and scroll case.

### Wrap

- The renderer singleton behind a frame-scoped draw list: components stop calling `RendererContext.getInstance().getRenderer().drawX(...)` (9 engine sites, 0 game sites) and instead emit commands with a sequence key. `Renderer.drawRectangle/drawText/drawCircle/...` can survive as thin adapters during migration.
- `FontAtlas` behind a glyph-provider interface so an SDF/MSDF atlas can replace it while `measureText` and `getCharacter` keep working for the caret and alignment code.
- `Panel` internals (keep the class and options; replace clip, scroll, and content measurement).
- `Button`/`Input` (keep public methods; make them honour `options.style`, add focus and keyboard activation; expect every button on every screen to change appearance once styles apply, since the passed colours and sizes are currently ignored).

### Replace

- The per-primitive immediate draw path and `fragment.glsl`: one uber-shader (matches the "single super shader" preference in `CLAUDE.md`) with per-vertex colour/UV/params, SDF rounded rect with border and shadow, opacity, texture modes (mask vs RGBA), fed from one dynamic vertex buffer per frame with draw calls split only by texture/clip changes.
- Text ordering: draw text inside the same ordered command stream as shapes (or sort by sequence key) so a rectangle can cover text; keep colour as a vertex attribute so colour grouping is unnecessary. Fix the 640 KB `bufferData` per flush (`TextRenderer.ts:456`).
- Scissor save/restore per layer: a clip stack with rect intersection computed once per frame, no `gl.getParameter`, and the same clip rects reused by hit testing.
- `InputSystem` dispatch: top-most-first traversal of the render tree with occlusion and clip awareness, an event object carrying position and `stopPropagation`, capture on press, a focus manager with tab order and keyboard activation, wheel normalisation by `deltaMode`. Unify `Game.ts`'s document keydown listener into it.
- Shape strokes via `gl.lineWidth` (`Renderer.ts:498`, `:574`, `:646`) with geometry or SDF strokes.
- Text measurement estimates (`Text.layout`, `Text.updateWrappedText`, `SynergyPreviewPanel.estimateText*`, `DriverStatsDisplay.getRequiredWidth`, the Input caret's unscaled measure) with real metrics from the glyph provider; expect every estimated layout to shift.
- Delete: `ScissorBatcher`, `Texture`, `Arrow`, `Assets`, `helpers`, `math`, `drawLine`, the `pendingFlush` trio, `Renderer.textRenderer` lazy creation (create it in the constructor so `beginTextBatch` works on frame one). `DDB-14` already covers most of these.

### Riskiest coupling points

1. Text-above-shapes ordering. Every screen currently relies on it without knowing: badges under titles, deck previews over buttons, resource-bar labels over icons. Correct ordering will expose new occlusions the moment it lands; plan a visual pass of combat, driver selection, main menu, card showcase, and the gallery.
2. `Layer.containsPoint` + `ScrollableContentLayer.globalToLocal` + `Panel` wheel registration. Hit testing is spread across the tree walk, the content-layer override, and the registry. A central clip-aware hit tester must preserve `containsPoint(globalX, globalY)` semantics for `Card`, `Vehicle`, `Button`, `Panel`, and the Jest test, or replace all five together.
3. Screens that index implicit children: `children[0]` as background (`PlayerHandLayer.ts:357`, `ResourceBarLayer.ts:277`, `PlayerBattlefieldLayer.ts:152`, `EnemyBattlefieldLayer.ts:308`, `CombatScreen.ts:848`, `CardShowcaseScreen.ts:309`, `CombatLogLayer.ts:266-278` uses `[0..2]`, `DeveloperScreen.ts:208-214` finds its panel by `y === 80`). Any node that inserts hidden children (a Panel-style background, a clip node) breaks these.
4. `Layer.prototype.render.call(this, ctx)` in `Card.ts:465` and `Arrow.ts:225`, and `Panel.render` bypassing `Layer.render`: a tree walker that replaces `render()` must handle both.
5. Constructor-time `InputSystem` registration in `Button`, `Input`, `Card`, `Vehicle`, `Panel` plus rebuild-without-unmount in `DriverSelectionScreen.onResized` and `DriverPanel.clearPanelContents`: lifetime is the unmount chain, and there is already a handler leak on resize. A registry keyed by tree membership (or auto-unregister in `removeChild`) is safer than fixing call sites.
6. Style application: making `borderRadius`, Button/Input `style`, `fontFamily`, and `fontWeight` work changes the look of 29 rounded rectangles, 23 buttons, and 5 inputs at once.
7. Coordinate assumptions: 13/14 direct `window.innerWidth/innerHeight` reads, `Screen.rootLayer` sized from the window, `CombatScreen`'s two conflicting layouts, `DriverSelectionScreen`'s rebuild-on-resize, `DeveloperOverlay`'s one-time position. Any logical-resolution or DPI change touches all of them.
8. `CombatModel`/`Vehicle` per-property events and `Card` semantic hooks are game-side contracts that survive a renderer swap untouched; `PlayerHandLayer`/`CombatLogLayer` full rebuilds per change are a performance liability that a retained scene graph with real invalidation would remove, but they also mean those layers never mutate nodes in place, which makes them easy to port.

### What would break, and what protects it

- Breaks on any renderer change: developer gallery (all 8 sections), combat (cards, vehicles, resource bar, turn display, log), driver selection (panels, mini cards, cycle button, synergy tags), main menu and splash (titles), card showcase (double render), battle result. Every screen, in other words; there is no screen that avoids `Text`/`Rectangle`.
- Automated protection today: `InputSystem.test.ts` (2 tests: registration/hit/unregister via DOM events) and nothing else on the rendering side. The 126 mechanics/AI tests are UI-independent and stay green through any renderer change, which is useful as a canary that game logic was not touched but says nothing about pixels.
- Protection to add before the migration: jsdom-level unit tests for the pure parts (Layer coordinate math, hit-test ordering, Text wrap/measure against a fake glyph provider, Panel scroll clamping and clip intersection, sequence-key ordering of the draw list); a WebGL mock or `gl` (headless-gl) harness for the batcher's buffer layout and draw-call counts; and before/after screenshots of the five screens plus the gallery from the playtest URL, since there is no screenshot harness and `DDB-28`/`29`/`30`/`31` were all found by eye.
