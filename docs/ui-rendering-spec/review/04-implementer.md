# R4. Implementer review: layered UI rendering spec against dual-deck-builder

Read-only review of `docs/ui-rendering-spec/` (README, chapters 00 to 16) against the worktree at HEAD `49ae3c7`, branch `claude/webgl-ui-rendering-spec-bcf458`, 2026-09-07. Cross-checked against the prior engine audit (D); every audit claim relied on below was re-read in source. Nothing was executed (`node_modules` absent). Line numbers are for this HEAD; paths are relative to the worktree root.

Sizes that matter for the plan: engine 5914 lines (rendering 2223, components 1782, ui 1304, input 600), game screens 6647 lines, `Card.ts` 501, `Vehicle.ts` 443. Game code makes zero direct `Renderer.draw*` calls; every pixel goes through `Layer.render` (background), `Rectangle`, `Text`, `Circle`, `Triangle`, `Polygon`, and `Panel`'s scissor. That is the lever: the whole renderer can be swapped under six leaf classes.

## Findings

Fields: id, severity (blocker | major | minor | nit), location, claim, problem, proposed change.

### I1. blocker. R3.8 and the 3.9 hand example versus R8.13

Claim: R3.8 "Promotion resets the inherited clip and the inherited content offset, so a promoted subtree positions itself in screen space."

Problem: R8.13 says screen position is always the accumulation of parent content-box origins and content offsets, and components never compute absolute positions. The 3.9 hand example promotes a hovered card to `raised` while it stays a child of the hand container. If promotion means "position is now viewport space", the card jumps to `(x, y)` relative to the viewport on hover and back on leave, and `PlayerHandLayer` has to convert coordinates both ways. If promotion keeps tree-relative position, a select's menu inside a scroll container scrolls with its trigger (fine) but the "positions itself in screen space" clause is false and the 3.9 select example ("screen coordinates computed from the trigger's screen bounds") is the component doing the conversion by hand. The rule conflates the sort key with the coordinate space.

Proposed: Replace R3.8 with: "Promotion changes the sort key and resets the clip stack to `none` for the subtree. It does not change how position is resolved: screen position is still the accumulated tree position (R8.13), including ancestor content offsets. A component that must be placed in viewport space (menus, tooltips, drag ghosts, toasts) additionally sets `positioned: 'screen'`; its `position` is then interpreted in viewport coordinates and ancestor origins and offsets are ignored." Update 3.9 (menu is `layer: popup, positioned: 'screen'`), R9.12, R12.11, R12.22, R12.23. Add a required test: a `raised` child of an offset container draws at the same place as when it was `inherit`.

### I2. blocker. Chapter 6 (R6.2, R6.4a) and R11.8: the font asset pipeline is unspecified for this project

Claim: "Atlas generation is a build step (msdf-atlas-gen or equivalent) producing the texture and a metrics file"; three type roles.

Problem: The only font today is the browser's system Arial by name (`Renderer.ts:58` `new FontAtlas(this.gl, 'Arial', 32)`, `FontAtlas.ts:52`, `Text.ts:17`), rasterised into a 512 px canvas at runtime. Arial is a Monotype-licensed font; there is no TTF in the repo and it cannot be committed for atlas generation, and on Linux CI the browser substitutes something else anyway. The repo does hold `public/assets/fonts/OpenSans-Regular.ttf` (initial commit `128d09b`, referenced by nothing); Open Sans is SIL OFL 1.1, which permits embedding and redistribution alongside the PolyForm-Noncommercial project license, and requires shipping the OFL text. `public/` is served only by the dev server (`webpack.web.js:13-16`); production copies `src/assets` (`webpack.common.js:52-57`), so generated atlases must live under `src/assets/fonts/`. Tool choice is not free: msdf-atlas-gen is a native binary (Windows and macOS release zips, Linux from source) so it cannot be an `npm ci` step; msdf-bmfont-xml is on npm with prebuilt msdfgen for all three platforms but emits BMFont JSON (no ascender/descender fields, no `mtsdf` variant), so it does not match the field list in R6.2 without a converter.

Proposed: Add a project appendix to chapter 6, or rules R6.2a to R6.2d: (1) faces: body = Open Sans Regular (in repo), plus one OFL display face and one OFL mono face (JetBrains Mono, Roboto Mono, or similar), plus either a body bold face or a documented mapping of `fontWeight: bold` to the display role; `OFL.txt` beside each face. (2) Generator: msdf-atlas-gen `-type mtsdf -size 32 -pxrange 4 -yorigin top -charset charset.txt -json X.json -imageout X.png`, invoked by `scripts/build-fonts.(ps1|sh)`, run by hand when a face or the charset changes; outputs committed under `src/assets/fonts/`. (3) `charset.txt` committed with the R6.3 ranges. (4) The metrics schema is msdf-atlas-gen's JSON (`atlas`, `metrics`, `glyphs[]`, `kerning[]`); other generators are accepted only through a converter to that schema. State (4) in R6.2 itself so the loader has one schema to validate.

### I3. blocker. R8.2 has no component transform; Game Flow 2.2, 2.3, 4.2 need rotation and scale

Claim: R8.2 lists the properties of every component; `pushTransform` exists only at the draw API (R2.4); R4.7 and R7.9 mention rotation only to approximate clips and disable snapping; the hit-test walk (R9.4) has no inverse transform.

Problem: "Your current hand of cards fans out" (Game Flow 2.2), "the target's portrait enlarges slightly" (2.3), cards that fly to a target and to the discard pile (2.3, 2.4), shop cards that "slowly rotate" (4.2). None can be a component; only game code wrapping raw draws in `pushTransform`, which loses hit testing, snapshot bounds, and lint. `PlayerHandLayer.fanCards` (`PlayerHandLayer.ts:329-332`) is a TODO for exactly this reason.

Proposed: Add R8.2a: "`transform` (null): `{ rotation, scaleX, scaleY, pivot }`, `pivot` in content-box fractions, default (0.5, 0.5). The render walk pushes `translate(origin + pivot) · rotate · scale · translate(-pivot)` before the component's own draws and pops after its children. The hit-test walk inverts the accumulated transform before `containsPoint`. Snapshot `bounds` is the axis-aligned box of the transformed content box and the lint uses that box. Under a non-identity transform nothing snaps (R7.9) and clips use the AABB (R4.7)." Required test: a card rotated 15 degrees is hit inside the rotated box and missed at a point that is inside only the unrotated box.

### I4. major. R12.6 Icon needs a generator the spec does not name; six game glyphs have no atlas coverage

Claim: "`glyph` (name from the generated icon set) or `svg` (path)... Stroked glyphs render from generated polyline geometry with round joins; filled glyphs are tessellated once and cached."

Problem: A "generated icon set" implies an SVG-to-geometry step (path parsing, flattening, tessellation) that is not named and is not in `package.json`; it would be the second build tool after fonts. The game draws ⛽ (`DriverStatsDisplay.ts:206`), 🛡 and 🔧 (`EnemyBattlefieldLayer.ts:123,125`), ⚙ (`ResourceBarLayer.ts:91`), ⛡ (`Vehicle.ts:246`), and ← (`DriverSelectionScreen.ts:147`); the 95-glyph ASCII atlas (`FontAtlas.ts:75`) renders them as nothing and measures them as zero. Under R6.3 they become `?` the day MSDF lands. The Game Flow spec needs at least crosshair, shield, wrench, exclamation, lightning bolt, deck, discard pile, jerrycan, gear, skull, lock, question mark, and arrows.

Proposed: Make the baseline `Icon` an MSDF glyph from an icon atlas built by the same msdf-atlas-gen pipeline from an OFL or MIT icon font (Tabler Icons and Lucide both ship static fonts), addressed by name through a generated `icons.ts` (`name -> code point`) and drawn in `text` mode with `size` and `tint`. R5.17 already allows "render icons as SDF/MSDF atlases instead"; make that the required path and keep polyline and tessellated icons as MAY. State that R6.3's arrows and geometric shapes come from the icon atlas, not the text faces.

### I5. major. Text-above-shapes ordering that screens silently rely on

Claim: R2.2 and R6.18 retire the separate text batch; text sorts in submission order with shapes.

Problem: Today every `Text` paints after every shape in the same scissor scope: `Renderer.enableScissor`/`disableScissor` flush pending text (`Renderer.ts:691-721`) and `Game.render` flushes at the end (`Game.ts:130`). Exact breakage when tree order lands:

- `Card.ts:104-116` name at (12, 20), then `:191-203` driver badge at (10, 10) 25x25, then `:205-215` "D1". Today the title paints over the badge (DDB-28's "doubled title"). With tree order the badge covers the first ~23 px of the name. This needs a layout fix (name x past the badge, or the badge in the cost corner), not only the renderer.
- `DriverPanel.ts:252-258` deck container (no clip) with rows 80 px apart (`:361-365`) in about 97 px of height at 882 px tall; the cycle `Button` (`:261-273`) is added after it. Today mini-card text bleeds through the button (DDB-31); afterwards the overflow hides behind the button, still wrong. Needs a `ScrollContainer` or hug sizing.
- `DeveloperScreen.ts:50-56` title (48 px, top baseline at y 30, cell extends to about y 88) then `:99-111` the scroll panel at y 80 with an opaque `#262626` background: the panel covers up to 8 px of the title's descender area.
- `Game.ts:115-131`: the developer overlay's background draws after the screen's shapes but before the screen's text flush, so screen text (combat log title, card names) paints over the overlay today; afterwards the overlay covers them. Correct, but a visible change.
- `CardShowcaseScreen.ts:300-302` renders `rootLayer` a second time in `onRender`; once the snapshot and lint exist that doubles every node (and every draw).

Everything else was checked and is in safe order: `ResourceBarLayer`, `DriverStatsDisplay`, `TurnPhaseDisplay`, `Vehicle` and `EnemyVehicle`, `CombatLogLayer`, `PlayerHandLayer` (labels above cards vertically), `Button`, `Input`, `Panel`, `MainMenu`, `Splash`, `BattleResult`, `DriverSelectionScreen` (the synergy panel overlaps the driver panels by 0.025 W on each side and is added after them).

Proposed: Add a migration note (chapter 14.5 or README step 2) listing known reorder sites and requiring a before/after screenshot pass of every screen. Fix `Card.ts`, `DriverPanel.ts`, `DeveloperScreen.ts`, `CardShowcaseScreen.ts` in the PR that lands the batcher (see First three PRs).

### I6. major. `getChildren()[n]` and `children[n]` indexing in game code

Claim: R3.13 and R8.6 keep the children list in insertion order; R8.8 lets widgets build visuals from child shapes or draw in `render()`.

Problem: Ten sites index implicit positions: `CardShowcaseScreen.ts:309`, `CombatLogLayer.ts:266,272,278` (`[0]`, `[1]`, `[2]`), `CombatScreen.ts:848`, `EnemyBattlefieldLayer.ts:308`, `PlayerBattlefieldLayer.ts:152`, `PlayerHandLayer.ts:357`, `ResourceBarLayer.ts:277,293`, `Vehicle.ts:299`; `DeveloperScreen.ts:208-214` finds its scroll panel by `child.getY() === 80`. They survive the spec only if containers never insert implicit children. Today `Panel` inserts a background `Rectangle` and a content `Layer` and redirects `addChild`/`removeChild`/`getChildren` to the content layer (`Panel.ts:129-151, 178-196`); a `Panel`-style base for the new containers would break all ten and make `getChildren()` lie about the tree the snapshot reports.

Proposed: Tighten R8.8 for library containers: "Library components MUST draw their own visuals in `render()` and MUST NOT insert implicit children; `children` contains exactly what the caller added, in insertion order; `getChildren()` never returns the render-order view." Game cleanup: replace the indices with named fields (all are locals that could be fields) in the PR that touches each file.

### I7. major. `Layer.prototype.render.call` and containers that recurse into children themselves

Claim: R3.11 "a component emits its own draws, then visits its visible children in local order"; R1.5 the framework walks the tree once.

Problem: `Card.ts:465` and `Arrow.ts:225` call `Layer.prototype.render.call(this, context)` to skip their class chain; `Panel.render` (`Panel.ts:293-370`) and every leaf recurse into children themselves (`Rectangle.ts:136-140`, `Text.ts:273-277`, `Circle.ts:129-133`, `Polygon.ts:178-182`, `Triangle.ts:108-112`, `Button.ts:281-285`, `Input.ts:414-418`, `Layer.ts:429-433`, `ScrollableContentLayer` with its own culling at `Panel.ts:36-83`). If `render()` keeps owning recursion, the framework cannot sort siblings by `zIndex`, push layers on promotion, apply effective opacity, or skip invisible subtrees uniformly.

Proposed: Add to R8.1: "`render()` emits the component's own draws only. The framework visits children in local order; a component MUST NOT render its children." `Card.render` becomes unnecessary, `Arrow` (zero constructions) is deleted, and the leaf recursion goes with the tree PR.

### I8. major. Constructor-time input registration, rebuild without unmount, double unmount

Claim: R8.14 no registration in constructors; R8.15 mount and unmount with a context; R8.7 `removeChild` unmounts.

Problem: Registrations in constructors: `Button.ts:63-76`, `Input.ts:101-113`, `Card.ts:219-231`, `Vehicle.ts:52,308-336`, `Panel.ts:154-158` (wheel). Removal without unmount: `DriverSelectionScreen.ts:308-309` (the whole tree on every resize, then rebuilt at `:311-316`), `DriverPanel.ts:150-158` and `:319-326` (mini `Card`s with live registrations), `BattlefieldLayer.ts:85-92` (`Vehicle`s), `Vehicle.ts:296-303` (its own children on resize), `ResourceBarLayer.ts:290-302`. Unmount then remove: `PlayerHandLayer.ts:174-181`, `CardShowcaseScreen.ts:272-282`. The spec's rules fix these structurally, but two details are unstated and both matter here: whether `unmount()` is idempotent (the hand layer will double-unmount), and whether `addChild` on an already-mounted parent mounts the child immediately (every screen builds its tree in the constructor and is mounted afterwards by `ScreenManager.navigate`, `ScreenManager.ts:99-103`; `PlayerHandLayer.setHand` adds cards while mounted).

Proposed: Add to R8.15: "`unmount()` on an unmounted subtree is a no-op. `addChild` on a mounted parent mounts the child at once with the parent's context; `removeChild` unmounts it. Building a subtree before it is mounted is the normal case." Add both as required tests in 8.9.

### I9. major. Window-size reads

Claim: R7.11 and R8.13: one viewport owner; components never read the window.

Problem: 29 lines in six files read `window.innerWidth`/`innerHeight`: `Renderer.ts:118-119` (canvas sized from the window, not from its own client box), `DeveloperOverlay.ts:82`, `Screen.ts:27-28,109` (the root of every screen), `DriverSelectionScreen.ts:55-56,77-78,87-88,124-125,143-144,271-272`, `MainMenuScreen.ts:37-38,170-171,180,202-203`, `SplashScreen.ts:33-34,78-79`. Four screens already use `rootLayer.getWidth()`, so the root is the natural source.

Proposed: No spec change. Migration: the shell (`index.ts`) owns canvas size and `dpr` (R15.4 `ResizeObserver`), the mount context carries `viewport`, `Screen` sizes its root from it, `Renderer.resize`'s window listener goes, and the three offending screens switch to `rootLayer` size. Lands with the tree PR.

### I10. major. Two combat layouts

Claim: R7.12 and R10.15: one layout path for first layout and resize.

Problem: `CombatScreen.ts:455-527` builds resource bar 7% at the top, enemy 23%, battlefield 40%, hand 18%, log 240 wide at `y = resource + 10`; `:842-890` re-lays out as enemy 25% at the top, battlefield 40%, hand 20%, resource 5% at the bottom, turn display at (10, 10), log 300 wide at y 10. The first resize rearranges the screen. Game Flow 2.2 specifies enemy 25, battlefield 40, hand 20, resource bar 5 at the bottom, so the resize branch is the intended layout and the constructor is the outlier.

Proposed: Migration: one `layoutCombat()` expressed as a full-viewport vertical `Stack` with fill weights 25/40/20/5 (R10.3), with the turn display and combat log as `positioned: 'absolute'` children (R10.16); the layout engine re-runs it on resize. Add it as the worked example in 10.5, since it is the case the rule was written for.

### I11. major. Button and Input ignore `options.style`; per-instance colour hacks

Claim: R11.14 "A style property that is accepted MUST be rendered"; R11.15 overrides layer on the variant table.

Problem: `Button.ts:27-64` and `Input.ts:34-102` never read `options.style`. 23 `new Button(` sites pass `fontSize` 12 to 24, `backgroundColor`, `borderRadius`, `color`, `border` (`ButtonExamplesSection.ts:56-178`, `MainMenuScreen.ts:71-77`, `ResourceBarLayer.ts:177-184`, `CardShowcaseScreen.ts:53-62`, `BattleResultScreen.ts:102-112`, `DriverPanel.ts:261-267`); all render as identical 16 px blue. `Button.setFillColor` is undone by `onMouseOut` (`Button.ts:189-195`), and `DriverSelectionScreen.ts:173,286` and `ResourceBarLayer.ts:249` use it to colour START RUN and END TURN. When the spec's Button lands, every button changes appearance at once and the colour hacks stop working. R11.15 does not say how an override interacts with state: does `backgroundColor: '#4a8a4a'` replace only the `normal` fill with the hover wash and pressed nudge still applied?

Proposed: Add to R11.15: "A per-instance style override replaces the corresponding cell of the `normal` row; the state rules (hover wash, pressed nudge, disabled text, focus ring) still apply relative to the overridden value." Migration: START RUN becomes `variant: 'primary'` toggled with `disabled`, END TURN `variant: 'primary'`, gallery buttons keep their overrides as the visual test of the rule.

### I12. major. `borderRadius` works for the first time at 35 sites; rounded clip

Claim: R5.5 SDF rounded rect with radius clamp; R4.14 rounded clip is recommended only.

Problem: `Rectangle.ts:41-43` parses the radius and `:119-127` drops it; `Renderer.drawRectangle` has no radius parameter. Sites that change: `Panel.ts:138` defaults every panel to 5 px (including the eight transparent gallery sections, which already draw a 1 px `#4d4d4d` border from `Panel.ts:135-137`), `Button.ts:40` 5 px, `Input.ts:48` 3 px, `Card.ts:80,94` 8 and 6, badges that become discs (`Card.ts:198` 12.5 on 25 px, `EnemyBattlefieldLayer.ts:43` 15 on 30, `Vehicle.ts:106` 10 on 20), `SplashScreen.ts:47` 20, `TurnPhaseDisplay.ts:112` 8, `ResourceBarLayer.ts:127`, `DriverStatsDisplay.ts:91`, `SynergyPreviewPanel.ts:194` pills, gallery 15/8/20/40/30/10. All intended. One real defect: a `Panel` or `ScrollContainer` with a rounded background and a rectangular content clip shows scrolled content in the corner area.

Proposed: Promote R4.14 to required for `Panel` and `ScrollContainer` when the background radius is non-zero, or state in R12.19/R12.20 that content is inset by the radius. Use the gallery sections as the visual check.

### I13. major. Shape strokes and anti-aliasing change under `antialias: false`

Claim: R5.6 no MSAA; R5.15 SDF circles; R5.16 lines are quads; R5.17 flat polygons are not anti-aliased by the shader.

Problem: `Renderer.ts:498,574,646` stroke circles, triangles, and polygons with `gl.lineWidth` (clamped to 1 on most WebGL implementations), and the context uses the default `antialias: true` (`Renderer.ts:35`), so polygon edges are MSAA'd today. After the port, circle borders become real 2 to 3 px SDF borders (`PrimitiveShapesSection.ts:62-83`) but triangles, pentagon, hexagon, star, and diamond (`:100-213`) lose MSAA unless the CPU feather exists. `Arrow`'s line-as-polygon path (`Arrow.ts:159-171`) is dead code and the targeting line becomes `drawLine`.

Proposed: Make the one-pixel CPU feather (R5.17 MAY) a SHOULD for the `Polygon`/`Triangle` components, or accept the visual change and say so in the gallery golden for chapter 5.

### I14. major. Canvas atlas to MSDF: measurement estimates and the bold weight

Claim: R6.8 shared iteration; R10.14 measure with render metrics; R11.8 three roles.

Problem: `FontAtlas.ts:41-49` needs `document.createElement('canvas').getContext('2d')`, null in jsdom without the `canvas` package (not installed), so nothing text-related is unit-testable today; MSDF metrics as JSON fix that. Every estimated layout moves when real metrics land: `Text.ts:154` (0.5 em per character for wrapping), `:205-210` (0.6 em self-sizing), `SynergyPreviewPanel.ts:255-268`, `DriverStatsDisplay.ts:268-273`, `Input.ts:235-243` (caret measured at the 32 px base size, unscaled). `fontWeight: 'bold'` appears at about 20 sites and is never read (`Text.ts:47-72` reads size, family, colour, align, vertical align, line height, white space, overflow); the spec has roles, not weights, so those sites need a rule.

Proposed: Add to R11.8 or R12.4: "`fontWeight: 'bold'` on `body` text resolves to the body bold face when one is loaded, else to the `display` role; the resolution is a theme table, not per component." List the four estimate sites in the migration notes as expected reflow. Measurement cache keys (R6.12) must include the role.

### I15. major. Jest fit for the null and recording backends and the lint

Claim: R14.1 and R14.2 "MUST run in the project's ordinary test runner and CI."

Problem: Jest 29 + ts-jest with `testEnvironment: 'node'` (`jest.config.js:3`) runs pure TypeScript; the null and recording backends, batcher sort, clip stack, layout, text layout over the committed metrics JSON (`resolveJsonModule` is on), token resolution, snapshot, and lint all fit with no WebGL mock. Conditions: no `window` or `document` at module scope or in constructors (today `Layer.render` reads `window.devicePixelRatio` at `Layer.ts:410`, `Panel.ts:335`, and `FontAtlas` touches `document`), tests build a `MountContext` with a fixed viewport and clock, timing tests drive `update(dt)` (R14.3) rather than fake timers. Housekeeping: `jest.setup.js:6-11` stubs `WebGLRenderingContext` as four constants and should go when nothing references it; `collectCoverage: true` on every run (`jest.config.js:14`) slows the suite and belongs in `test:coverage`. The chapter 13 mapping table names "vitest `bench` (tinybench)" for micro-benchmarks; Jest has no bench runner and the project is on Jest.

Proposed: Add to R14.1: "Engine modules MUST be importable and constructible without a DOM." Change 13.11's browser column to "tinybench via `scripts/bench.mjs`, files `*.bench.ts` outside the test runner's match pattern", which fits both runners.

### I16. major. Playwright, SwiftShader, and the Electron version

Claim: R15.33 flags; R15.36 Playwright; R14.5 goldens per backend; 13.11 uses `long-animation-frame` and the six-argument `console.timeStamp`.

Problem: Playwright is not a dependency (no `playwright` in `package-lock.json`). Needed: `@playwright/test`, `playwright.config.ts` with a `webServer` serving the gallery, projects `chromium` (launch args `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`) and `electron` (`_electron.launch` after `build:electron`), a `visual.yml` workflow with `npx playwright install --with-deps chromium`, goldens committed per project and platform (Playwright suffixes `-linux`, `-win32`, `-darwin`), and a rule that goldens are produced in CI only, since local hardware output will not match SwiftShader. Electron is 25.9.8 (`package-lock.json:5173`), Chromium 114: `long-animation-frame` (Chromium 123), the six-argument `console.timeStamp` (128), and the need for `--enable-unsafe-swiftshader` (137) all postdate it, while Playwright's bundled Chromium is current. Two Chromium generations means two behaviours for every perf hook.

Proposed: Add to chapter 15: "Minimum Chromium for the development hooks is 128; older runtimes MUST feature-detect (`PerformanceObserver.supportedEntryTypes`, `console.timeStamp.length`) and report `null`." Recommend upgrading Electron (Specboard DDB-22) before the tooling PR. Add to R14.5: "goldens are produced by the CI runner image; local runs compare and never update."

### I17. major. Gallery route and dev-only exclusion

Claim: R13.30 gallery addressable by name; R13.2 build-time exclusion; R15.37 `window.__ui` and friends in development only.

Problem: No `DefinePlugin`, no `__DEV__` symbol in `src` (only `process.env.NODE_ENV` in `Battle.ts:166`, auto-defined by webpack's mode). `DeveloperScreen` and `DeveloperOverlay` ship in production behind F12 and F5 (`Game.ts:64-90`). webpack already has three entries with one `HtmlWebpackPlugin` each (`webpack.common.js:6-10, 35-51`), so a fourth `gallery` entry with `public/gallery.html`, added only when `mode !== 'production'`, follows the pattern; the eight `developer/*Section.ts` classes become gallery scenes with `?scene=`.

Proposed: Add to 13.11's browser column: "Exclusion is a `DefinePlugin` constant (`__DEV_TOOLS__`) declared in `types.d.ts` and set in `jest.setup.js`; dev-only code is wrapped in `if (__DEV_TOOLS__)` so production tree-shakes it; the gallery is a separate webpack entry emitted in development builds only."

### I18. major. Token generator placement and drift

Claim: R11.1 and R11.2: single `tokens.json`, generated typed module, hand-edited theme files prohibited.

Problem: Nothing exists (191 inline `style: {` literals in `src`, 179 under `src/renderer/game`). CI runs Node 18 (`ci.yml:25`) with no TypeScript script runner, so the generator should be plain JavaScript (`scripts/generate-tokens.mjs`). Whether the generated `tokens.ts` is committed or produced by a `prebuild` hook is unstated; committed can drift, generated must run before `tsc`, `jest`, and `eslint`.

Proposed: Add to R11.2: "The generated module is committed; a unit test regenerates it in memory and fails on any difference (the round-trip test in 11.6 doubles as the drift guard)." Name the locations for this repo per the 1.7 module map: `src/renderer/engine/theme/tokens.json` and `tokens.ts`.

### I19. major. Electron `file://` asset loading

Claim: R15.34 assets load through a custom protocol or bundled modules, not `file://` fetches.

Problem: `electron/main.ts:24` uses `loadFile(.../renderer/index.html)` when packaged, so the page origin is `file://` and Chromium rejects `fetch()` of `file://` URLs; that is the open `cards.json` bug (fix #18 made the path page-relative, which does not help on `file://`). The engine adds two assets per font role (PNG and JSON) plus an icon atlas.

Proposed: Make R15.34 concrete: "Metrics and token JSON are imported as modules (bundled). Atlas images are webpack asset modules (`asset/resource` for web, `asset/inline` for the Electron renderer build so no runtime file request exists), loaded with `new Image()`. The engine issues no `fetch`. Game data (`cards.json`) follows the same rule, or the main process registers a custom scheme with `protocol.handle`." Note that R15.32's switches go through `app.commandLine.appendSwitch` before `ready` in `electron/main.ts`.

### I20. major. Event delivery timing, and Pointer Events

Claim: R9.2 events delivered as they arrive when the platform is event-driven; R8.16 dispatch is the first step of the frame; R9.9 hover re-evaluated after layout.

Problem: Two contracts. Immediate dispatch from DOM handlers runs between rAF callbacks against the previous layout (acceptable) but the injection API (R13.35) and the fixed-step clock (R13.37) cannot then make a test deterministic, and R9.9's post-layout hover pass still needs a per-frame step. `InputSystem.ts:78-88` listens to `mousemove`/`mousedown`/`mouseup`, so touch (Game Flow 8.3, Steam Deck) never arrives.

Proposed: Replace R9.2's browser clause with: "The platform adapter queues platform events and the dispatcher drains the queue at the start of the frame in arrival order; injected events join the same queue. The browser adapter listens to Pointer Events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `wheel`) with `touch-action: none` on the canvas, never to mouse events." Keep the polled clause for worldsim.

### I21. major. Wall-clock timers in UI code

Claim: R8.17 timers via `update(dt)`; R13.37 fixed-step hook; R1.6 clock in the context.

Problem: `PlayerHandLayer.ts:320` uses `setTimeout` to remove a discarded card; `Input.ts:379-391` blinks via `update(dt)` (correct); `SplashScreen.ts:106-137` accumulates `dt` (correct). Under a paused or fixed-step clock a `setTimeout` fires out of step and breaks golden capture.

Proposed: Add to R8.17: "Layers 2 to 4 and game UI MUST NOT use platform timers (`setTimeout`, `setInterval`, `Date.now`); all timing derives from the context clock or `dt`."

### I22. major. No tween or animator primitive

Claim: R11.13 transitions interpolate over motion tokens; R12.21 and R12.24 animate; R8.17 `update(dt)` is opt-in.

Problem: Game Flow needs adrenaline refill (2.4), card draw swoop (2.4), card fly to target and to discard (2.3), damage numbers rising and fading (2.3), animated intent icons (2.2), hover lift (2.2). The spec offers the clock and `update(dt)` and nothing between, so every game component writes its own easing over the motion tokens, and R11.13's transitions need an interpolator regardless.

Proposed: Add R8.17a: "The mount context carries an `Animator` service: `animate({ duration, ease, from, to, onUpdate, onComplete })` returns a handle with `cancel()`; it advances from the frame clock in the `update` section, resolves durations and easing by motion token name, and collapses to zero duration under reduced motion. Component state transitions (R11.13) use it." If the authors prefer, state instead that animation is game-side; either way say it.

### I23. major. Screen transitions

Claim: R8.22 unmount outgoing roots before mounting incoming.

Problem: Game Flow 2.1 ("the screen transitions to show a post-apocalyptic battlefield"), 2.4 ("the Enemy Turn overlay fades away"), and the 6.1/6.2 cinematic openers. A cross-fade needs both scenes alive, which R8.22 forbids; there is no transition mechanism; `SplashScreen.ts:110-127` has its fade commented out waiting for opacity (DDB-41).

Proposed: Add R8.22a: "The scene manager MAY own a transition root in the `modal` layer that survives the swap: a scrim fades in over the outgoing scene, the swap happens at full cover, the scrim fades out over the incoming scene. Cross-fades that show both scenes require rendering the outgoing scene once into an off-screen target (R7.13) and compositing it as an `Image` in the incoming scene's `overlay` layer; this is optional." Root opacity (R3.25) covers the splash fade.

### I24. major. Targeting scrim placement

Claim: R3.9 assigns targeting scrims and damage numbers to `overlay` and hover-lifted cards to `raised`.

Problem: Game Flow 2.3: "the battlefield dims slightly... valid targets begin glowing", the hand stays usable, a preview line connects card to target. A scrim in `overlay` sits above everything in `raised`, so valid targets and the hand dim too; the ladder has nothing between `overlay` and `modal` for lit targets short of adding layers.

Proposed: Add a worked example to 3.9: "Targeting: the scrim is a full-viewport rectangle added as a late root in `base` (roots paint in order, R8.21); the hand container and the targetable vehicles set `layer: raised` while targeting; the preview line is a direct `drawLine` in `overlay`; damage previews are `overlay`; the dragged card is `drag`." No new layer needed.

### I25. major. Tooltip content is text only

Claim: R12.22 `content` is `{ title, description, hotkey }`.

Problem: Game Flow 1.2 and 4.2: hovering a mini card shows the full-size card; 7.1 wants status-effect and intent explanations. A card tooltip is a component tree.

Proposed: Amend R12.22: "`tooltip` accepts the content object or a factory `() => Component`; the service mounts the factory's tree under the tooltip root in the `tooltip` layer and unmounts it on hide."

### I26. major. No screen-space bounds query

Claim: R8.13 components never compute absolute positions; the walk accumulates origins.

Problem: Damage numbers spawn at a vehicle, the preview line ends at a target, the drop test needs the target's rectangle, and `Card`/`Layer` already expose `localToGlobal` (`Layer.ts:280-282`) for these reasons. The spec exposes parent-local `bounds` only.

Proposed: Add to R8.1: "read-only `screenBounds` (content box in logical viewport space, valid after layout, maintained by the layout walk, the AABB under transforms) and `localToScreen(point)`/`screenToLocal(point)`."

### I27. major. Controller and spatial focus

Claim: Chapter 9 focus is Tab order plus per-widget arrow keys.

Problem: Game Flow 8.2: "Left stick/D-pad navigates between UI elements with clear highlighting", "face buttons have consistent meanings (A confirm, B cancel)", "Tab cycles through valid targets"; 8.3 Steam Deck touch, trackpads, and scaling. Tab order cannot navigate a 2D map or a fanned hand.

Proposed: Add R9.19a: "`focusManager.moveFocus(direction)` selects the nearest focusable in the active scope whose `screenBounds` centre lies in the direction's half-plane (the Unity and Godot rule), no wrap." Add to chapter 15: "Gamepad is a platform adapter: `navigator.getGamepads()` polled once per frame at input time and mapped to synthesised `keydown`/`keyup` (`ArrowLeft` to `ArrowDown`, `Enter`, `Escape`, `Tab`) with `focusVisible` set, so widgets need no gamepad code." Steam Deck: `uiScale` (R7.5) plus Pointer Events (I20) cover scaling and touch; say so in 7.2.

### I28. minor. Sprites, particles, curved paths: state what is in and out

Problem: Game Flow has idle animations, dust, explosions (2.2), a hand-drawn map with pulsing paths (3.2), rotating shop cards (4.2). The spec's answers exist but are scattered across 1.6, 2.11, 2.15, 5.16, 12.5.

Proposed: Add to 12.9: "Sprite frames are `Image.sourceRect` changes in `update(dt)`. Particles are game-side, drawn with `drawImage`/`drawPolygon` in `overlay`, or a foreign GPU pass with barriers (R2.15). Curved paths are polylines of capsule lines (R5.16) tessellated game-side; `drawPolyline` is a MAY. Vector art beyond icons is out of scope (1.6)."

### I29. minor. Hand clipping versus hover lift

Problem: `PlayerHandLayer.ts:45` clips the hand; cards are 210 px tall in a 158 px band at 882 px (DDB-29), so the bottom of every card is cut. With `raised` promotion on hover, the hovered card escapes the clip and its neighbours do not, which reads as a glitch.

Proposed: Migration: the hand does not clip; the band hugs the card height (`Stack` hug); cards overlap through `zIndex` (R3.9). No spec change.

### I30. minor. `font` role versus `fontFamily` strings

Problem: R2.13 and R12.4 take a role; game code passes `fontFamily: 'monospace'` (`DeveloperOverlay.ts:47`) and the component default is `'Arial'` (`Text.ts:17`).

Proposed: Add to R12.4: "`font` is a role; the style alias `fontFamily` maps `'monospace'` to `mono` and any other value to `body`, with a development-build warning."

### I31. minor. `drawText` position semantics versus today's top-anchored text

Problem: R2.13: "when `box` is absent `position` is the alignment anchor and the baseline." Every current text is positioned by its top edge (`FontAtlas.ts:53` `textBaseline = 'top'`, `Text.ts:20` default `baseline: 'top'`, `Renderer.drawText` `Renderer.ts:397-402`). All 90 `new Text(` sites would shift up by the ascent if the component adopted the draw API's anchor.

Proposed: Add to R12.4: "The `Text` component's `position` is the top-left of its line box (its bounds); the baseline anchor is a draw-API detail hidden by the component."

### I32. minor. Accessor rename is a codemod

Problem: R8.23 wants accessors; the engine is `getX`/`setX` throughout (`Layer.ts:97-202`), with on the order of 700 method-style get/set calls across `src` (a coarse grep that also counts non-Layer calls such as `getInstance` and `setText`). CLAUDE.md forbids keeping legacy aliases.

Proposed: No spec change. Sequence the rename as its own mechanical PR after the tree PR, no behaviour change, so review is `git diff -w` sized.

### I33. minor. Half-open hit edges

Problem: `Layer.ts:260-264` uses `<=`; R8.12 wants `x < right`. Only exact-edge clicks change.

Proposed: None; note in migration.

### I34. minor. Wheel step token

Problem: `Panel.ts:389` scrolls `deltaY * 30` with the raw DOM delta (`InputSystem.ts:224-226`); R9.3 normalises to pixels and R12.20 says "a token number of pixels per notch", but R11.3's required categories have no such token.

Proposed: Add `scroll_step` to the `space` category in R11.3.

### I35. minor. TypeScript lib and ESLint

Problem: `tsconfig.json:5` `lib: ["DOM", "ES2020"]` has no `Intl.Segmenter` (R6.13) or `Array.prototype.at`; `target` is ES2020. ESLint 8 with `@typescript-eslint` 5.59 parses TS 5.0 syntax but not later features; the `@/*` path alias is declared in three places and used by no file.

Proposed: Add to chapter 15: "TypeScript `lib` includes `ES2022` and `DOM`; `strict` on." Migration: bump `target` and `lib` to ES2022 in the foundation PR; upgrade `@typescript-eslint` with the toolchain epic.

### I36. minor. gl-matrix

Problem: `gl-matrix` is used only for per-draw model matrices (`Renderer.ts:1`, `TextRenderer.ts:4`), which R2.4 replaces with CPU-transformed vertices and one projection per flush; it is in `devDependencies` (`package.json:52`) yet bundled.

Proposed: Keep `gl-matrix` for `mat2d` (the transform stack) and `mat4.ortho`, moved to `dependencies`, or drop it for a 30-line 2x3 affine. The 1.7 module map could suggest `mat2d`.

### I37. minor. R5.29 versus R15.2 context attributes

Problem: R5.29 offers "`alpha: false` or `premultipliedAlpha: true`"; R15.2 says `alpha: true` is the default and `alpha: false` is a measured optimisation.

Proposed: R5.29 defers to R15.2 for WebGL: `{ alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }`, cleared opaque.

### I38. minor. Frame domains for a game with no world renderer

Problem: R1.7 and R3.21 describe world domains; this game's battlefield is UI. An implementer could build the multi-domain frame machinery up front.

Proposed: Add to 3.6: "A UI-only application's frame is `[screen UI] flush [debug]`; world domains are added in front when a world renderer exists."

### I39. minor. Snapshot ids

Problem: No component has an id; R13.28 paths become `Type[index]` everywhere, and R7.15's "click the centre of a node's snapshot bounds" has nothing to address.

Proposed: Add to R13.22: "every interactive component a test targets SHOULD carry an id." Migration: id the ~30 named game elements (`end_turn_button`, `hand`, `combat_log`, `start_run_button`, ...) in the snapshot PR.

### I40. minor. `char` events in the browser

Problem: `Input.ts:367-371` treats any `key.length === 1` as text, so Ctrl+V inserts `v`; R9.17 says `char` arrives after platform composition, but a canvas receives no text-input event.

Proposed: Add to chapter 15: "`char` is derived from `keydown` when `key.length === 1` and neither Ctrl nor Meta is held; IME composition is out of scope for the baseline (R12.10) and MAY use a hidden `<input>` later."

### I41. minor. Text decoration for locked event choices

Problem: Game Flow 5.2: "Low resources might lock options with strikethrough text". R12.4 has no decoration property.

Proposed: Add to R12.4: "`decoration` (`none`, `underline`, `strike`), drawn as a 1 px rect per line after the glyph run, in the text colour."

### I42. minor. Explicit focus scopes for target cycling

Problem: Game Flow 8.1 "Tab cycles through valid targets"; R9.20 derives scopes from a modal's subtree only.

Proposed: Add to R9.20: "`focusManager.pushScope(components)` accepts an explicit set for non-modal cycling (targetable vehicles during targeting); popping restores the prior focus."

### I43. nit. Provenance counts

- R6.3 "five different symbol glyphs": six code points at six sites (I4).
- R7.7 "the ratio... in glyph rounding": `TextRenderer.ts:217-218, 364-365` round per glyph in CSS pixels ignoring the ratio; the defect is the ratio's absence there, and per-glyph rounding is the R6.16 anti-pattern.
- R8.24 "181 call sites": 191 `style: {` literals in `src`, 179 under `src/renderer/game`.
- R2.2 and R6.18 "reordered text above shapes everywhere": within a scissor scope; `Renderer.enableScissor` flushes at each clip change, so text inside a clipped layer stays under later unclipped shapes. Same conclusion, narrower mechanism.
- R8.22 ghost clicks: fixed at this HEAD (`AI_DEVELOPMENT_LOG.md:29-45`; `Screen.unmount` -> `rootLayer.unmount` -> `Component.unmount`); the sentence should read past tense.

### I44. nit. README table row 17 points to `17-review-log.md`, which does not exist in `docs/ui-rendering-spec/`.

## Migration map

Action key: keep (unchanged or extended in place), wrap (public API kept, internals replaced), replace (new file under the spec's module map, old deleted), delete, move.

| Current file | Action | Spec chapter | Notes |
|---|---|---|---|
| `src/index.ts` | replace | 1, 7, 13, 15 | Becomes the platform shell: WebGL2 context with R15.2 attributes, `ResizeObserver` viewport owner, `MountContext` construction, frame loop with R13.7 sections and dt clamp, event queue drain (I20). |
| `src/renderer/game/Game.ts` | wrap | 1, 3, 13 | Frame = `[screen UI] flush [debug]`; `DeveloperOverlay` in the debug domain; F5/F12/Escape (`Game.ts:64-90`) move to the root hotkey table. |
| `src/renderer/game/core/Screen.ts` | wrap | 7, 8 | Root list (main tree, then dialogs); root sized from the context viewport; no window listener (`Screen.ts:49-50`), the shell resizes. |
| `src/renderer/game/core/ScreenManager.ts` | keep | 8 | Passes the context; later owns the transition scrim (I23). |
| `engine/rendering/Renderer.ts` | replace (facade in PR 1, deleted in PR 3) | 2, 5, 15 | `drawRectangle/drawText/drawCircle/drawTriangle/drawPolygon` forward to `DrawApi`; `enableScissor/disableScissor` become `pushClip/popClip` in logical pixels; text batch methods deleted. |
| `engine/rendering/TextRenderer.ts` | delete | 6 | Glyph quads go through the batcher. |
| `engine/rendering/FontAtlas.ts` | replace | 6 | MSDF loader with R6.2 validation and metrics; keeps the `measureText` name for `Input`. |
| `engine/rendering/Shader.ts` | keep (extend) | 15 | WebGL2 types, uniform and attribute location cache, `#version 300 es`; folds into the backend. |
| `engine/rendering/Texture.ts` | delete | 2, 15 | Backend `createTexture` with `texStorage2D`. Zero callers today. |
| `engine/rendering/ScissorBatcher.ts` | delete | 4 | Zero callers. |
| `engine/rendering/RenderContext.ts` | delete | 2, 3 | Replaced by the walk's transform, clip, opacity, and layer stacks. |
| `engine/rendering/RendererContext.ts` | delete | 1 | Mount context replaces the singleton. |
| `engine/rendering/PerformanceMonitor.ts` | wrap | 13 | Grows into `FrameTimer` (sections, p99, histogram, spikes) plus batcher stats; keep `beginFrame/endFrame/getStats`. |
| `src/assets/shaders/vertex.glsl`, `fragment.glsl` | replace | 5, 15 | `uber.vert`/`uber.frag` in GLSL ES 3.00; keep the raw-loader import path. |
| `engine/components/Layer.ts` | replace | 3, 8 | Base component: R8.2 props, insertion-order children plus render-order view, mount/unmount, no self-recursion (I7), no scissor. Keep `addChild/removeChild/getChildren/setPosition/setSize/setVisible/unmount` names until the accessor codemod (I32). |
| `engine/components/Component.ts` | merge into base | 8, 9, 11 | `hovered/focused/enabled` become framework-managed; the `select/activate/target/cancel` hooks are used only by `Card`, move them there or delete. |
| `engine/components/Rectangle.ts` | wrap | 12 (R12.1) | Keep the API; pass radius, border position, gradient, shadow. |
| `engine/components/Text.ts` | wrap (internals replaced) | 6, 12 (R12.4) | Real measurement, roles, wrap, ellipsis, top-left line box (I31); keep `setText/setColor/setAlign/setBaseline/setFontSize`. |
| `engine/components/Circle.ts` | wrap | 12 (R12.2) | SDF disc. Gallery only. |
| `engine/components/Triangle.ts`, `Polygon.ts` | wrap | 2 (R2.11), 5 | `drawPolygon` flat mode with the CPU feather (I13). Gallery only. |
| `engine/components/Arrow.ts` | delete | 5 | Zero constructions; the targeting line is a `drawLine` in `overlay`. |
| `engine/ui/Button.ts` | replace | 11, 12 (R12.7) | Variant table, press state machine, focus, keyboard activation; honours style (I11). |
| `engine/ui/Input.ts` | replace | 12 (R12.10) | `TextInput`; gallery only (5 sites). |
| `engine/ui/Panel.ts` | replace | 4, 12 (R12.19, R12.20) | Split into `Panel` and `ScrollContainer` over `Container`; keep `PanelOptions`, `setContentSize`, `scroll`, `setScrollOffset` for the four game callers. |
| `engine/ui/DeveloperOverlay.ts` | wrap | 13 | Debug-domain overlay reading the frame snapshot; re-anchors on resize (`:80-84` runs once today). |
| `engine/input/InputSystem.ts` | replace | 9 | `Dispatcher` (hit-test walk, bubble, capture, enter/leave, normalised wheel), `FocusManager`, browser adapter on Pointer Events. `registerGlobalKeyDown` survives as the root hotkey table. |
| `engine/input/InputSystem.test.ts` | replace | 9, 14 | Dispatcher tests through `MountContext` and the null backend. |
| `engine/types/Style.ts` | keep (extend) | 8 (R8.24), 11 | Add `opacity`, `zIndex`, `layer`, `shadow`, `gradient`, `decoration`; `StyleParser` stays. |
| `game/ui/Card.ts` | rewrite | 8, 9, 12.9 | Extends the base; `handleEvent`; name/badge layout (I5); `tooltip` factory (I25); `transform` for the fan (I3); no `Layer.prototype.render`. |
| `game/ui/Vehicle.ts` | rewrite | 8, 9 | No child rebuild on resize (`:296-303`); status container holds `Icon`s; armour glyph becomes an `Icon`. |
| `screens/combat/CombatScreen.ts` | wrap | 7, 9, 10 | One layout (`Stack` 25/40/20/5, I10); Escape through bubble (`:550-555` is dead today because the root is never focused); `getChildren()[0]` to a field. |
| `screens/combat/PlayerHandLayer.ts` | rewrite | 3, 9 | `zIndex` overlap, `raised` on hover, `drag` plus capture; no clip (I29); no `setTimeout` (I21). |
| `screens/combat/CombatLogLayer.ts` | wrap | 12 | `ScrollContainer`; indices to fields (I6). |
| `screens/combat/ResourceBarLayer.ts`, `DriverStatsDisplay.ts` | wrap | 6, 12 | `Icon`s for ⚙ and ⛽; measured widths; indices to fields. |
| `screens/combat/BattlefieldLayer.ts`, `EnemyBattlefieldLayer.ts`, `PlayerBattlefieldLayer.ts` | wrap | 8 | Intent `Icon`s; drop the remove/re-add on resize (`Enemy*:316-323`, `Player*:160-167`); indices to fields. |
| `screens/combat/TurnPhaseDisplay.ts` | keep | 12 | Fix the 40 px geometry (DDB-30: rows at 25%, 50%, 75% of 40 px with 16/20/14 px text). |
| `screens/driver-selection/*` | wrap | 7, 8, 10 | No window reads (I9); no rebuild on resize (I8); deck as `ScrollContainer`; real measurement. |
| `screens/main-menu`, `screens/splash`, `screens/battleResult` | wrap | 3, 7 | No window reads; splash fade via root opacity. |
| `screens/card-showcase/CardShowcaseScreen.ts` | wrap | 8, 12 | Delete the double render (`:300-302`); `ScrollContainer`. |
| `screens/developer/*` | move | 13 | Become gallery scenes (`?scene=`); `DeveloperScreen` either stays as the in-game route to the gallery or goes. |
| `webpack/*.js` | extend | 13, 15 | Gallery entry (dev only), `DefinePlugin(__DEV_TOOLS__)`, asset modules for atlases, JSON import. |
| `jest.config.js`, `jest.setup.js` | extend | 14 | Coverage off by default; delete the GL stub; `__DEV_TOOLS__` global. |
| `package.json` | extend | 13, 14, 15 | `@playwright/test`, `tinybench`; scripts `tokens`, `fonts:build`, `test:visual`, `bench`. |
| `tsconfig.json` | extend | 15 | `lib` and `target` ES2022 (I35). |
| `.github/workflows` | extend | 14 | `visual.yml` (Playwright, SwiftShader flags, goldens artifact). |
| `electron/main.ts` | extend | 15 | Perf switches before `ready`, `app.getGPUFeatureStatus()` log, inline assets or a custom scheme (I19). |
| `docs/AI_TECHNICAL_DECISIONS/COORDINATE_SYSTEM.md`, `COORDINATE_SYSTEM_ARCHITECTURE.md`, `COMPONENT_ARCHITECTURE.md`, `UI_COMPONENT_API_DESIGN.md`, `PERFORMANCE_OPTIMIZATION_PLAN.md` | supersede | all | Replace with one kebab-case decision doc that points at the spec; CLAUDE.md prefers deletion of stale docs. |

Untouched by the migration: `game/mechanics/*`, `game/ai/*`, `game/core/{Model, EventEmitter, State, CardLoader, DriverLoader}`, `CombatModel.ts`, the two standalone HTML harnesses, and the 126 mechanics and AI tests (they are UI-independent and serve as the canary that game logic was not touched).

## Under-specified for this game

Each row: what Game Flow needs, what the spec gives, the gap, the proposed rule (finding id).

| Need (Game Flow) | Spec covers | Gap | Proposed rule |
|---|---|---|---|
| Fanned hand with hover lift (2.2) | sibling `zIndex` (R3.12), `raised` layer (R3.9), opacity (R3.25) | no rotation or scale on components; promotion coordinate ambiguity; hand clip | R8.2a `transform` (I3); R3.8 rewrite (I1); hand does not clip (I29) |
| Drag-and-drop targeting with preview line and target glow (2.3) | capture and `drag` layer (R9.10-9.12), direct draws in `overlay` (R2.7), glow (R5.13), drop hit-test excluding the ghost (R9.12) | scrim above `raised` dims the targets; no screen rect for line endpoints | 3.9 targeting example (I24); `screenBounds` (I26) |
| Floating damage numbers and previews (2.3) | text shadow (R2.13), `overlay`, opacity | no animator; no spawn anchor; timers | `Animator` (I22); `screenBounds` (I26); no platform timers (I21) |
| Status icons orbiting vehicles (2.2) | `Icon` (R12.6), `update(dt)` (R8.17) | icon pipeline; easing | icon atlas (I4); `Animator` (I22) |
| Enemy intent icons, several per enemy (2.2) | `Icon` plus `Text`, horizontal `Stack` hug | icon pipeline | icon atlas (I4) |
| Animated adrenaline refill and card draw (2.4) | `update(dt)`, motion tokens (R11.13) | no animator; no transform for the swoop | `Animator` (I22); `transform` (I3) |
| Map screen, hand-drawn chart, glowing paths (3.2) | `Image` nine-slice and fit (R5.19, R12.5), capsule lines (R5.16), `Circle`, `Icon`, glow, tooltips | curved paths; pulsing; pinch zoom on Steam Deck | 12.9 note on polylines and particles (I28); `Animator`; container `transform` for zoom (I3); pinch gesture out of scope, say so |
| Garage with scrollable deck lists and hover previews (4.2) | `ScrollContainer` (R12.20), `Stack`, `ListRow`, `Button`, `Image`, `tooltip` | tooltip content is text only | tooltip factory (I25) |
| Event screens with choice cards and locked options (5.2) | `Panel`, `Image`, wrapped `Text`, `Button`, `Icon` | strikethrough | `decoration` (I41) |
| Dialogs and confirmations (4.2, 8.1) | `Dialog` (R12.21) with scrim and focus scope | none | none |
| Tooltips on cards and statuses (7.1) | `tooltip` property and service (R12.22) | component content | tooltip factory (I25) |
| Keyboard navigation: 1-7 select cards, Tab cycles targets, Space, Escape, WASD (8.1) | root hotkey table (R9.15), Tab order (R9.18-9.19), focus scopes (R9.20) | spatial move; explicit target scope | `moveFocus` (I27); `pushScope(components)` (I42) |
| Controller (8.2) | nothing | gamepad adapter; A/B mapping | gamepad adapter synthesising keys (I27) |
| Steam Deck: touch, scaling, edge-safe layout (8.3) | `uiScale` (R7.5), Pointer Events once I20 lands | default scale policy; safe margins | policy is game-side; state it in 7.2 |
| Screen transitions and turn overlays (2.1, 2.4, 6.x) | unmount-before-mount (R8.22), opacity | no transition mechanism | R8.22a transition root (I23) |
| Sprites, particles, idle animation (2.2) | `Image.sourceRect`, `drawImage`/`drawPolygon`, foreign passes (R2.15) | not stated together | 12.9 note (I28) |

Proposed rule text, consolidated (numbers continue each chapter's sequence and can be renumbered by the authors):

- R3.8 (replacement): "Promotion changes the sort key and resets the clip stack to `none` for the promoted subtree. It does not change position resolution: screen position is the accumulated tree position including ancestor content offsets. `positioned: 'screen'` (independent of `layer`) interprets `position` in viewport space and ignores ancestor origins and offsets."
- R3.9 (add example): targeting scrim as a late `base` root; hand and targetable vehicles `raised`; preview line `overlay`; ghost `drag`.
- R8.1 (add): "`render()` emits only the component's own draws; the framework visits children." "Read-only `screenBounds` and `localToScreen`/`screenToLocal`."
- R8.2a (new): `transform { rotation, scaleX, scaleY, pivot }` with walk, hit-test inverse, AABB bounds.
- R8.8 (tighten): library components never insert implicit children.
- R8.15 (add): idempotent `unmount`; `addChild` on a mounted parent mounts immediately.
- R8.17 (add): no platform timers in layers 2 to 4 or game UI.
- R8.17a (new): `Animator` service on the mount context, motion-token driven, reduced-motion aware.
- R8.22a (new): transition root that survives the scene swap; off-screen cross-fade optional.
- R9.2 (browser clause): event queue drained at frame start; Pointer Events with `touch-action: none`.
- R9.19a (new): `moveFocus(direction)` spatial navigation. R9.20 (add): `pushScope(components)`.
- R11.3 (add): `space.scroll_step`. R11.8 (add): `fontWeight: bold` resolution table. R11.15 (add): override replaces the `normal` cell, state rules still apply.
- R12.4 (add): `position` is the line box's top-left; `fontFamily` alias mapping; `decoration`.
- R12.6 (replace baseline): icons are MSDF glyphs from an icon atlas built by the font pipeline; geometry icons MAY.
- R12.22 (amend): tooltip content may be a component factory.
- R12.9 (add): sprites, particles, polylines, pinch, gamepad statements of scope.
- Chapter 6 appendix: faces, licenses, generator command, charset, msdf-atlas-gen JSON schema, committed outputs.
- Chapter 15 (add): minimum Chromium 128 with feature detection; TypeScript lib ES2022; `__DEV_TOOLS__` define; assets as modules and asset/inline for Electron; `char` derivation; gamepad adapter.
- R14.1 (add): engine modules importable without a DOM. R14.5 (add): goldens produced in CI only. 13.11 (amend): tinybench script instead of vitest bench.

## First three PRs

The README's order (chapters 2 to 5, then 13, then components) is right about chapters 2 to 5 first. In this codebase the snapshot and lint of chapter 13 need the tree of chapter 8 to have bounds and roots, so chapter 13's net cannot precede the tree PR; the net that matters for chapters 2 to 5 is the recording backend and the 3.12 ordering tests, which PR 1 carries. Feature flags are avoided by having each PR replace one layer wholesale behind an API that the next PR deletes (the `Renderer` facade in PR 1, the `mask` text mode and old atlas in PR 2, `InputSystem` in PR 3); nothing runs two code paths side by side, which is what CLAUDE.md's "prefer deletion" rule asks for. The game is playable after each PR.

### PR 1. Batcher, uber shader, and per-draw clipping behind the existing `Renderer` API

Goal: chapters 2, 3, 4, 5 (without MSDF) land. Game code changes only where the ordering fix exposes a layout bug (I5).

Added: `src/renderer/engine/gpu/{Backend.ts, WebGL2Backend.ts, NullBackend.ts, RecordingBackend.ts}`; `src/renderer/engine/draw/{DrawApi.ts, Batcher.ts, DrawGroup.ts, Layers.ts, ClipStack.ts, Vertex.ts}`; `src/assets/shaders/uber.vert`, `uber.frag` (modes `flat`, `rect`, `shadow`, `circle`, `image`, `text`, plus a temporary `mask` mode for the old bitmap atlas); tests `Batcher.test.ts` (3.12: sort, barrier, shadow adjacency, promotion, determinism, single-layer fast path), `ClipStack.test.ts` (4.7: intersection, empty, pop, DPR), `RecordingBackend.test.ts`.

Modified: `Renderer.ts` becomes a facade (`draw*` forward to `DrawApi`; `enableScissor(x, y, w, h)` in device pixels replaced by `pushClip(rect)` in logical pixels, with `Layer.ts:396-449` and `Panel.ts:320-367` passing logical rects and no longer calling `getParameter`; `beginTextBatch/flushTextBatch/endTextBatch` deleted; `Game.render` calls `beginFrame/endFrame`); `index.ts` (WebGL2 context with R15.2 attributes; `useShader` removed); `Rectangle.ts` (passes `cornerRadius`, border `inside`); `Circle.ts`, `Triangle.ts`, `Polygon.ts` (through `drawCircle`/`drawPolygon`, strokes at real width); `FontAtlas.ts` keeps its canvas bitmap for one more PR but uploads it once as a backend texture, and `Renderer.drawText` emits glyph quads into the batcher in `mask` mode (`TextRenderer.ts` deleted); `Card.ts:104-116` (name starts at x 40 when a badge exists); `DeveloperScreen.ts:109` (panel y 96); `CardShowcaseScreen.ts:300-302` (`onRender` deleted).

Deleted: `ScissorBatcher.ts`, `Texture.ts`, `Arrow.ts`, `TextRenderer.ts`, `Renderer.drawLine`, `vertex.glsl`, `fragment.glsl`.

Visible: text no longer floats above later shapes (DDB-28 and DDB-31 change as described in I5); rounded corners everywhere (I12); 2 to 3 px circle borders; polygon strokes at real width, edges without MSAA (I13); one GPU draw per frame per texture; the F5 overlay shows real draw-call and flush counts. Game logic untouched; the 126 mechanics and AI tests stay green. Attach before/after screenshots of all six screens plus the gallery from the playtest URL.

### PR 2. MSDF text and the font asset pipeline

Added: `src/assets/fonts/` with `OpenSans-Regular.ttf` (moved from `public/assets/fonts/`), a display face, a mono face, one `OFL.txt` per face, `charset.txt`, and the generated `*.png` and `*.json` per face; `scripts/build-fonts.ps1` and `.sh`; `src/renderer/engine/text/{FontAtlas.ts (loader with R6.2 validation), TextLayout.ts (shared iteration: kerning, letter spacing, transform, greedy wrap, ellipsis, run snapping), TextMetrics.ts (bounded cache)}`; `TextLayout.test.ts` over the committed JSON (6.9: measure equals render, fallback glyph, wrap, snap, order) with no GL.

Modified: `uber.frag` (`text` mode median-of-three with derivative range; `mask` mode removed); `DrawApi.drawText`/`measureText` take the R2.13/R2.14 shapes; `Text.ts` (roles, real measurement replacing `Text.ts:154` and `:205-210`, `nowrap` plus `ellipsis` now truncates, top-left line box per I31, `fontWeight: bold` through the role table); `Input.ts:235-243` (scaled caret); `SynergyPreviewPanel.ts:255-268` and `DriverStatsDisplay.ts:268-273` (measured); `DeveloperOverlay.ts:47` (`mono`); the six glyph sites (I4) switch to the icon atlas if `Icon` is included here, otherwise to ASCII placeholders; webpack asset-module rules for atlas PNGs and JSON import; `tsconfig` lib ES2022 for `Intl.Segmenter`.

Deleted: `engine/rendering/FontAtlas.ts`.

Visible: every string changes face (Open Sans instead of Arial), crisp at 8 px and 64 px, wrapped paragraphs reflow, card names get a real ellipsis, bold titles render bold. Smoke-test the packaged Electron build for the `file://` asset path (I19).

### PR 3. Component tree, dispatcher, mount context

Added: `src/renderer/engine/ui/{Component.ts (base with R8.1/R8.2, render-order view, mount/unmount, effective props), Container.ts (clip and content offset), MountContext.ts, Dispatcher.ts (R9.4 walk, bubble, capture, enter/leave, wheel normalisation, root hotkey table), FocusManager.ts (R9.18-9.23), PlatformInput.ts (Pointer Events adapter with the frame-start queue)}`; `src/renderer/engine/devtools/{TreeSnapshot.ts, LayoutLint.ts}` (pure functions; they need the tree's bounds, hence here rather than PR 1); tests for 8.9 (effective visibility, `removeChild` unmounts, children order after z-sorted render, no service touch before mount, screen switch) and 9.9 (hit order with a promoted popup and a scrolled-out child, bubble, capture, enter/leave, focus basics), lint fixtures.

Modified: `Layer.ts` and `Component.ts` collapse into the new base (method names kept); `Rectangle/Text/Circle/Triangle/Polygon` stop recursing (I7); `Panel.ts` becomes `Panel` plus `ScrollContainer` over `Container`; `Button.ts` and `Input.ts` switch from `InputSystem.register*` to `handleEvent`; `index.ts` builds the `MountContext` (viewport owner via `ResizeObserver`, clock, draw API, focus, popup, tooltip, animator stubs) and drains the event queue at frame start; `Screen.ts` and `ScreenManager.ts` take the context and expose roots; `Game.ts` moves F5/F12/Escape to the hotkey table and draws the overlay in a debug domain; `Card.ts` and `Vehicle.ts` extend the base and implement `handleEvent` (no constructor registration, no `Layer.prototype.render`, no child rebuild on resize); `CombatScreen.ts` single layout, Escape via bubble, field instead of `getChildren()[0]`; `PlayerHandLayer.ts` (`zIndex` overlap, `raised` on hover, no clip, no `setTimeout`; drag deferred); `CombatLogLayer.ts`, `ResourceBarLayer.ts`, `*BattlefieldLayer.ts`, `CardShowcaseScreen.ts` indices to fields; `DriverSelectionScreen.ts`, `MainMenuScreen.ts`, `SplashScreen.ts` use the root's size; `DriverSelectionScreen.onResized` and `DriverPanel` stop rebuilding; `SplashScreen` fades via root opacity; `DeveloperScreen.ts:208-214` uses its field.

Deleted: `InputSystem.ts`, `InputSystem.test.ts` (replaced), `RenderContext.ts`, `RendererContext.ts`, the `Renderer.ts` facade.

Visible: overlapping vehicles and cards receive input top-first (`BattlefieldLayer.ts:161-167` stacks with 40 px overlap); hidden or scrolled-out components stop taking clicks; one wheel notch scrolls a fixed number of pixels; the splash fades; resizing no longer leaks handlers or rearranges combat; every screen resizes through one path.

Follow-ups in order: PR 4 accessor codemod (I32); PR 5 `tokens.json`, generator, drift test, Button and Input variant tables (chapters 11, 12.2, 12.3); PR 6 gallery entry, snapshot and lint hooks on `window.__ui`, Playwright, `visual.yml` (chapters 13, 14); PR 7 `Stack` layout (chapter 10) with `CombatScreen` as the first consumer; PR 8 icon atlas and the six glyph sites; PR 9 `Image` and card art; then `Dialog`, `Tooltip` with component content, `ScrollContainer` polish, `Toast`, drag-and-drop targeting, `Animator`.

## Chapter 14 corrections

Rows in 14.4 where the sibling engine column should change, with evidence. Every other row was checked against source and stands.

| Chapter | Item | Scored | Should be | Evidence |
|---|---|---|---|---|
| 1 | Downward dependencies, draw API only GPU path | partial "(one game class reads the render context)" | partial, note reworded | The game class is `Card.ts:4`, which imports the `RenderContext` offset object (a layer 3 type), not the GL context. Game code makes zero `Renderer.draw*` calls; `Screen`/`CombatScreen` import `Renderer` as a constructor type only. |
| 2 | `measureText` sharing the draw iteration | no "(estimates; atlas advances only for alignment)" | partial | `FontAtlas.measureText` (`FontAtlas.ts:181-193`) sums the same `advance` table that `TextRenderer.buildVertexBufferForColor` advances by (`TextRenderer.ts:404`), and `Renderer.drawText` uses it for alignment (`Renderer.ts:384-402`). The draw layer shares the iteration up to per-glyph rounding; the estimates live in the component layer (`Text.ts:154, 205`). |
| 4 | Clip transformed at push | no | yes (translate-only) | `Layer.ts:413-416` and `Panel.ts:338-342` compute the scissor from `screenX/screenY`, which include the accumulated parent offsets, at the moment the clip is applied; the scroll offset is correctly excluded (R4.10). Translation is the only transform that exists. Worldsim's failure (a clip at the wrong place inside an offset container) does not occur here. |
| 4 | All primitives clipped incl. text | partial | yes | The scissor applies to every draw issued while enabled, and text is flushed at each scissor change (`Renderer.ts:691-704`) so glyphs are clipped by the scope they were drawn in. The nesting defect (replace instead of intersect) is scored in the three-state row. |
| 5 | Single program, explicit modes incl. `flat` | no | partial | One program for the whole app (`index.ts:48-53`), modes selected by uniforms (`uUseTexture`, `uStrokeWidth`, `fragment.glsl:13-43`), no SDF. "Single program" is met; "data-selected, no GPU state change" is not. |
| 6 | Shared measure and render | no | partial | Same as the chapter 2 row. |
| 6 | Run snapping | no | no, note reworded | Not absent but wrong: per-glyph `Math.round` in CSS pixels (`TextRenderer.ts:217-218, 364-365`), the anti-pattern R6.16 names. |
| 7 | Projection per flush | yes | yes, with note | Rebuilt on resize and applied on `useShader` (`Renderer.ts:134-147, 162-171`), not per flush; same effect since the viewport only changes on resize. |
| 13 | Screenshot and injection | no | partial (injection) | `InputSystem.test.ts:58-87` drives the real handlers with `MouseEvent`s dispatched on the canvas, the in-page `dispatchEvent` path 13.11 lists as acceptable; there is no logical-coordinate API and no screenshot hook. |
| 14.3 | "no code was executed... 2026-08-22 survey" | consistent | keep | Matches `AI_DEVELOPMENT_HUB.md:9` (128/128 tests, 0 lint errors, 9 warnings). |

Row the table lacks: "Constructor-time registration (R8.14)" scored no (five classes register in constructors, I8), distinct from "Mount lifecycle: partial (unmount only)", which is correct as scored.

Rows confirmed as scored: no depth test with straight alpha (`Renderer.ts:53-54`); tree order only with `zIndex` unread (`Style.ts:40`, no reader); no shadows or gradients (grep finds none); scissor with `getParameter` (`Layer.ts:405`, `Panel.ts:330`); nested clip replace; hit testing ignoring clip and visibility (`Layer.ts:257-268`); `borderRadius` dropped (`Rectangle.ts:119-127`); alpha-mask textures only (`fragment.glsl:16`); 16-bit indices and per-draw allocation (`Renderer.ts:460, 489-493`); canvas bitmap atlas at one size; window reads and two combat layouts; `Card`/`Vehicle` extending `Layer`; `removeChild` without unmount (`Layer.ts:236-244`); no margin; unmount only; no invalidation; positional constructors (`new Text(text, options)`); no event object (`InputSystem.ts:2`); no bubble; no capture; no focus manager; append-and-backspace input; no layout engine; no tokens; no variant tables; three components; frame-interval-only perf (`PerformanceMonitor.ts:41-44`); no counters with reasons; no snapshot; no lint; developer screen as a partial gallery; no build-time exclusion; WebGL1 (`Renderer.ts:35`).
