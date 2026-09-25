# worldsim UI component system: object model, events, focus, layout, theming, component catalog

Research report for the TypeScript/WebGL2 port. Source repo: `C:/Users/kevin/Code/worldsim` (read-only). All paths below are relative to that root; `file:line` cites the line numbers in the current checkout. Short structs are quoted verbatim where the exact field set is load-bearing.

Scope: everything above the drawing core (`Renderer::Primitives`, `BatchRenderer`, the SDF rect/text shaders are another agent's topic). This covers `libs/ui/` (component model, input, focus, layout, theme, font measurement API, every component, debug tooling), the `libs/engine` input plumbing that feeds it, the design-system docs under `docs/design/ui/`, the `docs/technical/ui-framework/` docs, and the dev-log entries that record what was rebuilt or regretted.

One orientation note before the sections: there are two component populations in `libs/ui/components/`. The interactive widgets (Button, TextInput, Select, Dialog, ...) are `IComponent` subclasses that live in a tree, get events, and get laid out. The "Salvage design-system primitives" added in June 2026 (Panel, Badge, Stat, Avatar, KeyCap, Divider, SegmentedControl) are plain classes with an `Args` struct and a `render() const`; they are not `IComponent`s, have no hit testing, and are drawn ad hoc by whoever owns them (`apps/ui-sandbox/scenes/SalvageScene.cpp:91-173` constructs them as temporaries and calls `.render()` inline). The catalog in section 6 marks which is which, because the port should not carry that split forward.

---

## 1. Object model

### 1.1 Interfaces and base classes

`libs/ui/component/Component.h` defines the whole hierarchy in one header.

`IComponent` (`Component.h:27-96`) is the root of everything drawable. Verbatim, minus comments:

```cpp
struct IComponent {
    virtual ~IComponent() = default;
    virtual void render() = 0;
    virtual bool handleEvent(InputEvent& /*event*/) { return false; }
    virtual bool containsPoint(Foundation::Vec2 /*point*/) const { return false; }
    virtual float getWidth() const = 0;      // INCLUDING margin
    virtual float getHeight() const = 0;     // INCLUDING margin
    virtual void setPosition(float x, float y) = 0;
    virtual void setLayoutSize(float /*w*/, float /*h*/) {}   // kSizeKeep leaves an axis alone
    virtual Foundation::Vec2 getPosition() const { return {0.0F, 0.0F}; }
    virtual const char* debugTypeName() const { return "IComponent"; }
    virtual const char* debugId() const { return nullptr; }
    float    margin{0.0F};
    SizeMode widthMode{SizeMode::Fixed};
    SizeMode heightMode{SizeMode::Fixed};
    float    fillWeight{1.0F};
    short    zIndex{0};
    bool     visible{true};
};
```

Everything the layout engine, the lint, the serializer, and the event dispatcher need is on this one interface: a margin-box size, a position setter, an optional size assignment, a hit test, an event hook, a z-index, a visibility flag, and two debug strings. There is no `enabled` on the base; disabled is per-component (`Button::disabled`, `TextInput::enabled`, `Select::disabled`, `Slider::disabled`) and each component implements it by returning early from `handleEvent` and `canReceiveFocus`.

`ILayer` (`Component.h:106-112`) adds the two lifecycle methods for things that participate in the update loop:

```cpp
struct ILayer : public IComponent {
    virtual void update(float deltaTime) = 0;
    virtual void layout(const Foundation::Rect& bounds) = 0;
};
```

Shapes (`Rectangle`, `Circle`, `Line`, `Text` in `libs/ui/shapes/Shapes.h`) implement only `IComponent`; they render and report size but never update. `Component` (`Component.h:199-382`) implements `ILayer` and is the base for anything with children. `Container` (`libs/ui/component/Container.h:31-110`) extends `Component` with an optional clip and a content offset, and is the base for `LayoutContainer`, `ScrollContainer`, and `Dialog`.

The design rationale is recorded in `docs/technical/ui-framework/architecture.md:107-138`: the first version used C++20 concepts with `static_assert(Layer<Button>)`, which hid the relationships; they switched to explicit virtual interfaces so `class Button : public Component, public FocusableBase<Button>` says what it is. The 2025-11-26 dev-log entry calls this the "unified layer model": shapes and widgets are one hierarchy, no separate primitive manager.

### 1.2 Ownership: arena + generational handles

`Component` owns its children in a `MemoryArena` (`Component.h:125-182`): a single `unique_ptr<char[]>` of 64KB by default, bump-allocated with alignment, destructors tracked in a vector of `(ptr, fn)` pairs. It is deliberately non-growable ("Growing would require memcpy which breaks vtable pointers", `Component.h:121-123`) and throws `std::runtime_error` when full (`:154-156`). Children are added by move:

```cpp
template <typename T> LayerHandle addChild(T&& child);   // Component.h:246-256
template <typename T> T* getChild(LayerHandle handle);   // Component.h:259-269, dynamic_cast
```

`addChild` allocates into the arena, pushes the raw pointer onto `children`, sets `childrenNeedSorting`, and returns a `LayerHandle` made from `(index, generation)`. `LayerHandle` (`libs/ui/layer/Layer.h:12-40`) is a 32-bit value: low 16 bits index, high 16 bits generation, `0xFFFFFFFF` reserved as invalid (`make()` refuses index 0xFFFF with generation 0xFFFF to avoid colliding with it, `Layer.h:27-34`).

There is no `removeChild`. The only removal is `clearChildren()` (`Component.h:326-332`), which clears the vector, resets the arena (running every destructor), and bumps `generation` so every outstanding handle resolves to `nullptr`. Dynamic content (dialog columns, list rebuilds) is done by clear-and-rebuild; `docs/technical/ui-framework/data-binding.md:151-156` shows the intended pattern (`clearChildren(); for (...) addChild(createColonistCard(...))`).

`children` must never be reordered: handles index into it. The z-sorted view is a separate `renderOrder` vector rebuilt lazily by `ensureRenderOrder()` with `std::stable_sort` on `zIndex` (`Component.h:368-381`). `libs/ui/layer/Layer.test.cpp:115-134` pins this: raising a child's zIndex and rendering must not remap the handles ("an in-place sort of `children` used to break this").

Components themselves are non-copyable, movable (`Component.h:238-243`). In practice scenes hold top-level widgets in `std::unique_ptr` members (every sandbox scene does this) and compose subtrees via `addChild(std::move(x))`.

Some composite components bypass the arena for their internals: `Button` holds its optional `Icon` in a `std::unique_ptr<Icon>` (`Button.h:127`) and renders it manually; `ToastStack` holds `std::vector<std::unique_ptr<Toast>>` (`ToastStack.h:105`) and never calls `addChild`, so its toasts are invisible to `getChildren()` and therefore to the serializer/lint (it compensates by reporting its own envelope bounds, `ToastStack.cpp:83-104`). `TooltipManager` owns the single live `Tooltip` in a `unique_ptr` (`TooltipManager.h:83`).

### 1.3 Geometry conventions

- `Component::position` is the margin-box origin; content renders at `position + margin` (`getContentPosition()`, `Component.h:235`). `getWidth()/getHeight()` return `size + margin*2` (`:211-214`).
- Shapes store the content origin and back out the margin in `getPosition()` (`Shapes.h:53, 64`, `:103, 106`, `:215, 231`). `setPosition(x, y)` on a shape stores `{x + margin, y + margin}`.
- `size` is content size for every component, containers included. `LayoutContainer{.size={100,50}, .margin=10}` reports 120x70 to its parent (`LayoutContainer.test.cpp:535-543`, "codebase-wide convention, kept deliberately").
- `setLayoutSize(w, h)` assigns content size; `kSizeKeep` (-1) skips an axis (`LayoutTypes.h:52`). Default is a no-op, so non-resizable leaves (`Circle`, `Line`) silently ignore Fill/Stretch (`LayoutContainer.h:52-55`, test `:581-594`).
- Hit testing is inconsistent about margin. `Button::containsPoint`, `TextInput::containsPoint`, `Slider::containsPoint`, `ListRow::containsPoint` test `position .. position + getWidth()` (the margin box, "Hit testing includes the margin area", `Button.cpp:232-235`). `Menu`, `Select`, `DropdownButton`, `TreeView`, `Toast`, `ScrollContainer`, `Tooltip` test the content box from `getContentPosition()`. Also inconsistent about edge inclusion: Button uses `<=` on the far edge, Menu/Select use `<`.

### 1.4 Lifecycle order and tree walks

Per frame the app does: `glfwPollEvents()` -> `InputManager::update()` -> synthesize `InputEvent`s and dispatch through `SceneManager::handleInput` -> `SceneManager::update(dt)` -> render (`libs/engine/application/Application.cpp:127-230`). The engine-level contract is `handleInput -> update -> render` (`docs/technical/ui-framework/event-system.md:9-17`: "Input handling does NOT need delta time").

How each phase walks the tree:

| Phase | Entry | Walk order | Skips invisible? |
|---|---|---|---|
| Input | `Component::dispatchEvent` (`Component.h:338-359`) | `renderOrder` reversed: highest zIndex first, ties in reverse insertion order | yes |
| Update | `Component::update` (`:285-294`) | insertion order; only `ILayer` children (via `dynamic_cast`) | yes |
| Layout | `Component::layout(bounds)` (`:296-303`) | insertion order, `ILayer` children only, passes the same bounds down | no |
| Render | `Component::render` (`:305-315`) | `renderOrder`: lowest zIndex first; sets `RenderContext::setZIndex(child->zIndex)` before each child | yes |

So render is back-to-front and input is front-to-back over the same stable-sorted list, which is the invariant the whole event model relies on. `RenderContext` (`libs/ui/core/RenderContext.h`) is a `thread_local short` that a shape's `render()` reads to stamp its draw call's z (TextInput reads it at `TextInput.cpp:544, 621, 666` and offsets +1/+3 for selection/cursor). Note that `Component::update` and `dispatchEvent` skip `!visible` children but `layout()` does not; and `Component::layout` is essentially unused by the engine now (see 4.3: the layout engine calls `layout()` only on nested `LayoutContainer`s).

`visible` is the single hide switch: "when false, this component and all descendants are skipped during render, handleInput, and update. Use this instead of positioning offscreen" (`Component.h:93-95`). `LayoutContainer` also excludes invisible children from measurement and positioning (`LayoutContainer.cpp:112, 128, 155, 168, 200, 240`). There is no separate "collapsed vs hidden"; invisible means gone from flow.

### 1.5 Ids and dirty state

Ids are `const char*` (must outlive the component; `SectionHeader.h:40` and `StatusTextLine.h:50` explicitly do not forward `args.id` because it was a temporary `std::string`), surfaced via `debugId()`. `ListRow` stores a `std::string` and returns `.c_str()` (`ListRow.h:36, 151`). Ids are also forwarded into draw calls (`drawRect({.id = id})`) for the renderer-side inspection.

There is no general invalidation system. The dirty flags that exist:

- `Component::childrenNeedSorting` (set by `addChild` and `markChildrenNeedSorting()`; you must call the latter after changing a child's `zIndex`, `Component.h:318`).
- `LayoutContainer::layoutDirty` / `childSizesDirty` (`LayoutContainer.h:166-167`), set by `addChild`, `setPosition`, `setLayoutSize`, and the property setters, cleared on `render()`. "No parent back-pointers (v1): after mutating a child's content (text, size, visibility), call invalidateLayout() on the owning container" (`LayoutContainer.h:50-51`).
- `Text`'s mutable measurement cache keyed on text/fontSize/wrapWidth/wordWrap (`Shapes.h:239-244`, `Shapes.cpp:31-64`).
- `TreeView::flattenDirty` (`TreeView.h:114`), rebuilt lazily by every accessor.
- `Button` caches its uppercase label width keyed on label + derived font px (`Button.h:132-134`).

Everything else is recomputed each frame (Slider calls `computeLayout()` in `update`, `Slider.cpp:144-146`; Dialog recomputes panel rects from `screenWidth/Height` on every call).

### 1.6 Container: clip + content offset

`Container` (`Container.h`) adds two independent knobs, following what the doc calls the Flutter/Unity decoupled pattern (`docs/technical/ui-framework/clipping.md:56-72`): `setClip(optional<ClipSettings>)` and `setContentOffset(Vec2)`. `render()` pushes a translation transform if the offset is non-zero, then pushes the clip (so the clip rect stays in screen space while content moves), renders children, pops both (`Container.h:77-105`). `handleEvent()` subtracts the offset from `event.position` before `dispatchEvent`, then restores it (`Container.h:38-55`). `ClipSettings` (`libs/foundation/graphics/ClipTypes.h:61-64`) is `{ClipShape shape; ClipMode mode}` where only `ClipRect` is implemented (the rounded/circle/path variants are declared "NOT YET IMPLEMENTED", `ClipTypes.h:28-43`).

Two consumers set both: `ScrollContainer::updateClipAndOffset` (`ScrollContainer.cpp:211-230`) clips to the viewport minus the 8px scrollbar column and offsets by `contentPos - {0, scrollY}`; `Dialog::updateContentArea` (`Dialog.cpp:407-417`) clips to the content rect and offsets by its origin so dialog children are authored in content-local coordinates starting at (0,0).

---

## 2. Event system

### 2.1 Event type

`libs/ui/input/InputEvent.h:16-45`:

```cpp
struct InputEvent {
    enum class Type { MouseDown, MouseUp, MouseMove, Scroll };   // keys go through FocusManager
    Type type{Type::MouseMove};
    Foundation::Vec2 position{0.0F, 0.0F};   // screen coordinates
    engine::MouseButton button{};
    float scrollDelta{0.0F};                 // positive = up
    int modifiers{0};                        // GLFW modifier flags
    bool consumed{false};
    void consume() { consumed = true; }
    bool isConsumed() const { return consumed; }
    static InputEvent mouseDown(Vec2, MouseButton, int mods = 0); // ... mouseUp, mouseMove, scroll
};
```

Four mouse event types, no key events, no target/phase/timestamp, no drag or double-click events. Modifiers are raw GLFW bits (`Application.cpp:149-159` rebuilds them from key state as `kModShift/kModControl/kModAlt`).

### 2.2 How events reach the tree

Events are not delivered from OS callbacks; they are synthesized once per frame from polled state in `Application::run()` (`Application.cpp:145-201`):

1. A `MouseMove` is dispatched every frame, whether or not the mouse moved (hover state is therefore recomputed each frame from `containsPoint`).
2. `MouseDown` for Left, then Right, if `isMouseButtonPressed` (edge: true only on the frame the button went down).
3. `MouseUp` for Left, then Right, if `isMouseButtonReleased`.
4. `Scroll` if `getScrollDelta() != 0`; only if the UI consumed it is `consumeScrollDelta()` called, otherwise the scene's `update()` can still read it for camera zoom (`:190-201`).

`InputManager` (`libs/engine/input/InputManager.h/.cpp`) is a GLFW-callback-driven state store with a four-state button machine `Up/Pressed/Down/Released` (`InputManager.h:133`); `update()` transitions Pressed->Down and Released->Up (`:291-311`), and `isMouseButtonPressed` reads the *previous* state map because `update()` runs before the scene sees the frame (`:322-330`). Consequence: a press and release inside one frame collapses to whichever callback ran last, so a very fast click can be lost, and there is at most one down and one up per button per frame. Middle button and buttons 4-8 are tracked in the state maps but never turned into `InputEvent`s.

`InputManager` also exposes optional per-event callbacks (`setKeyInputCallback`, `setCharInputCallback`, `setMouseButtonInputCallback`, `setMouseMoveInputCallback`, `setScrollInputCallback`, `InputManager.h:80-93`) that fire from inside the GLFW callbacks and can consume before chaining to a previous callback. Only the key and char ones are wired (to `FocusManager`, see section 3); the mouse ones are unused in `apps/` and `libs/` outside tests.

Dispatch then goes `SceneManager::handleInput` -> overlays (reverse push order, top first) -> `IScene::handleInput(event)` (`libs/engine/scene/SceneManager.cpp`, `Scene.h:80`). Scenes forward to their widgets by hand, in whatever order they choose (`DialogScene.cpp:147-171` gives open dialogs priority, then buttons; `GameUI::dispatchEvent`, `apps/world-sim/scenes/game/ui/GameUI.cpp:278-350`, goes dialogs -> toast stack -> minimap -> resources -> task list -> ... each followed by `if (event.isConsumed()) return true;`). There is no root UI component; the scene *is* the root and the top-level ordering is authored.

### 2.3 Propagation model

Single top-down pass, no capture/bubble (`event-system.md:235-247`: "Game UI is relatively flat", "Z-index sorting gives natural layering"). `Component::dispatchEvent` (`Component.h:338-359`):

```cpp
for (auto it = renderOrder.rbegin(); it != renderOrder.rend(); ++it) {
    if (!child->visible) continue;
    if (child->handleEvent(event)) return true;
    if (event.isConsumed()) return true;
}
return false;
```

A component signals "stop" in two ways: return `true`, or call `event.consume()`. They are almost always done together (`event.consume(); return true;`), but the distinction matters: `MouseMove` handlers routinely update hover state and return `false` without consuming so siblings also see the move (`Button.cpp:268-273`, `Menu.cpp:91-95`, `TabBar.cpp:78-82`, `TreeView.cpp:116-124`, `Toast.cpp:89-92`). Dialog in modal mode is the one that swallows moves (`Dialog.cpp:174-181`).

There is no hit-test pre-pass: `dispatchEvent` calls `handleEvent` on every visible child regardless of position, and each component does its own `containsPoint`. Nothing generic uses `IComponent::containsPoint`; it exists for components to call on themselves and for parents that embed a child by hand (Select asks its `Menu`, `Select.cpp:186-196`).

Coordinate transforms happen only in `Container::handleEvent` (content offset). Clip regions do not gate input: a child scrolled out of a `ScrollContainer`'s viewport still receives events if its own `containsPoint` succeeds in offset-space. `ScrollContainer::handleEvent` guards this partially by returning early when the event is outside its own bounds (`ScrollContainer.cpp:136-138`), except during a thumb drag.

### 2.4 Hover / pressed state machines

Button (`Button.cpp:237-279`) is the template everyone copies:

- `MouseDown` inside + Left: `state = Pressed`, `mouseDown = true`, consume.
- `MouseUp` while `mouseDown` + Left: if still inside, fire `onClick` and go to `Hover`, else `Normal`; clear `mouseDown`; consume either way (so a press-drag-out-release never leaks to something else).
- `MouseMove`: `mouseOver = containsPoint`; if not `mouseDown`, `state = mouseOver ? Hover : Normal`. Not consumed.
- Disabled or invisible: ignore everything.

`Button::State` is `{Normal, Hover, Pressed}`; `focused` and `disabled` are separate booleans, and the render precedence for the built-in variants is disabled > hover > pressed for the overlay, with the focus ring drawn additionally when focused and not disabled (`Button.cpp:193-205`). For `Type::Custom` the precedence is disabled > focused > pressed > hover > normal (`customStyleFor`, `Button.cpp:61-77`).

`ListRow` (`ListRow.h:104-136`) is the same machine with `hovered/pressed` booleans; `TabBar` (`TabBar.cpp:72-109`) tracks `m_mouseDown` and only selects on `MouseUp` over a tab; `Slider` (`Slider.cpp:246-293`) starts a drag on MouseDown (thumb hit radius 12px, or click-to-jump on the track), updates value on every MouseMove while `dragging`, and releases on MouseUp; `ScrollContainer` (`ScrollContainer.cpp:113-133`) handles thumb drag the same way, but checks the drag branches *before* the bounds check so a drag continues outside the viewport. `TextInput` uses `mouseDown` for drag-selection with a `selectionAnchor` (`TextInput.cpp:59-99`). None of them use a global pointer capture; each component that supports drag keeps its own `mouseDown/dragging` flag and relies on receiving the MouseUp because nothing above it consumed it.

### 2.5 Modal / popup capture

Nothing in the framework captures input globally; capture is done by position in the dispatch order plus component-level swallowing:

- `Dialog::handleEvent` (`Dialog.cpp:161-238`): first `Container::handleEvent(event)` so content children get priority over chrome; then in modal mode every MouseMove returns true, every MouseDown either closes (outside the panel) or is consumed, every MouseUp is consumed, and the trailing default consumes anything else. `containsPoint` returns the whole screen while open and modal (`Dialog.cpp:149-159`). Scenes place open dialogs first in their dispatch (`DialogScene.cpp:148-157`).
- `ContextMenu` (`ContextMenu.cpp:139-186`): consumes every MouseDown while open (outside = close, inside = wait for up), consumes the first MouseUp after opening via `ignoreNextMouseUp` (the release of the click that opened it), consumes MouseUp on an enabled item (select + close), and lets MouseMove through.
- `Select` and `DropdownButton` (`Select.cpp:209-278`, `DropdownButton.cpp:198-275`): a MouseDown outside both the field and the open menu closes the menu *and consumes the event*, so the click that dismisses a popup never reaches what was under it (matches native desktop behavior, differs from web). They also close on `onFocusLost`, which is how two dropdowns are made mutually exclusive: clicking one calls `FocusManager::Get().setFocus(this)`, which fires the other's `onFocusLost` (`DropdownButton.cpp:224-225`, dev-log 2025-12-27 "Focus integration for mutual exclusivity").
- `Tooltip::handleEvent` always returns false (`Tooltip.h:69`, "Never consume") and `Tooltip.test.cpp:65-74` pins it.

### 2.6 Keyboard, char, scroll, drag

Keyboard and character input never enter `InputEvent`. `Application.cpp:53-85` installs the InputManager key callback: on PRESS/REPEAT, `Tab`/`Shift+Tab` call `focusManager->focusNext()/focusPrevious()` and consume; every other key is routed via `focusManager->routeKeyInput(key, shift, ctrl, alt)` (with Cmd folded into ctrl on macOS, `:72-75`) and consumed iff something has focus. Char input goes to `routeCharInput(codepoint)`. Key repeat is delivered because GLFW `REPEAT` is accepted (`:55`). There is no key-down event delivered to unfocused components and no global hotkey table in the UI layer; scenes poll `InputManager::isKeyPressed` for gameplay keys.

Scroll: `InputEvent::scroll(pos, delta)` with GLFW's y offset; `ScrollContainer` treats `delta > 0` (wheel up) as "scroll position decreases" via `scrollBy(-delta * 40px)` (`ScrollContainer.cpp:140-148`). Only ScrollContainer handles Scroll; every other component's switch has `case Scroll: break;`.

Drag: `InputManager` tracks `dragging/dragStartPos` for the left button (`InputManager.cpp:585-597`) as a polled query for scenes (camera pan), not as UI events. UI drags are per-component as described in 2.4.

Right-click: delivered as `MouseDown/Up` with `button == Right`; `ContextMenu` does not open itself, the owning scene calls `menu.openAt(cursor, screenW, screenH)` on a right MouseDown.

---

## 3. Focus management

### 3.1 The interface

`libs/ui/focus/Focusable.h:27-68`:

```cpp
class IFocusable {
    virtual void onFocusGained() = 0;
    virtual void onFocusLost() = 0;
    virtual void handleKeyInput(engine::Key key, bool shift, bool ctrl, bool alt) = 0;
    virtual void handleCharInput(char32_t codepoint) = 0;
    virtual bool canReceiveFocus() const = 0;
};
```

Focus is a separate interface from `IComponent`; the focusable components inherit both (`class Button : public Component, public FocusableBase<Button>`). `FocusManager` stores `IFocusable*` only and has no idea where a focusable sits in the tree.

### 3.2 Registration via CRTP

`FocusableBase<Derived>` (`libs/ui/focus/FocusableBase.h:42-83`) registers `this` with `FocusManager::Get()` in its constructor (with the `tabIndex` from `Args`), unregisters in the destructor, and handles move construction/assignment by unregistering the old address and registering the new one. A moved-from object sets `focusTabIndex = -2` so its destructor skips unregistration (`:50-53, 60, 70`). Moves do not preserve focus ("acceptable because UI components are typically constructed in place", `:36-38`; dev-log 2025-12-24 records the decision). Every focusable component therefore takes `int tabIndex = -1` in its `Args`.

The components that are focusable: Button, TextInput, TabBar, Select, DropdownButton, Slider, ContextMenu, Dialog. Not focusable: ListRow, TreeView, ScrollContainer, Menu, Toast, Tooltip, and all the static primitives. That means a list of `ListRow`s cannot be keyboard-navigated and a `ScrollContainer` cannot be scrolled with keys.

### 3.3 FocusManager

`libs/ui/focus/FocusManager.h/.cpp`. State: `vector<FocusEntry{component, tabIndex}>` kept stable-sorted by tabIndex, `currentFocus`, a `vector<FocusScope{components, previousFocus}>` stack, `nextAutoTabIndex` (`FocusManager.h:147-165`).

- `registerFocusable(c, tabIndex)` (`FocusManager.cpp:31-52`): ignores duplicates with a warning; `-1` auto-assigns `nextAutoTabIndex++` (so auto indices interleave with explicit ones by value, `FocusManager.test.cpp:422-446`: explicit 0, auto 1, explicit 10, auto 2 navigates 0,1,2,10); stable sort so equal indices keep registration order.
- `unregisterFocusable` (`:54-86`): removes from the list and from every scope, nulls `currentFocus` without calling `onFocusLost()` ("the component may be in the middle of destruction ... calling virtual functions on a partially-destroyed object causes undefined behavior"), nulls any scope's `previousFocus` that pointed at it.
- `setFocus` (`:88-104`): no-op if same; `onFocusLost` on old, then `onFocusGained` on new. It does not check registration or scope membership.
- `focusNext/focusPrevious` (`:113-169`): over `getActiveFocusables()` (top scope's list if any scope, else all), from `currentIndex +/- 1` with wrap, skipping `!canReceiveFocus()`, clearing focus if nothing qualifies. With no focus, `findFocusIndex` returns -1 so Tab lands on the first entry.
- `pushFocusScope(components)` (`:171-180`) saves `currentFocus` as `previousFocus` and clears focus ("modal will set its own focus"). `popFocusScope` (`:182-205`) asserts non-empty (`EXPECT_DEATH` test at `FocusManager.test.cpp:599-604`), restores `previousFocus` if it is still registered, else clears.
- `routeKeyInput/routeCharInput` (`:207-217`) forward to `currentFocus` if any.

`FocusManager` is an application-owned singleton (`FocusManager::Get()/setInstance`), the same pattern as `InputManager`, `ClipboardManager`, `TooltipManager`. Tests instantiate one per fixture and call `setInstance(&focusManager)` in `SetUp` (`Button.test.cpp:8-14` and every other focusable test); `DropdownScene.cpp:35, 236` does the same per scene in the sandbox. `FocusManager::Get()` throws if no instance is set (`FocusManager.cpp:12-18`), so constructing any focusable component before the app wires it is a hard failure.

### 3.4 What focus does per component

| Component | onFocusGained/Lost | Keys handled | canReceiveFocus |
|---|---|---|---|
| Button (`Button.cpp:283-300`) | `focused` flag -> focus ring | Enter, Space -> `onClick` | `!disabled` |
| TextInput (`TextInput.cpp:159-256`) | reset blink; on lost clear `mouseDown` and selection | Left/Right (+Shift extend), Home/End, Delete, Backspace, Ctrl+C/X/V/A | `enabled` |
| TabBar (`TabBar.cpp:175-230`) | `m_focused` (used only to pick the `focused` TabStyle, which the Salvage render ignores) | Left/Right cycle to next enabled tab; Enter/Space re-select | any enabled tab exists |
| Select (`Select.cpp:377-426`) | lost -> `closeMenu()` | Enter/Space toggle or pick hovered; Esc close; Down opens or moves; Up moves | `visible && !disabled` |
| DropdownButton (`DropdownButton.cpp:361-411`) | lost -> `closeMenu()` | same as Select, Down when closed opens with index 0 | `visible` |
| Slider (`Slider.cpp:295-338`) | `focused` (not drawn) | Left/Down -, Right/Up +, Home min, End max; step = `step` or 1% of range | `!disabled` |
| ContextMenu (`ContextMenu.cpp:190-275`) | lost -> `close()` | Esc close; Up/Down with wrap and disabled-skip; Enter select | only while open |
| Dialog (`Dialog.cpp:384-405`) | nothing; explicitly does not close on focus lost | Esc -> `close()` while fully Open | only while Open |

Mouse focus is explicit: `TextInput`, `Select`, `DropdownButton` call `FocusManager::Get().setFocus(this)` on MouseDown; `Button` does not (clicking a button never focuses it, so the ring only appears from Tab). `ContextMenu::openAt` and `Dialog::open` take focus programmatically.

### 3.5 Focus ring visuals

There is no shared focus-ring primitive; each component draws its own:

- Button: 1px `accent_bright` border, `BorderPosition::Outside`, radius `r_sm`, only when `focused && !disabled` (`Button.cpp:200-205`).
- TextInput: border color switches from `line_hairline` to `accent` (`TextInput.cpp:535`).
- Select: border `accent` when focused, `line_edge` when open/pressed (`Select.cpp:298-304`); chevron brightens.
- DropdownButton: border `accent` when active, `accent_bright` when focused (`DropdownButton.cpp:296-301`).
- Slider, TabBar, ContextMenu, Dialog: no focus visual at all (Slider's `focusRingColor` style field is dead).

The design language's rule is `:focus-visible` only, 1px `--accent` outline at 2px offset, never on mouse (`docs/design/ui/design-language.md:70`); the C++ only approximates this because Button never focuses on click.

### 3.6 Focus trapping in dialogs

`Dialog::open` pushes a scope built from `contentFocusables` (`Dialog.cpp:68-72`) and `performCleanup` pops it (`:39-41`), but `contentFocusables` is a private member with no setter or population code anywhere in `Dialog.h/.cpp`, so it is always empty and no scope is ever pushed. The dialog *does* take focus itself (`setFocus(this)`, `:66`) so Esc works and the previously focused control loses focus. Tab while a dialog is open therefore still cycles the whole registered list (all background widgets). The focus-scope mechanism is fully implemented and tested in `FocusManager` (`FocusManager.test.cpp:452-604`) but not connected to any component. `ContextMenu` relies on focus loss instead of scopes.

### 3.7 History: why it looks like this

`docs/technical/ui-framework/focus-management.md:518-556` records the alternative rejected: colonysim's `static std::shared_ptr<Text> Text::focusedTextInput`, one component type only, no Tab. The centralized manager with an interface was chosen for value-semantics components. The 2025-12-24 dev-log ("FocusManager Simplification") records the CRTP base replacing ~60 lines of register/unregister/move boilerplate per component, and the crash it flushed out: `unregisterFocusable` used to call `onFocusLost()` and shutdown produced "Pure virtual function called!" because the derived object was already gone. Future items listed and never done: arrow-key spatial navigation, focus history, ARIA-like roles, standardized focus indicator (`focus-management.md:590-618`).

---

## 4. Layout

### 4.1 Types

`libs/ui/layout/LayoutTypes.h`, verbatim:

```cpp
enum class Direction : uint8_t { Vertical, Horizontal };
enum class SizeMode  : uint8_t { Fixed, Hug, Fill };
enum class Distribution : uint8_t { Start, Center, End, SpaceBetween, SpaceAround, SpaceEvenly };
enum class CrossAlign : uint8_t { Start, Center, End, Stretch };
struct Insets { float top, right, bottom, left; /* Insets(uniform), Insets(t,r,b,l), horizontal(), vertical() */ };
inline constexpr float kSizeKeep = -1.0F;
```

One container type, `LayoutContainer` (`libs/ui/layout/LayoutContainer.h`), "flexbox-like stack container ... there is no separate VStack/HStack" (`docs/technical/ui-framework/layout-system.md:3-5`). Args (`LayoutContainer.h:75-85`):

```cpp
struct Args {
    Foundation::Vec2 position{0,0};
    Foundation::Vec2 size{0,0};        // 0 on an axis = Hug; >0 = Fixed
    Direction direction = Vertical;
    float gap{0};
    Insets padding{};
    Distribution distribution = Start;
    CrossAlign crossAlign = Start;
    const char* id = nullptr;
    float margin{0};
};
```

Per-child sizing lives on `IComponent` (`widthMode`, `heightMode`, `fillWeight`), set after construction (`rect.widthMode = SizeMode::Fill; rect.fillWeight = 2.0F;`, `LayoutScene.cpp:131-137`) because shape `Args` do not expose them. `Text` defaults to Hug on both axes unless an explicit width/height is given (`Shapes.h:193-209`); everything else defaults to Fixed. A `LayoutContainer` maps constructed `size > 0` to Fixed and `size == 0` to Hug per axis (`LayoutContainer.cpp:53-56`); to make a container Fill inside its parent you set `widthMode/heightMode = Fill` on it before adding it.

There is no min/max size, no aspect ratio, no wrap (flex-wrap), no grid, no absolute-position child inside a flow container, no alignSelf override per child except through the `Fill`-on-cross-axis trick. The 2026-07-03 dev-log records "Figma-style Fixed/Hug/Fill, no constraint solver, no flex-wrap in v1".

### 4.2 Definite axes

The subtle part, documented at `LayoutContainer.h:30-37` and tested at `LayoutContainer.test.cpp:958-1044`: an axis is *definite* once a size has been established for it, either by construction (`size > 0`) or by any `setLayoutSize()/layout()` resolution, *including zero*. `getWidth/getHeight` (`LayoutContainer.cpp:91-105`) return the stored size on a definite axis and only measure children (hug) on a never-resolved axis. Flags `widthDefinite/heightDefinite` (`LayoutContainer.h:171-172`). This was a Copilot review catch ("Per-axis definite flags distinguish 'resolved to zero' from 'never resolved'", dev-log 2026-07-03): without it a Fill container squeezed to zero would report its hug height and push siblings.

Hug measurement: main axis = sum of visible children's main sizes + gap*(n-1) (`hugMainContent`, `:107-122`); cross axis = max visible child cross size (`hugCrossContent`, `:124-134`); both plus padding and margin in the getters.

### 4.3 The algorithm

`computeLayout()` runs lazily at the start of `render()` when `layoutDirty` (`LayoutContainer.cpp:63-69`) and is `resolveChildSizesIfDirty()` then `positionChildren()` (`:136-139`). Note this means positions are only valid after a render; tests call `layout.render()` to trigger it (`LayoutContainer.test.cpp:99-100`), and `drawRect` is a no-op with no batch renderer so this is safe headless.

**Pass 0, nested first** (`:152-160`): every visible child that is itself a `LayoutContainer` gets `resolveChildSizesIfDirty()` so its hug measurements are current.

**Pass 1, cross** (`:162-183`): `contentCross = definite ? max(sizeCross - paddingCross, 0) : hugCrossContent()`. For each visible child, if its cross-axis mode is `Fill`, or `crossAlign == Stretch` and its mode is not `Fixed`, assign `setLayoutSize(contentCross - childMargin*2)` on the cross axis. If the child is a nested container, re-resolve it immediately, "a nested container's main size can depend on its new cross size (wrapping text)".

**Pass 2, main** (`:185-221`): only on a definite main axis. `contentMain = max(sizeMain - paddingMain, 0)`. Sum `used` = main size of every non-Fill visible child plus `margin*2` of every Fill child; `totalWeight` = sum of Fill children's `max(fillWeight, 0)`. `leftover = max(contentMain - used - gap*(n-1), 0)`. Each Fill child gets `leftover * weight / totalWeight` as exact float (no rounding). On a Hug main axis this pass is skipped entirely, so Fill children keep their intrinsic size.

**Pass 3, position** (`:224-309`): `contentOrigin = position + margin + padding.topLeft`. `totalMain` = sum of visible children's main sizes (now including Fill assignments); `leftover = max(contentMain - totalMain - gaps, 0)`. Distribution:

| mode | offset before first | extra between |
|---|---|---|
| Start | 0 | 0 |
| Center | leftover/2 | 0 |
| End | leftover | 0 |
| SpaceBetween | 0 | leftover/(n-1), n>1 |
| SpaceAround | between/2 | leftover/n |
| SpaceEvenly | between | leftover/(n+1) |

`between` stacks on top of the fixed `gap` (`:307`, test `SpaceBetweenStacksWithFixedGap`). Cross position: Start/Stretch = origin; Center = `+max((contentCross - childCross)/2, 0)`; End = `+max(contentCross - childCross, 0)`. The `max(..., 0)` clamps are the "no negative offsets" rule: on overflow every mode degrades to Start and children run past the end edge (tests `OverflowDegradesToStart`, `CrossOverflowDegradesToStart`). Each child gets `setPosition(x, y)` (margin-box origin), and if it is a nested `LayoutContainer` also `layout({x, y, child->getWidth(), child->getHeight()})` so it adopts its final rect and lays out its own children.

`layout(bounds)` on a `LayoutContainer` (`:71-76`) is "a final-rect assignment": `setPosition(bounds.xy)` then `setLayoutSize(bounds.w - margin*2, bounds.h - margin*2)`, with zero-sized bounds axes passed as `kSizeKeep`. The engine passes Fixed children their own measured size back, so a container parent never overrides Fixed; an outside caller of `layout()` does (`layout-system.md:76-80`).

Key contracts the tests pin (`LayoutContainer.test.cpp`): gap grows hug size (`:565-576`); padding offsets children and grows hug size (`:600-614`); Fill child margin comes out of leftover (`:800-815`); Fill with no leftover gets 0 (`:817-829`); Stretch resizes Hug children minus margin but leaves Fixed alone at Start (`:835-864`); cross-axis Fill stretches regardless of crossAlign (`:866-878`); three-deep nesting propagates stretch (`:922-956`); a plain child's `layout()` is never called (`:513-529`); wrap-aware Fill child in a narrow column doubles its height and the Hug container grows with it (`:1055-1075`).

### 4.4 Text wrapping feeding layout

`Text::setLayoutSize(w, h)` (`Shapes.h:217-228`) stores `w` into `Text::width`, which is both the alignment box width and the wrap width. `Text::getHeight()` (`Shapes.cpp:77-86`) returns the cached measured height, computed by `ensureCacheValid()` (`Shapes.cpp:31-64`) via `fontRenderer->measureTextWithWrapping(text, scale, wordWrap && width ? *width : 0)`. Because the cross pass assigns width before the main pass measures height, a `Text{.style.wordWrap = true}` in a `CrossAlign::Stretch` column reflows and the column's hug height grows (`LayoutScene.cpp:189-207`, the "text fits" fix from dev-log 2026-07-03). Text wrapping is single-family (Roboto) because `Text` never passes a `FontFamily` to the renderer; a known follow-up.

`FontRenderer::wrapText` (`libs/ui/font/FontRenderer.cpp:448-576`) is a greedy word wrapper: `\n` is a hard break; leading spaces on continuation lines are dropped; a word that alone exceeds `maxWidth` is placed anyway (no mid-word break); result carries `lines`, `lineWidths`, `totalWidth` (max line), `totalHeight = lines * lineHeight`, and `lineHeight = atlas.lineHeight * fontSize`. Results are cached per `(family, text, scale, wrapWidth)` with 0.1px width tolerance and LRU-evicted at 4096 entries (`FontRenderer.h:300-340`). `generateWrappedGlyphQuads` (`:589-630`) applies per-line `hAlign` against `containerWidth`. Note `wrapText` ignores `letterSpacing`, so letter-spaced wrapped text would measure wrong; nothing in the tree currently wraps letter-spaced text.

### 4.5 Measurement API surface

What components use from `ui::FontRenderer` (`FontRenderer.h`):

- `MeasureText(text, scale, family, letterSpacing) -> vec2{width, lineHeight}`; width via the same `ForEachGlyph` iteration rendering uses, `'?'` fallback for missing glyphs, letter spacing between glyphs only (`FontRenderer.cpp:29-46, 110-126`; `FontRenderer.test.cpp:72-132` proves measure == rendered advance).
- `getAscent(scale, family)`, `getMaxGlyphHeight(scale, family)`.
- `wrapText`, `measureTextWithWrapping`, `generateGlyphQuads`, `generateWrappedGlyphQuads`.
- `scale` is `px / 16` everywhere (`kTextBasePx = 16`, repeated in every component file as a local `textScale()` helper).

Components measure for layout in five places: Button icon placement (`Button.cpp:138-150`, uppercase + `ls_wide` spacing), TabBar cell widths (`TabBar.cpp:334-351`), Badge/KeyCap/Divider/SegmentedControl/Stat/ProgressBar auto widths, TextInput cursor/selection x (`TextInput.cpp:728-774`, an O(n) scan measuring `substr(0,i)` for each boundary), Slider nothing (fixed label columns).

Vertical centering convention: single-line text in a box is centered on the font *ascent*, not the line height (`Shapes.cpp` render, "We use font ascent (not textSize.y) for consistent alignment ... regardless of whether the specific text contains descenders"), and `drawText` with `vAlign = Middle` and a `boxHeight` does the same. TextInput replicates it by hand (`TextInput.cpp:575-576`).

### 4.6 Absolute positioning alongside flow

Absolute positioning is the default: every component has a `position` and scenes set it in `Args`. Flow only happens inside a `LayoutContainer`, which overwrites children's positions via `setPosition`. The two coexist by nesting: a scene places a `LayoutContainer` at an absolute position and flows children inside it; a child that manages its own internals (Button's icon, Select's menu, ScrollContainer's clip) repositions those in its `setPosition` override (`Button.cpp:111-114`, `Select.cpp:181-184`, `ScrollContainer.cpp:64-70`). Popups (menus) are children of their trigger and positioned relative to it, so they follow the trigger through layout; they escape clipping only via the renderer's global z sort (section 6, Menu).

### 4.7 ScrollContainer content sizing

`ScrollContainer` (`libs/ui/components/scroll/`) is a `Container` with a viewport size and a vertical scrollbar. Content height is either set manually (`setContentHeight`) or auto-detected each render from `children[0]->getHeight()` (`ScrollContainer.cpp:77-85`), which is why the usage pattern is exactly one child, a `LayoutContainer` with fixed width and hug height (`ScrollScene.cpp:57-81`). `maxScroll = max(0, contentHeight - viewport.y)`; `scrollTo` clamps; thumb height is `viewport/content * track` floored at 20px; thumb position is `scrollY/maxScroll * (track - thumb)` (`:185-209`). There is no horizontal scrolling, no smooth scrolling (`update()` is empty with a comment), no scroll-into-view API, no nested-scroll arbitration.

Content coordinates: the child is authored at `position {0,0}` and the container's content offset translates it to `contentPos - {0, scrollY}` (`:227-229`), so children never know where the viewport is. Events get the inverse transform via `Container::handleEvent`.

---

## 5. Styling and theming

### 5.1 Pipeline: prototype -> tokens.json -> Tokens.h

The look ("Salvage") was designed in a React/Vite prototype under `docs/ui-prototype/` whose `src/design-system/tokens.css` is the single source of truth (`docs/ui-prototype/README.md:39-42, 53-56`). Three scripts in `docs/ui-prototype/scripts/` extract it:

1. `extract-tokens.mjs` parses `tokens.css`, resolves `var()` aliases, converts every color format to normalized rgba floats, and writes `docs/design/ui/design-system/tokens.json` plus `palette.svg` (dev-log 2026-06-15).
2. `gen-cpp-theme.mjs` (`docs/ui-prototype/scripts/gen-cpp-theme.mjs`) reads `tokens.json` and writes `libs/ui/theme/Tokens.h`: a flat `namespace UI` of `inline constexpr` values, snake_case names mirroring the CSS custom properties (`--space-3 -> UI::space_3`), colors as `Foundation::Color{r,g,b,a}`, z-index as `int`, everything else `float`; entries flagged `cssOnly` or `alias` are skipped (`gen-cpp-theme.mjs:44-56`). Categories emitted in order: color, spacing, radius, border, fontSize, lineHeight, letterSpacing, motion, zIndex, texture, typography.
3. `extract-icons.mjs` + `gen-icon-geometry.mjs` produce `icons.json` and `libs/ui/theme/IconGlyphs.h` (flattened 24x24 polylines per glyph, see Icon in section 6).

`tokens.json` entries look like `"accent": {"css": "#e8a33e", "rgba": [0.9098, 0.6392, 0.2431, 1]}`; css-only effects like `"ease": {"css": "cubic-bezier(0.4, 0, 0.2, 1)", "cssOnly": true}` and the multi-layer `--panel-shadow`, `--shadow-pop`, `--shadow-inset`, font stacks, and `color-mix()` blends carry no numeric value. `docs/design/ui/design-language.md:74-82` lists what "won't port literally" and how the C++ handles each: precompute `color-mix` to static rgba, approximate `box-shadow` glow with the SDF shadow, port only the opacity scalars of scanlines/grain, rebuild eases from control points, map font stacks to family roles.

The hand-maintained `theme/Theme.h` and `PanelStyle.h` that predated this were deleted in the 2026-06-18 cutover; layout constants that lived there moved into component headers as `constexpr` (`kDialogDefaultWidth`, `kTooltipHoverDelay`, `kIconDefaultSize`, ...).

### 5.2 Token categories (values in `libs/ui/theme/Tokens.h`)

- **Colors** (`Tokens.h:14-42`): surfaces `bg_void, bg_base, bg_panel, bg_panel_raised, bg_inset` (five hull tints, deepest to most raised), state washes `bg_hover` (white at 4.5%), `bg_active` (accent at 10%); lines `line_hairline` (0.10 alpha), `line_edge` (0.20), `line_strong` (0.36), all cool blue-gray not white; accent set `accent, accent_bright, accent_dim, accent_contrast, accent_glow`; data set `data, data_bright, data_dim, data_glow`; text `text_bright, text, text_dim, text_faint, text_disabled`; status `status_ok, status_warn (= accent), status_crit, status_info (= data)`; `scrim` (0.72 alpha).
- **Spacing** (`:45-59`): 4px base, `space_0_5=2, space_1=4, space_1_5=6, space_2=8, space_3=12, space_4=16, space_5=20, space_6=24, space_8=32, space_10=40, space_12=48, space_16=64, space_20=80, space_24=96`.
- **Radius** (`:62-68`): `r_0, r_xs=1, r_sm=2, r_md=4, r_lg=8, r_xl=14, r_pill=999`. Panels and UI both use `r_sm`.
- **Border widths** (`:71-74`): `bw_hair=1, bw=1, bw_thick=2`.
- **Font sizes** (`:77-87`): `fs_2xs=10, fs_xs=11, fs_sm=12, fs_base=13, fs_md=15, fs_lg=18, fs_xl=22, fs_2xl=28, fs_3xl=38, fs_4xl=52, fs_5xl=72`.
- **Line heights** (`:90-92`): `lh_tight=1.1, lh=1.4, lh_loose=1.6` (unused by C++; the font's own line height is used).
- **Letter spacing** (`:95-99`, em): `ls_tight=-0.01, ls=0, ls_wide=0.08, ls_wider=0.16, ls_widest=0.3`; consumed as `fontPx * ls_wide` pixels.
- **Motion** (`:102-104`, ms): `dur_fast=120, dur=200, dur_slow=360`. Unused by C++; components hard-code their own seconds (Dialog 0.15/0.10, Toast 0.2/0.3, Tooltip 0.1/0.08).
- **Z layers** (`:107-113`): `z_base=0, z_panel=10, z_raised=20, z_overlay=100, z_modal=200, z_toast=300, z_tooltip=400`. Also unused; components hard-code `ContextMenu zIndex=400`, `Menu zIndex=1000`, `Tooltip zIndex=500`.
- **Texture** (`:116-119`): `density=1, scanline_opacity=0.05, grain_opacity=0.04, vignette_opacity=0.55`. Not rendered by the C++ UI yet.
- **Typography** (`:122`): `title_weight=600`.

### 5.3 Variants and tone resolution

`libs/ui/theme/Variants.h` is the cross-component vocabulary:

```cpp
enum class Tone { Accent, Data, Ok, Warn, Crit, Auto, Default };
enum class Size { Sm, Md, Lg };
inline constexpr FontFamily fontDisplay = ChakraPetch;   // titles/values/labels
inline constexpr FontFamily fontUi      = Barlow;        // body/units
inline constexpr FontFamily fontMono    = JetBrainsMono; // kickers/numerics/badges/keycaps
Color toneColor(Tone, float value = 1);   // Auto: <0.25 crit, <0.5 warn, else ok
Color withAlpha(Color, float alpha);
```

`toneColor` is the only state-to-color resolution helper; `Tone::Default` returns `text`. The Auto thresholds (0.25/0.50) deliberately differ from Avatar's mood thresholds (0.30/0.55) (`components.md:285`, `Avatar.cpp:70-81`).

### 5.4 How components consume tokens

Direct constexpr reads at draw time, no style objects and no cascade. A representative Button primary render (`Button.cpp:44-59, 175-208`): `VariantStyle{fill=accent, label=accent_contrast, border=accent_bright, hasBorder, gradientFill}` chosen by `switch(type)`, drawn as one `drawRect` with `RectStyle{fill, gradient{accent_bright->accent, vertical}, border{color, bw, r_sm, Inside}}`, then a state overlay rect (`bg_void@0.45` disabled, `bg_hover` hover, `bg_void@0.22` pressed), then an `Outside` accent ring when focused, then `drawText` in `fontDisplay`, uppercase, `letterSpacing = fontPx * ls_wide`, centered in the box. Font px is derived from button height (`fontPxFor`: >=42 -> `fs_md`, >=30 -> `fs_sm`, else `fs_xs`, `Button.cpp:26-34`), the C++ stand-in for the prototype's `sm/md/lg` size prop.

The style primitives available to components (`libs/foundation/graphics/PrimitiveStyles.h`): `RectStyle{fill, optional<BorderStyle{color,width,cornerRadius,position: Inside|Center|Outside}>, optional<LinearGradient{from,to,horizontal}>, optional<BoxShadow{color,blur,spread,offset}>}`, `LineStyle{color,width}`, `CircleStyle{fill, optional border}`, `TextStyle{color,fontSize,hAlign,vAlign,wordWrap}`, `TextTransform{None,Uppercase}`. `drawText` args add `font`, `shadowColor/shadowOffset` (text-shadow), `boxWidth/boxHeight` alignment box, `letterSpacing`, `transform`, `id`, `zIndex` (`libs/renderer/primitives/Primitives.h:216-241`). Gradients are per-corner vertex colors; box shadows are an SDF falloff in the same draw (`PrimitiveStyles.h:28-45`), which is why every "glow" in the Salvage components is one `boxShadow` on the shape rather than extra geometry.

Two older style-object systems survive alongside the token-direct approach and are effectively legacy:

- `ButtonStyle`/`ButtonAppearance` (`libs/ui/components/button/ButtonStyle.h`): five `ButtonStyle{RectStyle background, textColor, fontSize, paddingX, paddingY}` for normal/hover/pressed/disabled/focused, with hard-coded blue `primary()`/`secondary()` presets, used only when `Button::Type::Custom` with a caller-supplied `ButtonAppearance*`. `ListItemStyle.h` builds a flat list-row appearance from it (`listItemNormal()/listItemSelected()` static singletons for pointer stability) and is what `ListRow` replaced.
- `TabStyle`/`TabBarAppearance` (`TabBarStyle.h`): same five-state shape plus `barBackground`, `tabSpacing`, `barPadding`. `TabBar` still carries `m_appearance` and `getTabStyle()` but its Salvage `render()` ignores every color in it and forces `barPadding = tabSpacing = 0` (`TabBar.cpp:320-324`).

State-based style resolution is therefore ad hoc per component: a handful of booleans (`hovered`, `pressed`, `focused`, `disabled`, `selected`, `open`, `active`) checked in `render()` with an explicit precedence chain. There is no `state -> style` table shared across components, no transitions (state changes snap; the prototype's `--dur-fast` hover transitions are not reproduced), and no per-instance overrides except `TextInputStyle` (`TextInput.h:38-64`, fully token-defaulted colors/padding/blink rate) and `SliderStyle` (`Slider.h:19-33`, whose colors are dead code; `Slider.cpp` reads tokens directly and only uses `style.handleRadius` for track insets).

---

## 6. Component catalog

Legend: **[tree]** = `IComponent`/`Component` subclass that lives in the tree and receives events; **[static]** = plain class with `render() const`, no hit test, drawn by the owner; **[focus]** = `FocusableBase`. Tests are `*.test.cpp` next to the source, gtest, run without a GPU (section 7.3).

### 6.1 Shapes (leaf `IComponent`s), `libs/ui/shapes/Shapes.h`

- **Rectangle** [tree]: `Args{position, size{100,100}, RectStyle style, id, zIndex, visible, margin}`. Resizable (`setLayoutSize` sets `size`). Draws one `drawRect`.
- **Circle** [tree]: `Args{center, radius{50}, CircleStyle, id, zIndex, visible, margin}`. `getWidth = 2r + 2m`; `setPosition` moves the center. Not resizable.
- **Line** [tree]: `Args{start, end, LineStyle, ...}`; `setPosition` translates both endpoints so the min corner lands at the margin-box origin. Not resizable.
- **Text** [tree]: `Args{position, optional width, optional height, text, TextStyle, id, zIndex, visible, margin}`. Hug by default; explicit width/height -> Fixed on that axis. Render modes (`Shapes.cpp` `Text::render`): wrapped (when `wordWrap && width`), bounding-box (when both width and height: align within box, vertical on ascent), point mode (legacy: position is the alignment anchor and the *baseline* for vertical). `setLayoutSize(w)` sets the wrap/box width.
- **SectionHeader** (`components/SectionHeader.h`) and **StatusTextLine** (`components/StatusTextLine.h`) are thin `Text` subclasses: SectionHeader = left/top-aligned text with `text_dim` default; StatusTextLine prefixes `"> "`/`"x "`/`"  "` and colors by `LineStatus{Active, Pending, Idle, Blocked, Available}` -> `status_ok/status_warn/text_dim/status_crit/text`. Both are consumed only by the orphaned `TaskListView` (dev-log 2026-06-18).

### 6.2 Button [tree][focus], `libs/ui/components/button/`

Args (`Button.h:33-47`):

```cpp
struct Args {
    std::string label;                       // empty = icon-only
    Vec2 position{0,0}; Vec2 size{120,40};
    Type type = Type::Primary;               // Primary, Secondary, Custom, Ghost, Danger, Data
    ButtonAppearance* customAppearance = nullptr;
    bool disabled = false;
    std::function<void()> onClick = nullptr;
    const char* id = nullptr; int tabIndex = -1; float margin{0};
    std::string iconPath;   // legacy SVG asset
    std::string iconGlyph;  // Salvage glyph name (wins over iconPath)
    float iconSize{16};
};
```

States: `State{Normal, Hover, Pressed}` + `disabled` + `focused`. Events: as in 2.4; keyboard Enter/Space fires `onClick`. Visuals per variant (`Button.cpp:44-59`): Primary = accent fill with vertical gradient `accent_bright -> accent`, border `accent_bright`, label `accent_contrast`; Secondary = transparent fill, border `line_edge`, label `text`; Ghost = no fill/border, label `text_dim`; Danger = transparent, border+label `status_crit`; Data = `data@0.12` fill, border `data`, label `data_bright`. All borders `bw` Inside with `r_sm`. Overlays: disabled `bg_void@0.45`, hover `bg_hover`, pressed `bg_void@0.22`; focus ring `accent_bright` Outside. Label: `fontDisplay`, uppercase, `ls_wide`, centered in the content box via `boxWidth/boxHeight`; size by height (26/34/46 -> `fs_xs/fs_sm/fs_md`). Icon: optional `Icon` child positioned by `updateIconPosition()` (centered if no label, else `6px` left of the measured label block), tinted to the label color each frame (`Button.cpp:210-214`). No pressed nudge (the prototype's `translateY(1px)`), no hover glow, no size prop, no iconRight/block/stencil props (compare `components.md:38-63`).

`setLabel()` exists because a consumer once mutated `label` directly and the (then child) Text stayed stale; `Button.test.cpp:22-32` pins that `setLabel` updates `renderedLabel()`. Today `label` is drawn directly so the two are the same string.

### 6.3 TextInput [tree][focus], `libs/ui/components/TextInput/`

Args (`TextInput.h:70-81`): `position, size{200,32}, text, placeholder, TextInputStyle style, tabIndex, id, enabled, margin, onChange(const string&)`. Public state: `text, placeholder, style, onChange, cursorPosition (byte offset), optional<TextSelection{start,end}> selection, cursorBlinkTimer, horizontalScroll, id, enabled, focused`.

Behavior (`TextInput.cpp`): MouseDown inside -> take focus, place cursor at nearest glyph boundary to click x, set `selectionAnchor`, clear selection, `mouseDown=true`; MouseMove while focused+mouseDown -> drag selection from anchor; MouseUp ends. Keys: Left/Right move by UTF-8 character (`foundation::UTF8::characterSize/previousCharacterSize`), Shift extends selection (anchor at first extend), Home/End, Delete/Backspace (delete selection first if any), Ctrl+C/X/V/A via `engine::ClipboardManager` (paste filters newlines/control chars and emoji ranges because the atlas lacks them, `:493-504`; char input filters the same, `:237-249`). `onChange` fires on every mutation including `setText()`. Blink: `cursorBlinkTimer` wraps at `cursorBlinkRate` (0.5s), visible in the first half; any edit or focus gain resets it. `horizontalScroll` keeps the cursor inside the padded text area and snaps to 0 when the text fits (`:776-801`).

Render (`:116-140`): background rect (border `line_hairline` -> `accent` when focused, `r_sm`, `bg_inset` fill), then `PushScissor` to the padded text area, then placeholder (only when empty and unfocused, `text_faint`) or selection rect (`accent@0.25`, z+1) + glyphs (via `FontRenderer::generateGlyphQuads` straight into the batch renderer, `fontUi`) + cursor line (`accent`, 1px, z+3, height = fontSize, centered). `containsPoint` includes the margin. No multi-line, no undo, no word navigation, no double-click select, no validator (the design doc's `charValidator` was never implemented), no password mode, no IME. Doc: `docs/technical/ui-framework/text-input.md` (note it predates the event system and shows a polling `HandleInput()`). No unit tests for TextInput itself (its contract is covered by the dev-log's manual checklist and the sandbox scene).

### 6.4 ListRow [tree], `libs/ui/components/list/ListRow.h` (header-only)

Args: `label, trailing (right-aligned mono), size{160,24}, selected, dim, indent, onClick, margin, std::string id = "list_row"`. Draws: `bg_active` wash if selected else `bg_hover` if hovered; bottom hairline; 2px `accent` left bar when selected; label `fontUi fs_sm` left at `8px + indent`, `text_bright` if selected, `text_dim` if `dim`, else `text`; trailing in `fontMono fs_xs text_dim` right-aligned. Full Button click machine, consumes down/up. `setSelected()` only; selection is owned by the parent list. Created 2026-06-18 because "Button always centers and uppercases its label, which is wrong for a list of names".

### 6.5 Panel [static], `libs/ui/components/panel/`

Args (`Panel.h:31-42`): `position, size{320,200}, title, kicker, PanelVariant{Panel, Raised, Inset}, PanelAccent{Accent, Data, None}, corners=true, compact=false, flush=false, optional<Color> glow`. Render (`Panel.cpp:80-169`): fill by variant (`bg_panel/bg_panel_raised/bg_inset`), border `line_edge` for Raised else `line_hairline`, `bw` Inside, `r_sm`; box shadow = `glow` color (blur 24, spread 2) if given, else for Raised a black@0.5 drop (blur 24, offset y 8), else none; header band (only if title or kicker) with kicker in `fontMono fs_2xs ls_wider` uppercase colored by accent, title in `fontDisplay fs_md ls_wide` uppercase `text_bright`, hairline divider under it; four L-bracket corner ticks, 12px legs, 2px thick, in the accent color (`accent`/`data`/`line_strong`). `bodyBounds()` returns the content rect below the header inset by `space_4` (`space_1_5` compact, 0 flush). Padding: header `space_3 x space_4` (`space_1_5 x space_3` compact). No scanlines, no `actions` slot, no children: a Panel is a backdrop you draw and then place widgets inside `bodyBounds()` by hand.

### 6.6 Dialog [tree][focus], `libs/ui/components/dialog/`

Args (`Dialog.h:36-44`): `title, kicker, size{600,400}, onClose, tabIndex, modal=true, footerHeight=0`. Constants: title bar 40 (58 with kicker), content padding 16, close button 28px with 6px margin, fade in 0.15s, fade out 0.10s.

State machine `Closed -> Opening -> Open -> Closing -> Closed` driven by `update(dt)` (`Dialog.cpp:240-274`); `opacity` ramps linearly; `open(screenW, screenH)` is ignored unless Closed, `close()` ignored unless Open/Opening; `isOpen()` is true during both animations; Esc closes only in `Open` (not while opening). On open: `size = screen`, `visible = true`, clip+offset set to the content rect, `setFocus(this)`, (focus scope push if `contentFocusables` non-empty, which never happens, section 3.6). `performCleanup` (pop scope, `onClose`) runs once per open/close cycle via `cleanupPerformed`, from either the close animation completing or the destructor (`:25-45`). Children are authored in content-local coordinates and clipped to the content rect; `getContentBounds()`/`getFooterBounds()` give the owner rects for placing a footer.

Render (`:276-380`): modal scrim `scrim` full-screen; panel `bg_panel_raised`, border `line_edge` `r_sm`, glow `accent@0.4` blur 24 spread 2; kicker/title like Panel; hairline under title and above footer; close button hover wash + mono "X" (`text_dim` -> `accent_bright`); accent corner brackets; then `Container::render()` for children. Everything multiplies alpha by `opacity` via a `fade()` lambda. Panel is always centered on screen; `setPosition` is ignored (`:144-147`). Dismissal: X button (on MouseUp), Esc, click outside the panel (on MouseDown, both modal and non-modal). Tests (`Dialog.test.cpp`, 18 cases): construction defaults, state transitions across animation, `onClose` fires after the close fade, second `open` ignored, opacity ramps, content bounds exclude the title bar, `containsPoint` covers the screen when open, consumes MouseDown when open, click outside starts closing, Esc via `handleKeyInput`.

Terminology fixed 2026-06-18: "a dialog is a `Dialog`; modal is a property". Prototype features not ported: sizes sm/md/lg, scale/translate pop-in, backdrop blur, scanlines, viewport-relative max size, a footer slot with right-aligned actions.

### 6.7 ScrollContainer [tree], `libs/ui/components/scroll/`

Args: `position, size{200,300}, id, margin`. API: `scrollTo/scrollBy/scrollToTop/scrollToBottom`, `getScrollPosition/getMaxScroll`, `setContentHeight/getContentHeight`, `setViewportSize`. Constants: scrollbar width 8, min thumb 20, 40px per wheel tick. Events (`ScrollContainer.cpp:113-175`): thumb drag (MouseDown on thumb, MouseMove maps `deltaY / (track - thumb) * maxScroll`, MouseUp anywhere ends and consumes), track click jumps to `clickY / track * maxScroll`, wheel consumed if inside, everything else forwarded to children through `Container::handleEvent`. Render: children under clip/offset, then (only when `maxScroll > 0`) a track `line_hairline@0.4` and a thumb `text_dim@0.5` (`accent` while dragging) inset 1.5px with `r_sm`. Tests (`ScrollContainer.test.cpp`, 17 cases): defaults, margin, max scroll computation, clamping, scrollBy, top/bottom, viewport resize re-clamps, containsPoint edges.

### 6.8 Menu [tree], `libs/ui/components/menu/`

"Dumb" list used by Select and DropdownButton (dev-log 2025-12-27, "Menu as Building Block"). Args: `position, width{150}, vector<MenuItem{label, onSelect, enabled}>, hoveredIndex{-1}, id`. Geometry: item height 30, padding `space_1` (4), height = n*30 + 8. API for parents: `setItems`, `setHoveredIndex/getHoveredIndex`, `setWidth`, `getBounds`, `getItemBounds(i)`, `getItemAtPoint`, `containsPoint`, `selectItem(i)`. Events: MouseMove updates hover (not consumed); MouseDown inside consumed without selecting; MouseUp on an enabled item selects and consumes. Render: `bg_panel_raised` with `line_edge` border `r_sm` and a drop shadow `bg_void@0.5` blur 16 offset y 6, hover wash `bg_hover` at z+1, labels `fontUi fs_sm` at `x + space_3`, vertically centered, `text_bright` hovered / `text` / `text_disabled`. Constructed with `zIndex = 1000` by both parents (`Select.cpp:40`, `DropdownButton.cpp:44`), which only works because the batch renderer now stable-sorts draw groups by z globally (dev-log 2026-06-16); before that "menus render behind other components because z-index is local context only" (dev-log 2025-12-27 known issue). No positioning logic of its own, no screen-edge awareness, no scrolling for long lists, no separators/icons/shortcuts. 26 tests.

### 6.9 ContextMenu [tree][focus], `libs/ui/components/contextmenu/`

Args: `vector<ContextMenuItem{label, onSelect, enabled}>, onClose, tabIndex`. Constants: min width 150, item height 28, padding `space_1`; `zIndex = 400`; starts `visible = false`. `openAt(pos, screenW, screenH)` clamps so the menu stays on screen: push left if `x + w > screenW`, push up if `y + h > screenH`, then `max(0, ...)` (`ContextMenu.cpp:102-124`, no flipping to the other side of the cursor), sets `ignoreNextMouseUp`, takes focus. `close()` fires `onClose`. Keyboard: Esc, Up/Down with wrap and disabled skipping (all-disabled resets to -1), Enter. Loses focus -> closes. Same visuals as Menu (duplicated code, not composed). 17 tests (`ContextMenu.test.cpp`): starts closed and invisible, click outside closes, click inside selects only after the ignored opening MouseUp, disabled items unselectable, hover index, right/bottom clamping, Esc, arrow wrap and skip, `canReceiveFocus` only when open.

### 6.10 DropdownButton [tree][focus], `libs/ui/components/dropdown/`

Args: `label, position, buttonSize{120,36}, vector<DropdownItem{label,onSelect,enabled}>, id, tabIndex, margin, openUpward`. Composes a `Menu` child (width = button width, z 1000) and an `Icon` child (12px chevron SVG, `chevron_up/down.svg`) positioned 8px from the right. `updateMenuPosition` places the menu directly below (or above when `openUpward`, using the menu's height). Click machine on the button toggles on MouseUp; MouseDown takes focus; outside click closes and consumes; menu MouseUp selects (calls `item.onSelect`, closes). `setItems({})` closes. Render: transparent fill with `line_edge` border (`accent` when open/pressed, `accent_bright` when focused), wash `bg_active` active / `bg_hover` hover, label `fontDisplay fs_sm` uppercase `ls_wide` centered in the box minus a 20px chevron gutter, chevron tinted `accent_bright` when active else `text_dim`. 17 tests: defaults, margin, open/close/toggle, no-items no-op, setItems closes when emptied, containsPoint includes the open menu, setPosition with margin, focus loss closes.

### 6.11 Select [tree][focus], `libs/ui/components/select/`

Controlled form element (dev-log 2025-12-27: "parent provides value, component fires onChange"). Args: `position, size{150,36}, vector<SelectOption{label, value}>, value, placeholder = "Select...", onChange(const string&), id, tabIndex, margin, disabled`. `setValue` does not fire `onChange`; user selection fires it only when the value changes (`Select.cpp:151-179`, tests `:219-252`). `getSelectedLabel()` falls back to the placeholder when the value matches no option. Opening highlights the current value's index. `setDisabled(true)` closes the menu and clears hover/pressed. Render: `bg_inset` field with `line_hairline` border (`accent` focused, `line_edge` active), hover wash only when closed, value text `fontUi fs_sm` left at `space_3` in `text_bright` (`text_dim` placeholder, `text_disabled` disabled), and a mono caret drawn as the literal characters `"v"`/`"^"` (`Select.cpp:356`), colored `accent_bright` when active/focused. 23 tests.

### 6.12 Slider [tree][focus], `libs/ui/components/slider/`

Args (`Slider.h:37-54`): `position, size{200,36}, double min/max/step (0 = continuous)/value, logScale, label, valueFormatter(double)->string, onChanged(double), id, tabIndex, margin, disabled, SliderStyle, double detent (normalized 0..1, <0 none)`. Math (`Slider.cpp:54-88`, exposed for tests): `positionToValue(t)` = `min * pow(max/min, t)` when `logScale && min>0 && max>0` else linear; `valueToPosition` inverse; `snapToStep` = `min + round((v-min)/step)*step` then clamp; log scale with invalid bounds falls back to linear and never produces NaN (test `:232-245`). `setValue` clamps, snaps, fires `onChanged` only on change; a reentrancy guard `inCallback` means a callback that calls `setValue` commits the value but does not re-fire (test `:257-279` documents "reentrant write wins"). Layout: with a label, a 116px label column left and 60px value column right, track between, handle radius insets the track ends. Events: down within 12px of the handle drags, elsewhere jumps then drags; move while dragging updates; keys as in 3.4. Render (`:148-239`): label `fontMono fs_sm text_dim`, value `accent_bright` right-aligned, track 4px pill `bg_inset` with hairline border, `accent` fill from left to handle, optional 2px `data@0.7` detent tick, 14px square thumb `accent_bright` with `bg_void` 1px border and an `accent@0.4` blur-8 glow (grey and glow-less when disabled). No hover scale, no focus visual. 24 tests.

### 6.13 TabBar [tree][focus], `libs/ui/components/tabbar/`

Args: `position, width{200}, vector<Tab{id, label, disabled}>, selectedId, onSelect(const string&), TabBarAppearance (ignored), id, tabIndex, margin`. If `selectedId` is missing/disabled, the first enabled tab is selected; if none, `getSelected()` is empty. Cells: width = measured uppercase label at `fs_sm` `ls_wide` + `space_3*2`, laid out flush left to right with no gap; bar height 34; `getHeight()` overrides to `m_height + margin*2`. Tab selection by MouseUp over the same tab that was pressed (any tab hit on down, `TabBar.cpp:85-106`), or Left/Right/Enter/Space when focused; `selectTabByIndex` ignores disabled and already-selected (so `onSelect` never fires for the current tab, even on Enter, `:378-381`). Render: hairline baseline under the full width, each label `fontDisplay fs_sm` uppercase `ls_wide` centered in its cell (`text_bright` active, `text_faint` disabled, else `text_dim`), 2px `accent` underline flush on the baseline for the active tab. Hover does nothing visually (`m_hoveredIndex` is tracked but unused in render). No tests.

### 6.14 SegmentedControl [static], `libs/ui/components/segmentedcontrol/`

Args: `position, width (0 = auto), segmentWidth (0 = split width or auto-fit), vector<string> options, int selected, Size, Tone{Accent|Data}`. Geometry: group padding 3, segment gap 2, segment height 28 (22 sm), label `fs_sm` (`fs_xs` sm) `fontDisplay` uppercase `ls_wide`, per-segment padding `space_3` (`space_2` sm); auto-fit uses the widest label so all segments are equal. Render: `bg_inset` well with hairline border `r_md`; the active segment is a tone-filled chip with a top-brightened vertical gradient (`brighten(tone, 0.25) -> tone`) and a `glow@0.4` box shadow blur 10 spread 1, label `accent_contrast`; inactive labels `text_dim`. `footprint()` returns the well size. Static only: no click handling, no `onChange`; the game's world-creator viz switcher wires clicks by hand.

### 6.15 Toast [tree] and ToastStack [tree], `libs/ui/components/toast/`

Toast Args: `title, message, ToastSeverity{Info, Warning, Critical}, autoDismissTime{5} (0 = persistent), iconPath (unused), onDismiss, onClick, position, width{300}, id, margin`. States `Appearing (0.2s) -> Visible -> Dismissing (0.3s) -> Finished`; `update(dt)` advances; auto-dismiss counts from Visible. Events: MouseMove tracks dismiss-button hover; MouseDown inside consumed; MouseUp on the X dismisses, elsewhere inside fires `onClick` then dismisses. Height is fixed: `12*2 + 14 + 4 + 12 = 54` (no wrapping). Render: `bg_panel_raised` card, `line_edge` border `r_sm`, severity-tinted glow (`data/status_warn/status_crit` at 0.35, blur 12), 3px severity stripe on the left, title `fontUi 14px` in the severity color, message `fontUi 12px text`, X button with hover wash, and a `[Ns]` mono countdown while visible. Alpha multiplied by opacity.

ToastStack Args: `position (anchor point), ToastAnchor{TopRight, TopLeft, BottomRight, BottomLeft}, spacing{8}, maxToasts{5}, toastWidth{300}, id`. `addToast(title, message, severity, time[, onClick])` or `addToast(Toast::Args)`; at capacity the oldest live toast is dismissed first (`ToastStack.cpp:41-50`). Bottom anchors stack upward with the newest at the anchor, top anchors downward; `repositionToasts` runs on add, on removal of finished toasts, and on `setPosition`. Each toast's `zIndex = stack.zIndex + index`. Events go newest-first; render oldest-first. `getPosition/getHeight` report the envelope of live toasts and `visible` is false while empty so the lint does not flag a zero-height root (`ToastStack.h:89-92`). `getActiveCountBySeverity` excludes dismissing toasts (used for the top-bar alert badge). 23 tests across both.

### 6.16 Tooltip [tree] and TooltipManager, `libs/ui/components/tooltip/`

`TooltipContent{title, description, hotkey}`. Tooltip Args: `content, position, maxWidth{280}`. Size is *estimated*: width = `space_3*2 + maxChars * 7px` clamped to maxWidth (`Tooltip.cpp:61-78`, `kEstimatedCharWidth = 7`), height = padding + 13 (+4+11 desc) (+4+10 hotkey). Render: `bg_panel_raised` bubble with `line_edge` border `r_sm`, a 6px pointer triangle on the top edge pointing up (because the manager floats it below-right of the cursor), title `fontUi 13 text_bright`, description `fontUi 11 text`, hotkey `fontMono 10 text_dim` in brackets. Never consumes events.

TooltipManager (singleton, `Get/setInstance`) owns the one live tooltip and a state machine `Idle -> Waiting (0.5s hover delay) -> Showing (0.1s fade) -> Visible -> Hiding (0.08s fade) -> Idle` (`TooltipManager.cpp:88-159`). API: `startHover(content, cursor)` (from Idle/Hiding starts waiting; while Showing/Visible swaps content and repositions immediately; while Waiting just updates pending content), `endHover()`, `updateCursorPosition()` (ignored under 4px of movement, `kMinCursorMoveDistance`), `setScreenBounds()`, `update(dt)`, `render()`. Positioning (`:171-194`): default `cursor + 16px` both axes; if it would overflow right, flip to `cursor.x - w - 8`; if it would overflow bottom, flip above; then clamp to `>= 0`. The tooltip is created at `zIndex = 500` "above normal UI, below dialogs". Triggering is the owner's job: the sandbox scene walks its buttons on every MouseMove and calls `startHover/updateCursorPosition/endHover` (`TooltipScene.cpp:204-240`); no component declares its own tooltip. 19 tests: title/desc/hotkey height growth, opacity, never consumes, state transitions with timing, edge flips keep it visible, cursor updates.

### 6.17 TreeView [tree], `libs/ui/components/treeview/`

Data: `TreeNode{label, optional<int> count, vector<TreeNode> children, expanded, void* userData}` owned by value. Args: `position, size{200,300} (size.y = 0 -> auto height), rowHeight{24}, indentWidth{16}, id, margin`. API: `setRootNodes`, `getRootNodes` (mutable), `expandAll/collapseAll`, `toggleNode(flatIndex)`, `setOnExpand/setOnCollapse(node&)`, `getVisibleRowCount`. A flattened row list (`FlatRow{node*, depth, index}`) is rebuilt lazily whenever `flattenDirty`. Events: hover row on MouseMove; MouseDown on the 16px chevron column of a row with children toggles it and consumes; clicks elsewhere in a row do nothing (it is "a VIEW component (no selection)"). Render: per row a bottom hairline, hover wash, a chevron drawn from two `drawLine` strokes (`v` expanded in `accent`, `>` collapsed in `text_dim`, brighter on hover), label `fontUi fs_sm` after the marker column (or `space_2` if leaf), count right-aligned `fontMono fs_xs text_dim`. Fixed-height mode culls rows outside the viewport but does not clip. 16 tests: defaults, auto height, expand/collapse counts (3 -> 6 -> 8), callbacks, leaf toggle no-op, out-of-range safe, hit bounds.

### 6.18 ProgressBar [tree], `libs/ui/components/progress/`

The C++ "Meter". Args: `position, width{200}, value{1} (0..1 clamped), Tone{Auto}, label, valueText, Size{Md}, segmented, inlineLabel, id, margin`. Non-interactive `Component` so it slots into layouts; `size` is synced to `{width, drawn height}`: track 8px (5 sm), plus `fs_xs + space_1` when a header row exists; inline variant is 18px (16 sm). Render (`ProgressBar.cpp:105-213`): stacked = optional header (label `fontMono fs_xs text_dim ls_wider` uppercase left, value in the tone color right), then a pill track `bg_inset` with hairline border and a tone fill with vertical gradient `tone -> darken(tone, 0.78)` and a `tone@0.35` blur-8 glow; segmented overlays `bg_panel` notches on a 7px segment / 2px gap rhythm; inline = `r_sm` track with a `tone@0.22` wash fill (gradient 0.30 -> 0.18), a 2px solid leading edge, and label/value drawn *inside* with a 1px `bg_void` text shadow (`drawShadowedText`) so they stay legible over fill and track. `Tone::Auto` bands by value. No fill animation (the prototype animates over `--dur-slow`). 11 tests, mostly clamping and footprint.

### 6.19 Badge [static], `libs/ui/components/badge/`

Args: `position, label, Tone{Default}, dot`. 20px tall pill (`r_sm`), width = `space_2*2 + (dot ? 6+5 : 0) + measured label` (`MeasureWidth` is public so callers can lay out rows). Fill `tone@0.14` over border `tone@0.45` (Default: `bg_panel_raised` / `line_edge`), optional 6px dot with a larger `tone@0.4` disc behind it as a faux glow, label `fontMono fs_2xs ls_wider` uppercase in the tone color. No `outline` tone, no icon (prototype has both).

### 6.20 Avatar [static], `libs/ui/components/avatar/`

Args: `position, size{44}, seed, mood{1} (0..1), hasMood{true}, selected`. Deterministic: FNV-1a 32-bit hash of the seed (`Avatar.cpp:28-35`, matching the prototype's `Math.imul` wrap), `hue = hash % 360`; disc `hsl(hue, 45%, 24%)` at radius `0.34*size`, initials (first char of the first two words, uppercased) in `fontDisplay` at `0.34*size` px in `hsl(hue, 55%, 82%)` with a 1px `bg_void` shadow copy; frame `bg_inset` with a 2px border in the mood ring color (`< 0.3 crit, < 0.55 warn, else ok`; `line_edge` and no glow when `hasMood=false`), `ring@0.4` blur-8 glow when mood is set; 5px `text_faint` L-tick top-right; selected adds a 1px `accent` outline 1px outside. The prototype's SVG silhouette and second gradient hue are not ported (`Avatar.h:9-12`).

### 6.21 Icon [tree], `libs/ui/components/icon/`

Args: `position, size{16}, svgPath, glyph (wins over svgPath), tint, strokeWidth{1.6} (in 24px space), id, margin`. Two modes: Salvage glyph from `theme/IconGlyphs.h` (generated; 51 glyph names: play pause fast veryFast plus minus close gear menu check alert info globe crosshair user users heart food water energy rest hammer box leaf search lock dice sprout mountain temp rain map home rocket star skull refresh eye clock list layers save bolt shirt pants boot, plus chevrons/arrows per `icons.md`), where filled glyphs are tessellated once and stroked glyphs are drawn per frame as `drawLine` segments plus a `drawCircle` dot at every vertex for round joins (`Icon.cpp:206-224`); or an SVG asset loaded and tessellated once, scaled to fit the square and centered (`:116-174`). `setIconSize` rebuilds without disk I/O; `setTint` is per-frame cheap. `isLoaded()` reports whether geometry exists. Sizes `kIconSmallSize=12, kIconDefaultSize=16, kIconLargeSize=24`. 11 tests (no GL: only size/tint/position/path bookkeeping).

### 6.22 KeyCap [static], `libs/ui/components/keycap/`

Args: `position, label`. 18px tall, `max(18, measured + 10)` wide; `bg_inset` body with `line_edge` border `r_sm`, a 2px `line_strong` strip along the bottom as the extruded edge, label `fontMono fs_2xs ls_wider` uppercase `text_dim` centered. `footprint()` public.

### 6.23 Divider [static], `libs/ui/components/divider/`

Args: `position, width, label`. No label: one hairline `drawLine`. Label: two hairline segments with a centered `fontMono fs_2xs ls_wider` uppercase `text_faint` caption, `space_3` gap each side, segment widths computed from the measured label.

### 6.24 Stat [static], `libs/ui/components/stat/`

Args: `position, label, value, unit, Tone{Default}, Size{Md}`. Label `fontMono fs_2xs text_dim ls_wider` uppercase on top; value below in `fontDisplay` at `fs_md/fs_xl/fs_3xl` by size, `text_bright` or the tone color; unit trails at `0.62 * valuePx` in `fontUi text_dim`, baseline-aligned by offsetting down by the size difference. No alignment prop (prototype has left/right/center), no footprint query.

### 6.25 Component composition in practice

The sandbox scenes show the authoring model: a scene owns `unique_ptr`s to top-level widgets, hand-positions them, forwards `handleInput` to each in an explicit priority order, calls `update(dt)` on each, and renders each in back-to-front order (`DialogScene.cpp`, `DropdownScene.cpp`, `ToastScene.cpp`). `LayoutContainer`s are used for rows of buttons/dropdowns (`ToastScene.cpp:58-110` adds `Button`s with `margin = 4` to a horizontal Hug container; `DropdownScene.cpp:104-153` does the same with `DropdownButton`s) and as scroll content. Static primitives are constructed as temporaries and rendered inline (`SalvageScene.cpp:91-173`). The game's `GameUI` (`apps/world-sim/scenes/game/ui/GameUI.cpp:278-350`) hand-orders dialogs, toast stack, and panels for dispatch and lists them for the lint via `getUiRoots()` (`:634-`), only including dialogs while open.

---

## 7. Debug, lint, serialization, headless tests

### 7.1 UiTreeSerializer (`libs/ui/debug/UiTreeSerializer.h/.cpp`)

Two shared geometry helpers, used by both the serializer and the lint so they agree: `uiElementBounds(e) = {e.getPosition(), e.getWidth(), e.getHeight()}` (margin box) and `uiElementChildren(e)` = `Component::getChildren()` via `dynamic_cast`, or null for leaves (`UiTreeSerializer.cpp:5-13`). `serializeUiElement` emits per node:

```json
{"id": "btn_two" | null, "type": "Button", "bounds": {"x","y","w","h"}, "margin": 0, "zIndex": 0, "visible": true, "children": [...]}
```

`serializeUiTree(roots, viewport)` wraps `{"viewport": {"width","height"}, "roots": [...]}`. Children are in insertion order, invisible elements are still emitted with `visible: false`, and the JSON dump uses `error_handler_t::replace` so a non-UTF-8 `debugId` cannot abort the frame (`:49-53`). The snapshot is served as `GET /api/ui/tree` through the `DebugServer` state handshake: the HTTP thread parks in `requestState("ui.tree")`, the app-side drain calls `serializeUiTreeJson(scene->getUiRoots(), viewport)` on the main thread after layout (`apps/ui-sandbox/Main.cpp:43-50`, `apps/world-sim/scenes/shared/UiStateDrain.cpp:38-40`, `libs/foundation/debug/DebugServer.cpp:718-719`). `IScene::getUiRoots()` (`libs/engine/scene/Scene.h:82-85`) is the hook scenes override to expose their trees. Purpose, per `docs/design/ui/ui-improvements-phase-2.md:20`: "the deterministic ground truth the linter and the agent read instead of guessing coordinates" (the alternative was only `/api/ui/screenshot`).

Limits worth noting for the port: bounds only (no computed style, no text content, no state like hovered/selected/open), no parent path in the node itself, and anything not added via `addChild` (ToastStack's toasts, Button's icon; Select's menu is added so it does show) is invisible to the snapshot.

### 7.2 LayoutLint (`libs/ui/debug/LayoutLint.h/.cpp`)

`lintUiTree(roots, viewportSize) -> LintResult{vector<LintViolation{rule, path, bounds, otherPath, otherBounds}>}`; `lintUiTreeJson` wraps it for `GET /api/ui/lint` as `{"count", "violations": [{"rule","path","bounds",("otherPath","otherBounds")}]}`. Rules (`LayoutLint.h:18-36`, implementation `LayoutLint.cpp:47-95`):

1. `sibling-overlap`: two visible siblings whose margin boxes intersect by more than 0.5px on *both* axes and have equal `zIndex`. Different zIndex = intentional layering, allowed. Touching edges are not overlap (test `:70-82`). Roots are treated as siblings of each other.
2. `child-outside-parent`: a visible child not contained in its parent's margin box, 0.5px epsilon (`containsWithEpsilon`).
3. `outside-viewport`: any visible element not contained in `{0,0,viewport}`, same epsilon.
4. `zero-or-negative-size`: visible element with `width <= 0 || height <= 0`.
5. `sibling-gap-mismatch`: reserved, never implemented ("Not implementable until LayoutContainer grows a gap property", a stale comment; the gap now exists).

Invisible elements and their entire subtrees are skipped. Paths are `id` when set, else `Type[index]`, joined with `/` from the root (`"vertical_layout/btn_two"`). Tests (`LayoutLint.test.cpp`, 11 cases) cover each rule plus the epsilon and the invisible-subtree skip, and `HugCenterContainerIsClean` regression-tests the old Hug+Center defect through the lint. The 2026-07-03 dev-log made "zero lint violations on every screen" the acceptance gate and notes "the lint caught real overlaps in every wave".

Things the lint does not check: text overflow (a Text's reported width is its measured width, so a label wider than its button is not caught unless the Text is a child), clip regions (a scrolled child outside a ScrollContainer's viewport *is* flagged as `child-outside-parent` unless the scene omits it from roots), popups (Menu at z 1000 escapes rule 1 but not rule 2 if it hangs below its parent's box).

### 7.3 Driving components without a GPU

`ui-tests` links the `ui` library and gtest (`libs/ui/CMakeLists.txt:57-84`) and never creates a window. This works because:

- Every `Renderer::Primitives::draw*` returns immediately when `g_batchRenderer == nullptr` (`libs/renderer/primitives/Primitives.cpp:273, 297, 326, 336, 402`), so `render()` can be called to trigger layout (`layout.render()` in the LayoutContainer tests) with no side effects.
- `Primitives::getFontRenderer()` returns null before initialization, and every measuring component guards it (`Button.cpp:138`, `TabBar.cpp:335`, `Badge.cpp:33`, `TextInput.cpp:737`, `Shapes.cpp` `ensureCacheValid`), yielding 0-width text. Layout tests therefore use `MockComponent`/`WrappingMockComponent` (`LayoutContainer.test.cpp:16-50`) instead of `Text` for anything size-dependent, and `TextLayoutSizeSetsWrapWidth` only checks the mode/width plumbing.
- Focusable components need a `FocusManager` instance; fixtures create one and `setInstance` it (`Button.test.cpp:8-14`).
- Time-based behavior is driven by calling `update(dt)` in loops (`Dialog.test.cpp:76-79`, `Toast.test.cpp:93-100`, `Tooltip.test.cpp:125-131`).
- Input is driven by constructing `InputEvent{.type, .position}` literals and calling `handleEvent` directly, and keys by calling `handleKeyInput(engine::Key::Down, shift, ctrl, alt)` directly (`ContextMenu.test.cpp:64-104, 185-243`).
- `FontRenderer.test.cpp` is the one GL test and `GTEST_SKIP`s when no display/atlas is available (`:26-50`).

Test counts as of the dev-logs: 288 ui tests at the June 2026 reconcile; per component: Dialog 18, ContextMenu 17, Tooltip+Manager 19, Menu 26, Select 23, DropdownButton 17, Toast+Stack 23, TreeView 16, Icon 11, Slider 24, ScrollContainer 17, ProgressBar 11, LayoutContainer ~55, FocusManager 42, LayoutLint 11, UiTreeSerializer 6, Layer 14, Button 4. TextInput, TabBar, ListRow, and every static primitive have none.

---

## 8. Design language essentials worth carrying over

Stated as portable rules with the worldsim values as defaults; swap the palette, keep the structure. Sources: `docs/design/ui/design-language.md`, `design-system/tokens.md`, `design-system/components.md`.

**Elevation.** Five surface tints from deepest to most raised (`void, base, panel, panel-raised, inset` where inset is *lower* than panel and used for wells, inputs, and tracks) plus three line weights at increasing alpha (hairline 0.10, edge 0.20, strong 0.36) in a cool tint rather than white. "Elevation is shown by tint + line weight + shadow, not by large blurs" (`design-language.md:38`). Raised surfaces get a drop shadow (`0 8px 30px black@0.55` panel; `0 14px 44px black@0.62` popup); interactive/active elements get a colored *glow* (`accent-glow` = accent at 0.45 alpha, blur 8-26px) instead of a shadow; inset surfaces get an inset shadow. Popups (Menu, ContextMenu, Tooltip) = raised tint + edge border + drop shadow; dialogs = raised tint + edge border + accent glow + corner brackets + full-screen scrim (0.72 alpha).

**Radii.** A tiny scale: 0, 1, 2, 4, 8, 14, pill. Everything structural (panels, buttons, inputs, menus, dialogs, tooltips) sits at 2px; the segmented control's well is 4px; tracks and thumbs are pills. "Roundness reads as consumer-soft" is the stated reason; a port with a different mood can raise the whole scale by re-aliasing `radius-ui`/`radius-panel`.

**Spacing.** 4px base with 2px and 6px half-steps for dense rows: 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96. Component-level conventions that fell out of it: control heights 26/34/46 (sm/md/lg buttons), 28-36 form fields, 24 list rows, 30 menu items, 28 context-menu items, 34 tab bar, 20 badges, 18 keycaps; horizontal text inset 12 (`space_3`) inside fields and menus, 8 (`space_2`) inside badges and rows; header padding `12 x 16` (compact `6 x 12`); body padding 16 (compact 6, flush 0); gaps between siblings 4-8. A global `density` multiplier on padding was designed but is unused in C++.

**Type.** Three roles, not three fonts per se: display (titles, values, control labels; uppercase + wide tracking for titles and signage), UI/body (reading text, defaults; 13px/1.4), mono (numerics, kickers, stencil labels, keycaps, dividers; uppercase + wider tracking). Scale 10, 11, 12, 13, 15, 18, 22, 28, 38, 52, 72. Tracking scale -0.01, 0, 0.08, 0.16, 0.30 em; the two rules that matter are "titles = 0.08em uppercase" and "labels/kickers = 0.16em uppercase". Weight for titles 600. Text inside a fill (inline meter labels) always gets a 1px dark text-shadow.

**Two-accent rule.** One warm accent for "interactive / your attention here / warning" and one cool accent for "read-only data / diagnostics / info"; warning shares the accent hue and info shares the data hue by design so the palette stays at two. Every other color is hull, lines, or text. Status = ok/warn/crit/info where warn and info alias the accents.

**Interaction states** (`design-language.md:66-72`): hover = surface lifts with a white 4.5% wash, accents brighten to their `-bright` variant and gain glow; active/pressed = nudge down 1px, selection fills with the accent; focus = keyboard-only (`:focus-visible`), 1px accent outline at 2px offset, never on mouse; disabled = dedicated disabled text color, no glow, no hover response (prototype: opacity 0.4); selection = accent-glow background with bright text. Component-specific: tabs mark selection with a 2px underline flush on the bar's hairline; segmented controls mark it with a filled glowing chip in an inset well; list rows with an accent wash plus a 2px left bar; selects/inputs lift the border from hairline to accent on focus.

**Motion.** Three durations: 120ms (color/border/transform on hover), 200ms (default, glow, scrim fade), 360ms (meter fills, entrances). Standard ease `cubic-bezier(0.4, 0, 0.2, 1)`, emphasized entrance ease `cubic-bezier(0.16, 1, 0.3, 1)`; dialogs pop from `scale(0.96) translateY(8px)`. "Quick and eased, never bouncy." All motion collapses under reduced-motion. The C++ implements only linear opacity fades with hard-coded seconds; the port should bind these to the tokens.

**Z layers.** base 0, panel 10, raised 20, overlay 100, modal 200, toast 300, tooltip 400. The C++ hard-codes 400/500/1000 instead; use the token ladder and give popups a real overlay layer.

**Texture (optional).** Scanlines 5%, grain 4%, vignette 0.55, holographic flicker on glowing accents, all as whispers. Corner brackets (12px legs, 2px thick, straddling the border, accent-colored) are the signature chrome on panels and dialogs and are cheap to draw as four L-shapes.

**Density-first legibility.** The HUD is the hard case: single-line rows, monospace numerics that align, tight half-step spacing; "Never style for the empty screen" (`design-language.md:15`).

---

## 9. Lessons and gotchas from the dev log and the code

Recorded decisions, rebuilds, and regrets, in rough chronological order.

1. **Concepts to interfaces** (2025-11-26 "UI Component Architecture Documentation", `architecture.md:107-138`). The first component model used C++20 concepts checked with `static_assert`; it was replaced with explicit virtual interfaces because the relationships were invisible in the class declaration. Child storage moved from `std::variant` to the arena for the same reason: "Scalability: Limited by variant types" vs "Unlimited IComponent".
2. **InputManager knows nothing about the camera or game state** (2025-11-18). The colonysim port initially carried a Camera dependency; the owner asked "Why would the input manager care about the camera at all?" and it became a pure state tracker. Same entry: `InputManager::update()` must run after `glfwPollEvents()` and before the scene sees input.
3. **Ghost selections** (2025-11-26 TextInput PR): `mouseDown` was not cleared on focus loss, so a drag that lost focus mid-way kept extending. Fix: clear `mouseDown` and the selection in `onFocusLost` (`TextInput.cpp:164-168`).
4. **Pure virtual call at shutdown** (2025-12-24): `unregisterFocusable` called `onFocusLost()` from a destructor chain. Fix: never call virtuals on a component that is unregistering; `FocusManager.test.cpp:130-145` pins that unregistering the focused component does *not* invoke `onFocusLost`. Corollary decided in the same PR: moves don't preserve focus.
5. **Z-index is local to a parent** (2025-12-27 "Known Issues": "Menus render behind other components because z-index is local context only. Proper fix requires an overlay/portal system"). The fix that actually shipped (2026-06-16) was not a portal: the `BatchRenderer` records `{indexStart, indexCount, zIndex}` per draw call and stable-sorts the groups by z at flush when any draw carried a non-zero z, so a Menu with `zIndex = 1000` nested anywhere paints above everything (`+10us` per frame always-on, `+~190us` when a popup is open, measured at 10k draw calls). Input still has no such global ordering: a popup only wins hit-testing if its owner is dispatched early enough, which is why the game hand-orders `dispatchEvent`.
6. **Magic-number text measurement** (2025-12-27): `DropdownButton` approximated label width with a constant; fixed by measuring through `FontRenderer::MeasureText` with the same transform/spacing as rendering. `TabBar.cpp:340-349` carries the surviving comment: "render() uppercases the label, so measure the uppercased form or the cell widths (and hit regions) drift from what's drawn." `Tooltip` still estimates width at 7px per character (`Tooltip.h:81`).
7. **Measurement must equal rendering** (2026-07-03): `MeasureText` and `generateGlyphQuads` were unified on one `ForEachGlyph` iteration with the same `'?'` fallback and letter-spacing rule, and `FontRenderer.test.cpp` asserts a doubled string's second copy lands exactly one measured width later. Before this, centered/right-aligned text drifted.
8. **Centered `drawText` needs an explicit `boxWidth` or it drifts right** (2026-06-18). Every centered label in the components passes `boxWidth`.
9. **Fonts: the atlas is ASCII-only** (2026-06-18, 2026-07-03). Degree, middle dot, superscripts render as fallback boxes; symbols like chevrons and the caret were switched to vector drawing ("draw them as SVGs, not glyphs"), though `Select` still draws `"v"/"^"` as text. TextInput blocks emoji code points for the same reason.
10. **Hand-maintained theme header replaced by codegen** (2026-06-15/18). `Theme.h` + `PanelStyle.h` were deleted once `Tokens.h` was generated from `tokens.json`; layout constants moved into component headers. Lesson stated in 2026-06-15: keep the single source of truth in the design tool's token file and generate, "so colors can't drift and the rgba floats are exact".
11. **Button can't be a list row** (2026-06-18): it always centers and uppercases. `ListRow` was added and the hand-rolled recipe/storage lists in the game dialogs (with manual hit-testing) were deleted. General lesson: when a widget is missing, the game code grows manual `drawRect` + hit-test code; add the primitive instead.
12. **"Modal" is a property, not a component name** (2026-06-18, `Dialog::Args::modal`).
13. **Layout engine defects pinned before fixing** (2026-07-03): characterization tests recorded that `layout(bounds)` dropped the size, that Hug+Center pushed children to negative x, and that nested containers only got a dirty flag; then the A2 engine flipped them. The definite-axis-zero rule was a review catch. Remaining known gaps in the same entry: nested `layout()` freezes a Hug container at its last measured size (a consumer resets hug axes on content change as a workaround), no window-size CLI flag for multi-resolution lint, ParameterPanel overflows at short windows because panel bodies don't scroll.
14. **Build the verification net before the thing it catches** (2026-07-03): tree snapshot and lint first, engine second, screens third. The lint found real overlaps at every step.
15. **Dialog double-cleanup and Slider reentrancy** (2025-12-27, `Slider.test.cpp:247-279`): `cleanupPerformed` and `inCallback` guards exist because destructor + animation completion, and `onChanged -> setValue`, each fired twice or recursed.
16. **ContextMenu's opening click** (`ContextMenu.h:97`): the MouseUp of the right-click that opened the menu would otherwise land on item 0 or close it; `ignoreNextMouseUp` swallows it. Same class of bug as any popup opened on MouseDown.
17. **Dropdown mutual exclusivity through focus** (2025-12-27): rather than a popup manager, opening one dropdown steals focus and the other closes in `onFocusLost`. Cheap, but it means a Select closes when you Tab away and a Dialog explicitly opts out (`Dialog.cpp:388-391`).
18. **ToastStack is invisible while empty** (`ToastStack.h:89-92`) purely to keep the lint from flagging a zero-height root; an example of the lint shaping component contracts.
19. **The orphaned TaskListView** (2026-06-18 twice): a panel whose only open path is its own close handler survived two cutovers; the recommendation was "re-wire it or delete it". Its two widgets (`SectionHeader`, `StatusTextLine`) exist only for it.
20. **Prototype-first iteration** (2026-06-15): live look iteration stays in the hot-reloading React prototype; the C++ theme is compile-time. Worth keeping in a TS port where the prototype and the product could share the token file directly.

---

## 10. Critique: what to port, what to leave, what to redesign for TypeScript

### 10.1 Essential and portable

- **The single leaf/container interface**: render, handleEvent, containsPoint, margin-box `getWidth/getHeight`, `setPosition`, optional `setLayoutSize`, `zIndex`, `visible`, `debugId/typeName`. It is small enough to be a TS interface and it is exactly the surface the layout engine, lint, and serializer need. Keep the margin-box convention and the "content renders at position + margin" rule; they are consistent across every component and every test.
- **Stable insertion order + separate z-sorted view; render back-to-front, dispatch front-to-back over the same list, stop on consume.** Simple, and the tests rely on it.
- **`Container` = clip + content offset as independent properties**, with the inverse transform applied to event positions. ScrollContainer and Dialog are both thin over it.
- **The layout engine as specified**: Fixed/Hug/Fill per axis with `fillWeight`, `Distribution` x6, `CrossAlign` x4, per-side padding, gap, three passes (cross assign -> main measure/fill -> position), definite-axis semantics including "zero is a valid resolved size", no negative offsets, nested containers re-laid-out with their final rect, cross pass before main pass so wrapping text feeds hug height. `LayoutContainer.test.cpp` is a ready-made conformance suite (every expected number is in it).
- **Focus as a separate capability** with tab index, stable ordering, `canReceiveFocus` filtering, wraparound, and scope push/pop with focus restore. The FocusManager test file is a complete spec.
- **Per-component behavior contracts** in the tests: Select's controlled-value semantics (`setValue` silent, user pick fires only on change), Slider's log/step/clamp/reentrancy math, Dialog's animation state machine and dismissal rules, ContextMenu's clamping and keyboard model, Toast lifecycle and stack capacity, TooltipManager's delay/fade/flip machine, TreeView flattening.
- **Tokens as a generated flat file from one JSON**, the tone/size variant vocabulary, `toneColor(Auto)` banding, and the elevation/interaction rules in section 8.
- **Tree snapshot + lint + `getUiRoots()`** as the AI-testability contract. In TS this is trivially a JSON walk; keep the four rules and the path naming, and add the missing ones (text overflow, clip containment, popup exemptions).

### 10.2 C++-specific, leave behind

- `MemoryArena` and `LayerHandle` generational handles: they exist to get contiguous storage and safe references without a GC. In TS, children are an array of object references; a handle is just the reference. Keep the *invariant* (never reorder the children array under callers) if you expose indices anywhere.
- The `dynamic_cast` checks for `ILayer`/`LayoutContainer`/`Component`: replace with a discriminant or optional methods on the interface.
- `FocusableBase` CRTP and the register-in-constructor lifecycle, and the throw-if-no-instance singletons (`FocusManager::Get()`, `TooltipManager::Get()`, `InputManager::Get()`). In TS, pass a `UIContext` (focus, tooltips, clipboard, fonts, viewport) down the tree or hold it on the root.
- `thread_local RenderContext` for the current z; pass z down the render call instead.
- Duplicated per-file `textScale()` helpers and `kTextBasePx = 16`; one text-metrics module.
- `const char* id` lifetime hazards (`SectionHeader.h:40`); strings are free in TS.
- `std::function` callbacks in `Args` copied around; fine, but in TS prefer event emitters or props so a parent can re-bind.
- The `ButtonAppearance`/`TabBarAppearance` five-state style objects and `ListItemStyle`: dead or nearly dead; do not port.
- Per-frame synthesized `MouseMove` from polled state and the one-down-one-up-per-frame limit of `InputManager`: in the browser you get real pointer events; deliver them as events (with `pointerId`, buttons, and timestamps) rather than re-polling.

### 10.3 Design differently for TypeScript/WebGL2

1. **Make the static primitives real components.** Panel, Badge, Stat, Avatar, KeyCap, Divider, SegmentedControl should implement the same interface as everything else so they can be laid out, linted, and hit-tested (SegmentedControl in particular needs `onChange`). Panel should be a container with `bodyBounds` as its content box and an `actions` slot.
2. **One hit-test convention.** Decide margin-box or content-box (content-box is the CSS answer; margin is not clickable) and half-open edges, and implement it once on the base class so components only override for non-rectangular shapes.
3. **Pointer capture and a real overlay layer.** Give the root an overlay stack (menus, context menus, tooltips, toasts, dialogs) that is rendered last and dispatched first, positioned in screen space by an anchoring helper (`placeRelativeTo(anchorRect, preferredSide, viewport)` with flip and clamp, generalizing `TooltipManager::calculateTooltipPosition` and `ContextMenu::calculatePosition`). Add `setPointerCapture(component)` so drags (Slider, ScrollContainer thumb, TextInput selection) do not depend on nothing above them consuming the MouseUp. Then the z=1000 hack, the hand-ordered `dispatchEvent`, and the "dropdowns close each other via focus" trick all go away.
4. **Event objects with more shape.** Add key events to the same event stream (with a focused-target route and a bubbling fallback to ancestors for Escape/Enter handling in dialogs), pointer enter/leave derived by the dispatcher (so hover state is not recomputed by every component from `containsPoint` every frame), wheel with both axes, double-click, and a `target`/`currentTarget` so parents can react after children (a light bubble phase; the "no bubbling" argument in `event-system.md:235-247` was about flat UI, and the game UI is no longer flat).
5. **Automatic layout invalidation.** Keep parent references (cheap in TS) so `invalidateLayout()` propagates up from any content change; the "call invalidateLayout on the owning container" rule is the most error-prone part of the current engine and the 2026-07-03 "Hug container freezes at last measured size" bug is a symptom.
6. **State-driven styling with transitions.** Define a per-component `visualState` (`normal|hover|pressed|focused|disabled|selected|open`) and resolve `{fill, border, text, glow}` from a small table keyed on variant x state, driven by the tokens, with `dur_fast/dur/dur_slow` tweens on color and offset. This gives the prototype's hover lifts, the 1px press nudge, meter fill animation, and dialog pop-in for free, which the C++ never got around to.
7. **Text as a first-class layout participant.** Keep the wrap-width-from-cross-pass idea, but measure through a metrics service keyed on `(family, size, letterSpacing, transform)` so uppercase/tracked labels measure the way they render (TabBar and Button had to hand-roll this), and let wrapped text honor letter spacing and font family. Measure ascent-centering the way `drawText` does; it is a good convention.
8. **Sizes as a prop, not derived from height.** Button derives font size from its height (`fontPxFor`); the design system has `sm/md/lg` sizes that set height, padding, font, and icon size (13/15/18) together. Port the prototype's mapping (`components.md:38`), and add `block`, `iconRight`, `iconOnly`, `stencil` as props since they are behaviors the C++ lacks.
9. **Focus trapping should actually work.** Derive a dialog's focusable set from its subtree at open time (walk children for focusables) rather than a never-populated `contentFocusables`, push the scope, focus the first, restore on close. Also make Button focus on click if you want `:focus-visible` semantics; track "focus came from keyboard" to decide whether to draw the ring.
10. **Tooltips declared on components.** `tooltip?: TooltipContent` on the base props, with the dispatcher's enter/leave driving the manager, instead of every owner replicating `TooltipScene.cpp:204-240`.
11. **Snapshot richer than bounds.** Include `state` (hovered, pressed, focused, selected, open, value), `text` for labels, and `clip` rects, so an agent can assert behavior, not only geometry; keep the lint rules and add text-fits and clip-containment.
12. **Keep the C++ numbers as fixtures.** Port `LayoutContainer.test.cpp`, `FocusManager.test.cpp`, `Slider.test.cpp`, `ContextMenu.test.cpp`, `Dialog.test.cpp`, `Toast.test.cpp`, `Tooltip.test.cpp`, `TreeView.test.cpp`, `LayoutLint.test.cpp` more or less line for line; they are the behavioral contract and they already run headless.

### 10.4 Things to not overthink

- The arena's 64KB cap, the 16-bit handle limits, and the "non-growable" note are engine trivia.
- Only `ClipRect` exists; rounded/circle/path clips were never built. A WebGL2 scissor plus an SDF-masked quad covers the same ground.
- The `ui-architecture-fundamentals.md` / RmlUI / NanoGUI research docs are pre-decision material; the decision was "custom retained-mode scene graph with an `.Args{}` API", which is what everything above describes.
- `data-binding.md` (ViewModel per panel, `refresh(world) -> bool changed`, `clearChildren()` + rebuild) is a sensible pattern but it is the game's concern, not the component library's; note it as the intended way to feed dynamic lists.
