/**
 * R15.29 and R15.42: the frame timer's sections drawn as a custom track in the
 * DevTools Performance panel, with the feature detection the rule's runtime
 * floor needs.
 *
 * Two spellings exist and one fallback:
 *
 * - `console.timeStamp(label, start, end, track, group, color)`, Chromium 134
 *   and newer. Near-zero cost while DevTools is not recording, which is why it
 *   can run every frame of a development build.
 * - `performance.measure(label, { start, end, detail: { devtools } })`,
 *   Chromium 128 to 133. Each measure also lands in the page's performance
 *   buffer, which user timing never trims, so it is cleared straight after:
 *   the trace event DevTools reads is emitted at the call, not from the buffer.
 * - Anything else, including Electron 25 (Chromium 114), Firefox and Safari:
 *   no track, and the snapshot reports `tracks: null` rather than pretending.
 *
 * The six-argument `timeStamp` cannot be feature-detected by calling it (an
 * old Chromium accepts the call and ignores the extra arguments) or by its
 * `length` (0 on every version), so the version is read from the user agent:
 * the `Chromium` brand where User-Agent Client Hints exist, the `Chrome/NNN`
 * token otherwise, which Electron's user agent carries too.
 */

export type TrackMode = 'console.timeStamp' | 'performance.measure';

/** DevTools' named palette for custom track entries. */
export type TrackColor =
	| 'primary' | 'primary-light' | 'primary-dark'
	| 'secondary' | 'secondary-light' | 'secondary-dark'
	| 'tertiary' | 'tertiary-light' | 'tertiary-dark'
	| 'error';

export interface TrackEmitter {
	readonly mode: TrackMode;
	/** One entry on the engine's frame track, times on the `performance.now()` timeline. */
	emit(label: string, startMs: number, endMs: number, color: TrackColor): void;
}

export const TRACK_NAME = 'Frame';
export const TRACK_GROUP = 'Engine';

/** R15.42's floors. */
export const TIMESTAMP_TRACK_CHROMIUM = 134;
export const MEASURE_TRACK_CHROMIUM = 128;

interface UserAgentBrand {
	brand: string;
	version: string;
}

export interface NavigatorLike {
	userAgent?: string;
	userAgentData?: { brands?: readonly UserAgentBrand[] };
}

/** The Chromium major version, or null for a browser that is not Chromium. */
export function chromiumMajor(navigator: NavigatorLike | undefined): number | null {
	const brand = navigator?.userAgentData?.brands?.find((entry) => entry.brand === 'Chromium');
	if (brand !== undefined) {
		const major = Number.parseInt(brand.version, 10);
		if (Number.isFinite(major)) return major;
	}
	const match = /\bChrom(?:e|ium)\/(\d+)/.exec(navigator?.userAgent ?? '');
	return match ? Number.parseInt(match[1], 10) : null;
}

export function selectTrackMode(major: number | null): TrackMode | null {
	if (major === null) return null;
	if (major >= TIMESTAMP_TRACK_CHROMIUM) return 'console.timeStamp';
	if (major >= MEASURE_TRACK_CHROMIUM) return 'performance.measure';
	return null;
}

type SixArgumentTimeStamp = (
	label: string, start: number, end: number, track: string, group: string, color: TrackColor,
) => void;

interface MeasurePerformance {
	measure(label: string, options: { start: number; end: number; detail: unknown }): unknown;
	clearMeasures(label: string): void;
}

export interface TrackEnvironment {
	navigator?: NavigatorLike;
	console?: { timeStamp?: unknown };
	performance?: Partial<MeasurePerformance>;
}

/**
 * The emitter this runtime supports, or null. The environment is an argument
 * so the selection is testable without a browser; the pages pass nothing and
 * get the globals.
 */
export function createDevToolsTracks(environment: TrackEnvironment = globalThis as TrackEnvironment): TrackEmitter | null {
	const mode = selectTrackMode(chromiumMajor(environment.navigator));

	if (mode === 'console.timeStamp' && typeof environment.console?.timeStamp === 'function') {
		const target = environment.console;
		const timeStamp = target.timeStamp as SixArgumentTimeStamp;
		return {
			mode,
			emit: (label, startMs, endMs, color) => timeStamp.call(target, label, startMs, endMs, TRACK_NAME, TRACK_GROUP, color),
		};
	}

	const performance = environment.performance;
	if (mode === 'performance.measure' && typeof performance?.measure === 'function' && typeof performance.clearMeasures === 'function') {
		const target = performance as MeasurePerformance;
		return {
			mode,
			emit: (label, startMs, endMs, color) => {
				target.measure(label, {
					start: startMs,
					end: endMs,
					detail: { devtools: { dataType: 'track-entry', track: TRACK_NAME, trackGroup: TRACK_GROUP, color } },
				});
				target.clearMeasures(label);
			},
		};
	}

	return null;
}
