/**
 * Performance monitoring system for tracking rendering metrics
 */
export class PerformanceMonitor {
	// Core metrics
	private drawCallsThisFrame = 0;
	private verticesThisFrame = 0;
	private textCharactersThisFrame = 0;
	
	// Last frame metrics (for display)
	private lastFrameDrawCalls = 0;
	private lastFrameVertices = 0;
	private lastFrameTextCharacters = 0;
	
	// Frame timing
	private frameStartTime = 0;
	private frameTimes: number[] = [];
	private maxFrameHistory = 60; // Keep last 60 frames for averaging
	
	// Cumulative stats
	private totalDrawCalls = 0;
	private totalFrames = 0;
	
	/**
	 * Constructor
	 */
	constructor() {}
	
	/**
	 * Start timing a new frame
	 */
	public beginFrame(): void {
		this.frameStartTime = performance.now();
		this.drawCallsThisFrame = 0;
		this.verticesThisFrame = 0;
		this.textCharactersThisFrame = 0;
	}
	
	/**
	 * End the current frame and record timing
	 */
	public endFrame(): void {
		const frameTime = performance.now() - this.frameStartTime;
		
		// Record frame time
		this.frameTimes.push(frameTime);
		if (this.frameTimes.length > this.maxFrameHistory) {
			this.frameTimes.shift();
		}
		
		// Save this frame's metrics for display
		this.lastFrameDrawCalls = this.drawCallsThisFrame;
		this.lastFrameVertices = this.verticesThisFrame;
		this.lastFrameTextCharacters = this.textCharactersThisFrame;
		
		// Update cumulative stats
		this.totalDrawCalls += this.drawCallsThisFrame;
		this.totalFrames++;
	}
	
	/**
	 * Record a draw call
	 * @param vertexCount Number of vertices drawn
	 */
	public recordDrawCall(vertexCount: number): void {
		this.drawCallsThisFrame++;
		this.verticesThisFrame += vertexCount;
	}
	
	/**
	 * Record text being rendered
	 * @param characterCount Number of characters
	 */
	public recordTextCharacters(characterCount: number): void {
		this.textCharactersThisFrame += characterCount;
	}
	
	/**
	 * Get current performance statistics
	 */
	public getStats(): {
		fps: number;
		avgFrameTime: number;
		minFrameTime: number;
		maxFrameTime: number;
		drawCallsPerFrame: number;
		verticesPerFrame: number;
		textEfficiency: number; // Characters per text draw call
		currentDrawCalls: number;
		currentVertices: number;
		currentTextCharacters: number;
	} {
		// Calculate FPS from average frame time
		const avgFrameTime = this.frameTimes.length > 0
			? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
			: 16.67; // Default to 60 FPS
		
		const minFrameTime = this.frameTimes.length > 0
			? Math.min(...this.frameTimes)
			: 0;
			
		const maxFrameTime = this.frameTimes.length > 0
			? Math.max(...this.frameTimes)
			: 0;
		
		const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
		
		// Calculate averages
		const drawCallsPerFrame = this.totalFrames > 0
			? this.totalDrawCalls / this.totalFrames
			: 0;
		
		// Text efficiency - for now just show total characters
		// Once we implement batching, this will show chars per batch
		const textEfficiency = this.textCharactersThisFrame;
		
		return {
			fps: Math.round(fps),
			avgFrameTime: Math.round(avgFrameTime * 100) / 100,
			minFrameTime: Math.round(minFrameTime * 100) / 100,
			maxFrameTime: Math.round(maxFrameTime * 100) / 100,
			drawCallsPerFrame: Math.round(drawCallsPerFrame),
			verticesPerFrame: this.verticesThisFrame,
			textEfficiency: Math.round(textEfficiency),
			currentDrawCalls: this.lastFrameDrawCalls,
			currentVertices: this.lastFrameVertices,
			currentTextCharacters: this.lastFrameTextCharacters,
		};
	}
	
	/**
	 * Reset all statistics
	 */
	public reset(): void {
		this.frameTimes = [];
		this.totalDrawCalls = 0;
		this.totalFrames = 0;
		this.drawCallsThisFrame = 0;
		this.verticesThisFrame = 0;
		this.textCharactersThisFrame = 0;
	}
}