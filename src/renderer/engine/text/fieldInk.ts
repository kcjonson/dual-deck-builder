/**
 * Each face's distance-field ink of `INK_REFERENCE_TEXT` at 9 px, the first
 * size past R6.4a's threshold at ratio 1, per square pixel of font size (the
 * mean of four sub-pixel pens), by atlas basename. The raster fallback's
 * glyphs are matched to it so text keeps its weight across the switch
 * (DDB-217).
 *
 * The atlases load as images, so the field is not on the CPU to measure at
 * run time. The 6.9 web suite measures these through the shader from the
 * committed atlases and reads them from here, so an atlas rebuild that moves
 * one fails until this file moves with it. No asset imports, so Node can load
 * it.
 */
export const FIELD_INK: Readonly<Record<string, number>> = {
	'barlow-condensed-semibold': 1.91,
	'open-sans-regular': 1.698,
	'jetbrains-mono-regular': 1.9,
};
