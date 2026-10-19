/**
 * The main menu's build stamp, e.g. "build 142 - 2f8d7a7", or null when the
 * build carries no SHA (development builds). ASCII only: the font atlas has
 * no glyph for a middle dot.
 */
export function formatBuildLabel({ sha, number }: { sha: string | null; number: string | null }): string | null {
	if (!sha) return null;
	return number ? `build ${number} - ${sha}` : sha;
}

/**
 * The build line the splash and the menu's contents page print: the build
 * number and commit a deploy defines, or "development build" where it
 * defines neither, which keeps the screenshot baselines stable across commits.
 */
export function buildLine({ sha, number }: { sha: string | null; number: string | null }): string {
	const label = formatBuildLabel({ sha, number });
	if (!label) return 'DEVELOPMENT BUILD';
	return label.startsWith('build ') ? `BUILD ${label.slice('build '.length)}` : `BUILD ${label}`;
}
