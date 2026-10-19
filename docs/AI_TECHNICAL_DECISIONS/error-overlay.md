# Error overlay: failures a playtester can see

## Date
2026-10-19

## Context

DDB-538, the playtester's half of prototype-ci.md's "fail loud". Playtesting happens on the SFTP deploy of main and locally, and nobody playtesting opens the console. Before this change a failure looked like a black or frozen canvas:

- `Application.init` caught everything into `console.error`; only a `FontAtlasError` reached the screen, through `showStatusLine`.
- An exception in the frame loop, a rejected promise, or an error in an input handler reached only the console.
- `Screen.mount` caught a throwing `onMount` (and an async one's rejection) into `console.error` and left the half-built screen up. `ScreenTransition` did the same for a swap that threw, which is how every navigation after the first mounts, and the input `Dispatcher` and `DragService` did it for handlers and listeners.

The boot smoke already fails on any console error, so the console logging has to stay.

## Options considered

1. **Draw the error with the game's own renderer.**
   - Cons: the most common hard failures are WebGL ones (no WebGL2, a lost or broken context, a shader that won't compile), and a canvas that can't draw can't draw its own error either.
2. **A DOM overlay over the canvas, fed by the window's `error` and `unhandledrejection` events (chosen).**
   - Pros: works when GL is dead; catches everything uncaught without touching the code that throws; the browser still logs the error.
   - Cons: an error something catches never reaches it, so the engine's catch-and-carry-on sites need a line each.
3. **The webpack dev server's runtime overlay.**
   - Cons: development only, and playtesters run the production bundle.

## Decision

Option 2.

- **`ErrorOverlay`** (`src/renderer/engine/errors/ErrorOverlay.ts`): a modal DOM panel over a dimmed backdrop, styled through the CSSOM so a style-src CSP can't block it. It shows where the failure came from (uncaught error, unhandled rejection, or a failed start), the message, the first six stack frames with the page's own URL cut off (`main.3f2a.js:2:1234`), the build line the splash and main menu print, and a hint to send a screenshot or the copied details to whoever handed out the playtest link. Buttons: Copy details (every failure since the panel opened, the build, the page, the browser, and the time), Reload, and Close.
- The first failure since the panel opened stays up, since later ones are usually its consequences; repeats of it are counted, later failures are counted under it, and Copy details carries up to 20 distinct ones. Closing clears it, and the next failure opens it again.
- **Installed first.** `src/errorOverlay.ts` builds and installs the page's instance, and is `src/index.ts`'s first import, so it is listening before any other module evaluates and a module that throws at import time shows too. `Application.init`'s catch hands its error to `errorOverlay.report({ source: 'startup' })` after logging it; the font atlas status line is gone, since the overlay now covers every failed start. `Renderer`'s own status lines (no WebGL2, context lost) stay.
- **Nothing is swallowed.** The window listeners don't call `preventDefault`, so the browser still logs every error to the console, and the boot smoke still fails on it.
- **The catch-and-carry-on sites report to the page.** `Screen.mount` no longer catches: a throwing or rejecting `onMount` propagates. `ScreenTransition`'s swap catch, the `Dispatcher`'s per-handler catch, and `DragService`'s listener catch still keep going as they did, and also call `reportToPage` (`src/renderer/engine/errors/reportToPage.ts`), which hands the error to the platform's `reportError`: the console logs it as uncaught and the window's `error` listeners, the overlay among them, hear it. Under Jest, where Node has no `reportError`, it does nothing.
- **A frame that throws halts the loop.** `FrameLoop` stops and marks itself failed when a tick throws, from rAF, `runNow`, or `step`, then rethrows so the page sees the error once. A failed loop never starts again: a restored GL context, a released frame hold, and a resize all leave it stopped. The canvas keeps the last presented frame under the overlay, and Reload is the way back.
- The game page only. The scene gallery is a development tool and keeps its status line.
- The webpack dev server's runtime-error overlay is off (`client.overlay.runtimeErrors: false`) so it doesn't sit on top of the game's; it still reports compile errors and warnings.

## Rationale

The frame loop already ended when a tick threw, as a side effect of never re-requesting the next frame, but it still reported itself running, so `runNow` from a resize would tick into the broken state again and a context restore was a no-op only by accident. Carrying on after a frame throws would repeat the error sixty times a second, each frame running on whatever state the throw left half done (an open timer section, a half-updated screen, a GL frame begun and never flushed). A frozen frame with an explanation over it is the honest picture, and it's what a playtester can report.

An unhandled rejection or a handler that threw doesn't stop the loop: the game may well still be playable, and Close lets the playtester try, with the report already on screen to send.

## Consequences

- Production stack frames are minified (`at B.onMount (main.d63a....js:1:53389)`). The build line names the commit, and that build's source maps map a frame back.
- A screen that throws on mount through a transition leaves no screen mounted, so the canvas behind the overlay is empty; before, the half-built screen stayed up.
- An engine site that catches to keep going needs `reportToPage` to be seen; a new one added without it is quiet again.
- The modal blocks the canvas's pointer input and keeps its keys from the game's window listeners while it's up.
- The overlay text is English and plain DOM, outside the game's UI system and its theming, on purpose.
