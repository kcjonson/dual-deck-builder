import { Layer } from '../components/Layer';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import type { SectionStats } from '../rendering/frameStats';
import type { GpuStats, PerfSnapshot, SectionName } from '../rendering/FrameTimer';
import type { HitchStats } from '../debug/hitchObserver';
import { RenderContext } from '../rendering/RenderContext';
import { RendererContext } from '../rendering/RendererContext';

/** Null is "not measurable here", so it prints as n/a rather than as 0 (R13.5). */
function milliseconds(value: number | null): string {
	return value === null ? 'n/a' : `${value.toFixed(1)}ms`;
}

function sectionLine(stats: SectionStats | null): string {
	if (stats === null) return 'n/a';
	return `${milliseconds(stats.ms)} (max ${milliseconds(stats.maxMs)})`;
}

/** Device strings run to a hundred characters; the overlay is about sixty wide. */
const DEVICE_CHARACTERS = 56;

/** Gap between the overlay and the viewport's top and right edges, logical pixels. */
const EDGE_MARGIN = 10;

export interface DeveloperOverlayOptions {
	/** The page's perf snapshot, the same function `window.__perf.snapshot` calls. */
	snapshot: () => PerfSnapshot;
	/** R7.11's logical viewport width, which the overlay anchors its right edge to. */
	viewportWidth: number;
}

/**
 * The perf overlay (F5), drawn through the renderer like any other layer, and
 * off until toggled so nothing it draws reaches a golden. Every figure on it
 * comes from one `PerfSnapshot`, which is the object a capture records.
 */
export class DeveloperOverlay extends Layer {
	private background: Rectangle;
	private performanceText: Text;
	private readonly snapshot: () => PerfSnapshot;
	private overlayVisible = false;
	private anchorWidth = 0;
	
	constructor({ snapshot, viewportWidth }: DeveloperOverlayOptions) {
		super({
			id: 'developer_overlay',
			x: 0,
			y: 0,
			// Seventeen lines of 14px monospace at about nineteen pixels each, and
			// the longest of them is the device line at about sixty characters.
			width: 520,
			height: 350,
		});
		
		this.snapshot = snapshot;
		
		// Semi-transparent background
		this.background = new Rectangle({
			x: 0,
			y: 0,
			width: this.getWidth(),
			height: this.getHeight(),
			style: {
				backgroundColor: '#000000',
				borderColor: '#4CAF50',
				borderWidth: 1,
			},
		});
		this.addPart(this.background);
		
		// Performance stats text
		this.performanceText = new Text('', {
			x: 10,
			y: 10,
			style: {
				fontSize: 14,
				color: '#00FF00',
				fontFamily: 'monospace',
			},
		});
		this.addPart(this.performanceText);
		
		this.viewportWidth = viewportWidth;
	}
	
	/**
	 * Whether the overlay is currently drawn. Separate from Layer.visible,
	 * which the overlay never touches.
	 */
	public get shown(): boolean {
		return this.overlayVisible;
	}

	/**
	 * Toggle visibility of the overlay
	 */
	public toggle(): void {
		this.overlayVisible = !this.overlayVisible;
	}
	
	/**
	 * Anchors the overlay to the top-right corner of a viewport this wide. The
	 * page sets it from `CanvasViewport` at construction and on every committed
	 * change (R7.11), never from `window.innerWidth`, which is the window's size
	 * rather than the canvas's and is read at no particular point in a frame.
	 */
	public get viewportWidth(): number {
		return this.anchorWidth;
	}

	public set viewportWidth(width: number) {
		this.anchorWidth = width;
		this.setPosition(width - this.getWidth() - EDGE_MARGIN, EDGE_MARGIN);
	}
	
	/**
	 * Update the overlay content
	 */
	public update(): void {
		if (!this.overlayVisible) return;
		
		// Update performance stats
		this.updatePerformanceStats();
		
		// Future: Add other debug info here
	}
	
	/**
	 * Update performance statistics display
	 */
	private updatePerformanceStats(): void {
		// The same object window.__perf.snapshot() returns, so what a person
		// reads off the overlay and what a capture records cannot disagree
		// (R13.3). The average this used to show is gone: R13.6, and worldsim's
		// 120 FPS average that hid 64 ms hitches.
		const { frame, sections, sanity, renderer, batcher, gpu, device, tracks, hitches } = this.snapshot();

		const text = [
			`FPS: ${frame.ms !== null && frame.ms > 0 ? Math.round(1000 / frame.ms) : 'n/a'}`
				+ ` (Target: ${Math.round(1000 / frame.budgetMs)})`,
			`Frame: ${milliseconds(frame.ms)} / p99 ${milliseconds(frame.p99Ms)} / max ${milliseconds(frame.maxMs)}`
				+ ` over ${frame.sampleCount} of ${frame.windowSize}`,
			// The failure mode R13.5 asks for, said to the person reading it rather
			// than left in a header: the interval carries the vsync wait, so a
			// paced run sits either side of the budget and a bare "over budget"
			// count read as 68 hitches per 120 frames on a healthy loop.
			`Spikes: ${frame.spikesOverBudget} over, ${frame.spikesOver2xBudget} over 2x (past budget +5%)`,
			'  spikes include the vsync wait; read them with the maxima',
			`Update: ${sectionLine(sections.update)}`,
			`Render: ${sectionLine(sections.render)}`,
			`Flush: ${sectionLine(sections.flush)}`,
			// 13.11's "biggest offender" line: which section owns the window's
			// worst frame, which is the question a spike count raises.
			`Worst section: ${worstSection(sections)}`,
			`Outside sections: ${milliseconds(sanity.unaccountedMs)}`,
			gpuLine(gpu),
			...hitchLines(hitches),
			`Draws: ${renderer.glDrawCalls}  Verts: ${renderer.vertices}  Text: ${renderer.textCharacters}`,
			batcherLine(batcher),
			`Device: ${truncate(device?.renderer ?? 'n/a', DEVICE_CHARACTERS)}`,
			`DevTools track: ${tracks ?? 'n/a'}`,
		].join('\n');

		this.performanceText.setText(text);
	}
	
	/**
	 * Draws the overlay as its own domain after the UI's (R3.21: the UI is the
	 * last domain before any diagnostic overlay). Submitting last is not enough
	 * inside one domain, because a domain sorts by layer first (R3.10): any
	 * screen draw pushed above `base` (a raised card, a modal, a targeting line
	 * on `overlay`) would paint over an overlay drawn at `base`. A barrier puts
	 * every screen draw, whatever its layer, beneath it. A layer would be the
	 * wrong tool: the ladder is the UI's (R3.9), and even its top rung would
	 * tie with a screen transition. The barrier only exists while the overlay is shown, so a
	 * hidden overlay leaves the frame, its GPU pass count and every golden as
	 * they were; a shown one adds one pass, which the GPU line counts.
	 */
	public render(context?: RenderContext): void {
		if (!this.overlayVisible) return;
		RendererContext.getInstance().draw.flush();
		super.render(context);
	}
}

/**
 * R13.19's degrade: GPU time where the timer query exists, otherwise the
 * fence latency labelled as what it is, otherwise n/a. Never a zero.
 */
function gpuLine(gpu: GpuStats): string {
	if (gpu.source === 'timerQuery') {
		if (gpu.ms === null) return 'GPU: waiting for results';
		const passes = gpu.passes?.length ?? 0;
		return `GPU: ${milliseconds(gpu.ms)} / p99 ${milliseconds(gpu.p99Ms)} / max ${milliseconds(gpu.maxMs)}`
			+ `  ${passes} passes${gpu.valid ? '' : ' (invalid)'}  ${gpu.invalidCount} dropped`;
	}
	if (gpu.source === 'fence') return `GPU: n/a (no timer query); latency <= ${milliseconds(gpu.latencyMs)}`;
	return 'GPU: n/a';
}

/**
 * R15.29's attribution: long frames with the script that owned the worst
 * one, and input slower than the event threshold. n/a where the runtime has
 * no such entry type (LoAF before Chromium 123, long tasks outside Chromium).
 */
export function hitchLines(hitches: HitchStats | null): string[] {
	const longFrames = hitches?.longFrames ?? null;
	const slowEvents = hitches?.slowEvents ?? null;
	const lines: string[] = [];
	if (longFrames === null) {
		lines.push('Long frames: n/a');
	} else {
		const label = longFrames.source === 'long-animation-frame' ? 'LoAF' : 'long tasks';
		lines.push(`Long frames: ${longFrames.count}`
			+ (longFrames.count > 0 ? `, max ${milliseconds(longFrames.maxMs)}, blocking ${milliseconds(longFrames.blockingMs)}` : '')
			+ ` (${label})`);
		const script = longFrames.worst?.script ?? null;
		if (script !== null) lines.push(`  worst: ${truncate(script, DEVICE_CHARACTERS)}`);
	}
	if (slowEvents === null) {
		lines.push('Slow input: n/a');
	} else if (slowEvents.worst === null) {
		lines.push(`Slow input: 0 over ${slowEvents.thresholdMs}ms`);
	} else {
		const { worst } = slowEvents;
		lines.push(`Slow input: ${slowEvents.count}, max ${milliseconds(worst.durationMs)} ${worst.name}`
			+ ` (delay ${milliseconds(worst.inputDelayMs)}, handler ${milliseconds(worst.processingMs)})`);
	}
	return lines;
}

function worstSection(sections: Record<SectionName, SectionStats | null>): string {
	let worst: { name: string; maxMs: number } | null = null;
	for (const [name, stats] of Object.entries(sections)) {
		if (stats !== null && (worst === null || stats.maxMs > worst.maxMs)) worst = { name, maxMs: stats.maxMs };
	}
	return worst === null ? 'n/a' : `${worst.name} (max ${milliseconds(worst.maxMs)})`;
}

function truncate(text: string, length: number): string {
	return text.length <= length ? text : `${text.slice(0, length - 3)}...`;
}

/**
 * R13.12's two draw counts side by side, which is the number the batcher
 * exists to move: API draw groups in, GPU draws out. The last completed
 * frame's, from the snapshot.
 */
function batcherLine(stats: PerfSnapshot['batcher']): string {
	if (stats === null) return 'Batch: n/a';
	const flushes = Object.values(stats.flushes).reduce((sum, count) => sum + count, 0);
	const splits = stats.splits ? Object.values(stats.splits).reduce((sum, count) => sum + count, 0) : 0;
	return `Batch: ${stats.apiDraws} groups -> ${stats.gpuDraws ?? 'n/a'} GPU  culled ${stats.culled}`
		+ `  flushes ${flushes}  splits ${splits}`;
}
