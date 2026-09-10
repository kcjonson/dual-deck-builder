/**
 * The font role every `drawText` in this codebase currently asks for.
 *
 * R11.8 has three roles rather than three fonts (display, body, mono) and this
 * engine has one raster: `FontAtlas`'s 32 px Arial, built in the `Renderer`
 * constructor. `body` is the role that raster fills, so components name the
 * role now and keep naming it when the other two arrive with chapter 11's
 * weight table.
 *
 * It lives here rather than on a backend so a component does not import a name
 * from the thing that draws it, and so R2.18's precondition is one constant
 * compared against itself: `LegacyGLBackend.fontAtlasNames` returns this, and
 * `Text` passes this.
 */
export const DEFAULT_FONT = 'body';
