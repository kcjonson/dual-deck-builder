/**
 * R13.39's comparison table, and the single-run table a baseline is committed
 * with, as pure functions over R13.38's capture files so they can be tested
 * without a browser (R13.4). `perf-capture.mjs` imports this directly; Node
 * strips the types, so only erasable TypeScript belongs here.
 *
 * The figures are read, not averaged (R13.6), with one exception that is
 * named as such: the median frame time, which is what the FPS column is
 * derived from. Each sample is one frame's snapshot, so the samples' `frame.ms`
 * values are consecutive distinct frames and their median is a frame that
 * happened. Everything windowed (p99, max, section maxima, GPU p99 and max) is
 * the last sample's window, which after the capture's settle period covers
 * exactly the sampled frames.
 *
 * Capture files from before a field existed (phase 0 has no `batcher` and a
 * GPU block of nulls) summarise with nulls, which print as n/a.
 */

interface SectionLike {
	maxMs: number | null;
}

interface SnapshotLike {
	frame?: { ms: number | null; p99Ms: number | null; maxMs: number | null } | null;
	sections?: Record<string, SectionLike | null> | null;
	gpu?: {
		ms: number | null;
		valid: boolean | null;
		latencyMs: number | null;
		source?: string | null;
		p99Ms?: number | null;
		maxMs?: number | null;
		invalidCount?: number;
	} | null;
	batcher?: {
		apiDraws: number;
		gpuDraws: number | null;
		triangles: number | null;
		flushes: Record<string, number>;
	} | null;
	renderer?: { glDrawCalls: number } | null;
	device?: { renderer: string | null } | null;
}

export interface ScenarioCaptureLike {
	scenario: string;
	samples: SnapshotLike[];
}

export interface ScenarioSummary {
	scenario: string;
	fps: number | null;
	frameMedianMs: number | null;
	frameP99Ms: number | null;
	frameMaxMs: number | null;
	updateMaxMs: number | null;
	renderMaxMs: number | null;
	flushMaxMs: number | null;
	gpuSource: string | null;
	/** Median of the valid per-frame GPU times, or of the fence latency when that is the source. */
	gpuMedianMs: number | null;
	gpuP99Ms: number | null;
	gpuMaxMs: number | null;
	gpuInvalid: number | null;
	apiDraws: number | null;
	gpuDraws: number | null;
	triangles: number | null;
	/** Non-zero flush reasons, e.g. "barrier 2, endFrame 1". */
	flushes: string | null;
	device: string | null;
}

export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function numbers(values: readonly (number | null | undefined)[]): number[] {
	return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function flushLine(flushes: Record<string, number> | undefined): string | null {
	if (!flushes) return null;
	const parts = Object.entries(flushes).filter(([, count]) => count > 0).map(([reason, count]) => `${reason} ${count}`);
	return parts.length > 0 ? parts.join(', ') : 'none';
}

export function summarizeScenario({ scenario, samples }: ScenarioCaptureLike): ScenarioSummary {
	const last = samples.length > 0 ? samples[samples.length - 1] : ({} as SnapshotLike);
	const frameMedianMs = median(numbers(samples.map((sample) => sample.frame?.ms)));
	const gpu = last.gpu ?? null;
	const gpuSource = gpu?.source ?? null;
	const gpuValues = gpuSource === 'fence'
		? numbers(samples.map((sample) => sample.gpu?.latencyMs))
		: numbers(samples.map((sample) => (sample.gpu?.valid === true ? sample.gpu.ms : null)));
	const section = (name: string): number | null => last.sections?.[name]?.maxMs ?? null;

	return {
		scenario,
		fps: frameMedianMs !== null && frameMedianMs > 0 ? 1000 / frameMedianMs : null,
		frameMedianMs,
		frameP99Ms: last.frame?.p99Ms ?? null,
		frameMaxMs: last.frame?.maxMs ?? null,
		updateMaxMs: section('update'),
		renderMaxMs: section('render'),
		flushMaxMs: section('flush'),
		gpuSource,
		gpuMedianMs: median(gpuValues),
		gpuP99Ms: gpu?.p99Ms ?? null,
		gpuMaxMs: gpu?.maxMs ?? null,
		gpuInvalid: gpu?.invalidCount ?? null,
		apiDraws: last.batcher?.apiDraws ?? null,
		gpuDraws: last.batcher?.gpuDraws ?? last.renderer?.glDrawCalls ?? null,
		triangles: last.batcher?.triangles ?? null,
		flushes: flushLine(last.batcher?.flushes),
		device: last.device?.renderer ?? null,
	};
}

function ms(value: number | null): string {
	return value === null ? 'n/a' : value.toFixed(2);
}

function count(value: number | null): string {
	return value === null ? 'n/a' : String(Math.round(value));
}

function row(cells: readonly string[]): string {
	return `| ${cells.join(' | ')} |`;
}

const SUMMARY_HEADER = [
	'Scenario', 'FPS', 'Frame median', 'Frame p99', 'Frame max', 'Update max', 'Render max', 'Flush max',
	'GPU median', 'GPU p99', 'GPU max', 'GPU invalid', 'API draws', 'GPU draws', 'Triangles', 'Flushes',
];

/** One run's table, all times in ms. */
export function summaryTable(captures: readonly ScenarioCaptureLike[]): string {
	const lines = [row(SUMMARY_HEADER), row(SUMMARY_HEADER.map(() => '---'))];
	for (const capture of captures) {
		const summary = summarizeScenario(capture);
		lines.push(row([
			summary.scenario,
			count(summary.fps),
			ms(summary.frameMedianMs),
			ms(summary.frameP99Ms),
			ms(summary.frameMaxMs),
			ms(summary.updateMaxMs),
			ms(summary.renderMaxMs),
			ms(summary.flushMaxMs),
			ms(summary.gpuSource === 'timerQuery' ? summary.gpuMedianMs : null),
			ms(summary.gpuP99Ms),
			ms(summary.gpuMaxMs),
			// R13.18's exclusions, so an n/a above reads as "all rejected" rather
			// than "not measured" when that is what happened.
			count(summary.gpuInvalid),
			count(summary.apiDraws),
			count(summary.gpuDraws),
			count(summary.triangles),
			summary.flushes ?? 'n/a',
		]));
	}
	return lines.join('\n');
}

/** "a -> b (+12%)", or just the value when the two agree or either side is missing. */
function change(before: number | null, after: number | null, format: (value: number | null) => string): string {
	if (before === null && after === null) return format(null);
	if (before === null || after === null) return `${format(before)} -> ${format(after)}`;
	if (format(before) === format(after)) return format(after);
	const percent = before === 0 ? '' : ` (${after >= before ? '+' : ''}${Math.round(((after - before) / before) * 100)}%)`;
	return `${format(before)} -> ${format(after)}${percent}`;
}

const COMPARISON_HEADER = [
	'Scenario', 'FPS', 'Frame p99', 'Update max', 'Render max', 'Flush max', 'GPU median', 'GPU p99',
	'GPU draws', 'Triangles', 'Flushes',
];

/**
 * R13.39: before and after, per scenario present in either file. A scenario
 * only one side captured still gets a row, with n/a on the other side, so a
 * renamed or dropped scenario is visible rather than silently missing.
 */
export function comparisonTable(before: readonly ScenarioCaptureLike[], after: readonly ScenarioCaptureLike[]): string {
	const names: string[] = [];
	for (const capture of [...before, ...after]) if (!names.includes(capture.scenario)) names.push(capture.scenario);
	const find = (captures: readonly ScenarioCaptureLike[], name: string) => {
		const capture = captures.find((entry) => entry.scenario === name);
		return summarizeScenario(capture ?? { scenario: name, samples: [] });
	};

	const lines = [row(COMPARISON_HEADER), row(COMPARISON_HEADER.map(() => '---'))];
	for (const name of names) {
		const a = find(before, name);
		const b = find(after, name);
		const gpuMedian = (summary: ScenarioSummary) => (summary.gpuSource === 'timerQuery' ? summary.gpuMedianMs : null);
		lines.push(row([
			name,
			change(a.fps, b.fps, count),
			change(a.frameP99Ms, b.frameP99Ms, ms),
			change(a.updateMaxMs, b.updateMaxMs, ms),
			change(a.renderMaxMs, b.renderMaxMs, ms),
			change(a.flushMaxMs, b.flushMaxMs, ms),
			change(gpuMedian(a), gpuMedian(b), ms),
			change(a.gpuP99Ms, b.gpuP99Ms, ms),
			change(a.gpuDraws, b.gpuDraws, count),
			change(a.triangles, b.triangles, count),
			a.flushes === b.flushes ? (b.flushes ?? 'n/a') : `${a.flushes ?? 'n/a'} -> ${b.flushes ?? 'n/a'}`,
		]));
	}
	return lines.join('\n');
}
