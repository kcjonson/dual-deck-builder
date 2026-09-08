import { Layer } from '../components/Layer';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import type { SectionStats } from '../rendering/frameStats';
import { FrameTimer } from '../rendering/FrameTimer';
import { RenderContext } from '../rendering/RenderContext';

/** Null is "not measurable here", so it prints as n/a rather than as 0 (R13.5). */
function milliseconds(value: number | null): string {
	return value === null ? 'n/a' : `${value.toFixed(1)}ms`;
}

function sectionLine(stats: SectionStats | null): string {
	if (stats === null) return 'n/a';
	return `${milliseconds(stats.ms)} (max ${milliseconds(stats.maxMs)})`;
}

/**
 * Developer overlay that displays debug information and performance metrics
 */
export class DeveloperOverlay extends Layer {
	private background: Rectangle;
	private performanceText: Text;
	private frameTimer: FrameTimer;
	private overlayVisible = false;
	
	constructor(frameTimer: FrameTimer) {
		super({
			id: 'developer_overlay',
			x: 0,
			y: 0,
			// Nine lines of 14px monospace, and the longest of them is the frame
			// line at about fifty characters.
			width: 460,
			height: 190,
		});
		
		this.frameTimer = frameTimer;
		
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
		this.addChild(this.background);
		
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
		this.addChild(this.performanceText);
		
		// Position in top-right corner
		this.updatePosition();
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
	 * Update the overlay position (call on window resize)
	 */
	public updatePosition(): void {
		// Position in top-right corner with some padding
		const canvasWidth = window.innerWidth;
		this.setPosition(canvasWidth - this.getWidth() - 10, 10);
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
		const { frame, sections, sanity, renderer } = this.frameTimer.snapshot();

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
			`Outside sections: ${milliseconds(sanity.unaccountedMs)}`,
			`Draws: ${renderer.glDrawCalls}  Verts: ${renderer.vertices}  Text: ${renderer.textCharacters}`,
		].join('\n');

		this.performanceText.setText(text);
	}
	
	/**
	 * Render the overlay if visible
	 */
	public render(context?: RenderContext): void {
		if (!this.overlayVisible) return;
		super.render(context);
	}
}