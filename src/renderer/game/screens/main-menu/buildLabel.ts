/**
 * The main menu's build stamp, e.g. "build 142 - 2f8d7a7", or null when the
 * build carries no SHA (development builds). ASCII only: the font atlas has
 * no glyph for a middle dot.
 */
export function formatBuildLabel({ sha, number }: { sha: string | null; number: string | null }): string | null {
	if (!sha) return null;
	return number ? `build ${number} - ${sha}` : sha;
}
