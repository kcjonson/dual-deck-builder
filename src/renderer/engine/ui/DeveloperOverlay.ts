import { Layer } from '../components/Layer';
import { Rectangle } from '../components/Rectangle';
import { Text } from '../components/Text';
import { PerformanceMonitor } from '../rendering/PerformanceMonitor';
import { RenderContext } from '../rendering/RenderContext';

/**
 * Developer overlay that displays debug information and performance metrics
 */
export class DeveloperOverlay extends Layer {
	private background: Rectangle;
	private performanceText: Text;
	private performanceMonitor: PerformanceMonitor;
	private overlayVisible = false;
	
	constructor(performanceMonitor: PerformanceMonitor) {
		super({
			x: 0,
			y: 0,
			width: 280,
			height: 100,
		});
		
		this.performanceMonitor = performanceMonitor;
		
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
	 * Toggle visibility of the overlay
	 */
	public toggle(): void {
		this.overlayVisible = !this.overlayVisible;
	}
	
	/**
	 * Show the overlay
	 */
	public show(): void {
		this.overlayVisible = true;
	}
	
	/**
	 * Hide the overlay
	 */
	public hide(): void {
		this.overlayVisible = false;
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
		const stats = this.performanceMonitor.getStats();
		
		// Format the stats text
		const text = [
			`FPS: ${stats.fps} (Target: 60)`,
			`Frame Time: ${stats.avgFrameTime}ms avg`,
			`  Min: ${stats.minFrameTime}ms`,
			`  Max: ${stats.maxFrameTime}ms`,
			`Draw Calls: ${stats.currentDrawCalls} (${stats.drawCallsPerFrame} avg)`,
			`Vertices: ${stats.currentVertices}`,
			`Text: ${stats.currentTextCharacters} chars`,
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