/** Stack lines the overlay shows; Copy details carries the whole stack. */
export const SHOWN_STACK_LINES = 6;

/** Where a failure was caught, which the overlay names above the message. */
export type ErrorSource = 'startup' | 'error' | 'rejection';

const SOURCE_LABELS: Record<ErrorSource, string> = {
	startup: 'The game failed to start',
	error: 'Uncaught error',
	rejection: 'Unhandled promise rejection',
};

export interface ErrorReport {
	source: ErrorSource;
	/** E.g. "TypeError: x is undefined"; more than one line when the error's message is. */
	message: string;
	/** Stack frames without the message line, shortened (shortenFrame). */
	stack: string[];
	/** How many times this same failure was reported. */
	count: number;
}

export function sourceLabel(source: ErrorSource): string {
	return SOURCE_LABELS[source];
}

/**
 * A report from anything that can be thrown or rejected with. An Error gives
 * its name, message and stack; anything else is printed as it is, since a
 * rejection with a string or a plain object is still a failure.
 */
export function describeError({ error, source, base }: { error: unknown; source: ErrorSource; base: string }): ErrorReport {
	if (error instanceof Error) {
		const message = error.message ? `${error.name}: ${error.message}` : error.name;
		return { source, message, stack: stackFrames({ error, base }), count: 1 };
	}
	return { source, message: printValue(error), stack: [], count: 1 };
}

/**
 * A window `error` event as a report. `event.error` is the thrown value when
 * the page can see it; a cross-origin script or a browser that withholds it
 * leaves only the message and the location.
 */
export function describeErrorEvent({ event, base }: { event: ErrorEvent; base: string }): ErrorReport {
	if (event.error !== undefined && event.error !== null) return describeError({ error: event.error, source: 'error', base });
	const location = event.filename ? [shortenFrame({ frame: `at ${event.filename}:${event.lineno}:${event.colno}`, base })] : [];
	return { source: 'error', message: event.message || 'Unknown error', stack: location, count: 1 };
}

/** The same failure again: a handler that throws on every pointer move, or every frame. */
export function sameFailure(a: ErrorReport, b: ErrorReport): boolean {
	return a.source === b.source && a.message === b.message && a.stack[0] === b.stack[0];
}

/**
 * The page's own URLs and webpack's dev-build prefix cut from a frame, so a
 * production frame reads "main.3f2a.js:2:1234" rather than the deploy's full
 * address, and a dev frame "./src/...". The line and column are what matter:
 * with the build stamp they map back through that commit's source map.
 */
export function shortenFrame({ frame, base }: { frame: string; base: string }): string {
	let shortened = frame.trim();
	if (base) shortened = shortened.split(base).join('');
	return shortened.replace(/webpack-internal:\/\/\//g, '');
}

/**
 * The text Copy details puts on the clipboard: every report in full, then
 * what a bug report needs to find the build and the browser.
 */
export function formatDetails({ reports, build, page, userAgent, time }: {
	reports: readonly ErrorReport[];
	build: string;
	page: string;
	userAgent: string;
	time: string;
}): string {
	const blocks = reports.map((report) => {
		const repeated = report.count > 1 ? ` (x${report.count})` : '';
		return [`${sourceLabel(report.source)}${repeated}`, report.message, ...report.stack.map((frame) => `    ${frame}`)].join('\n');
	});
	return [...blocks, '', `Build: ${build}`, `Page: ${page}`, `Browser: ${userAgent}`, `Time: ${time}`].join('\n');
}

/**
 * V8 starts a stack with a header, "TypeError: x\n    at ...", whose name is
 * whatever the error was called when it was built (a subclass that sets its
 * name after `super` still says "Error"). Firefox and Safari start with the
 * first frame. The header comes off however many lines the message spans.
 */
function stackFrames({ error, base }: { error: Error; base: string }): string[] {
	const lines = (error.stack ?? '').split('\n');
	const headerLines = error.message.split('\n').length;
	const header = lines.slice(0, headerLines).join('\n');
	const frames = !looksLikeFrame(lines[0]) && header.endsWith(error.message) ? lines.slice(headerLines) : lines;
	return frames.map((frame) => shortenFrame({ frame, base })).filter((frame) => frame.length > 0);
}

function looksLikeFrame(line: string): boolean {
	return /^\s*at\s/.test(line) || line.includes('@') || /:\d+:\d+\)?\s*$/.test(line);
}

function printValue(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value === undefined) return 'undefined';
	try {
		const json = JSON.stringify(value);
		if (json !== undefined && json !== '{}') return json;
	} catch {
		// A cycle or a BigInt; String() below still says something.
	}
	return String(value);
}
