import { mat4 } from 'gl-matrix';
import { Shader } from './Shader';
import { FontAtlas } from './FontAtlas';
import { PerformanceMonitor } from './PerformanceMonitor';
import { TextRenderer } from './TextRenderer';

/**
 * Main WebGL renderer class that abstracts WebGL operations
 */
export class Renderer {
	private canvas: HTMLCanvasElement;
	private gl: WebGLRenderingContext;
	private currentShader: Shader | null = null;
	private projectionMatrix: mat4;
	private viewMatrix: mat4;
	private fontAtlas: FontAtlas | null = null;
	private performanceMonitor: PerformanceMonitor;
	private textRenderer: TextRenderer | null = null;
	private handleResize: () => void;
	
	// Reusable buffers for performance
	private quadVertexBuffer: WebGLBuffer | null = null;
	private quadIndexBuffer: WebGLBuffer | null = null;
	private dynamicVertexBuffer: WebGLBuffer | null = null;
	private dynamicIndexBuffer: WebGLBuffer | null = null;
	private maxDynamicVertices = 1024; // Support up to 1024 vertices

	constructor(canvasId: string, performanceMonitor: PerformanceMonitor) {
		this.performanceMonitor = performanceMonitor;
		this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
		if (!this.canvas) {
			throw new Error(`Canvas element with id ${canvasId} not found`);
		}

		this.gl = this.canvas.getContext('webgl') as WebGLRenderingContext;
		if (!this.gl) {
			throw new Error('WebGL not supported by this browser');
		}

		// Initialize matrices
		this.projectionMatrix = mat4.create();
		this.viewMatrix = mat4.create();
		mat4.identity(this.viewMatrix);

		// Now that matrices are initialized, we can resize
		this.resize();
		
		// Bind resize handler - use bind to ensure consistent context
		this.handleResize = this.resize.bind(this);
		window.addEventListener('resize', this.handleResize);

		// Set default WebGL state
		this.gl.enable(this.gl.BLEND);
		this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
		this.gl.clearColor(0.0, 0.0, 0.0, 1.0);

		// Initialize font atlas with larger default size
		this.fontAtlas = new FontAtlas(this.gl, 'Arial', 32);
		
		// Initialize reusable buffers
		this.initializeBuffers();
	}
	
	/**
	 * Initialize reusable buffers for performance
	 */
	private initializeBuffers(): void {
		// Create quad buffers (used for rectangles)
		this.quadVertexBuffer = this.gl.createBuffer();
		this.quadIndexBuffer = this.gl.createBuffer();
		
		// Standard quad vertices with texture coordinates
		const quadVertices = new Float32Array([
			// Position    // TexCoord
			-1.0, -1.0,    0.0, 0.0,  // Bottom left
			 1.0, -1.0,    1.0, 0.0,  // Bottom right
			 1.0,  1.0,    1.0, 1.0,  // Top right
			-1.0,  1.0,    0.0, 1.0   // Top left
		]);
		
		// Standard quad indices
		const quadIndices = new Uint16Array([
			0, 1, 2,  // First triangle
			0, 2, 3   // Second triangle
		]);
		
		// Upload quad data
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadVertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVertices, this.gl.STATIC_DRAW);
		
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.quadIndexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, quadIndices, this.gl.STATIC_DRAW);
		
		// Create dynamic buffers for shapes with varying vertex counts
		this.dynamicVertexBuffer = this.gl.createBuffer();
		this.dynamicIndexBuffer = this.gl.createBuffer();
		
		// Pre-allocate space for dynamic buffers
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.dynamicVertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, this.maxDynamicVertices * 2 * 4, this.gl.DYNAMIC_DRAW);
		
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.dynamicIndexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, this.maxDynamicVertices * 2, this.gl.DYNAMIC_DRAW);
		
		// Unbind buffers
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
	}

	/**
	 * Resize canvas and viewport when window size changes
	 */
	private resize(): void {
		// Get the device pixel ratio (typically 1 on standard displays, 2 on retina)
		const dpr = window.devicePixelRatio || 1;
		
		// Get the display size (CSS pixels)
		const displayWidth = window.innerWidth;
		const displayHeight = window.innerHeight;
		
		// Set the internal size to include the device pixel ratio
		this.canvas.width = displayWidth * dpr;
		this.canvas.height = displayHeight * dpr;
		
		// Set the display size (CSS pixels)
		this.canvas.style.width = displayWidth + 'px';
		this.canvas.style.height = displayHeight + 'px';
		
		// Set the viewport to match the internal size
		this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

		// Update projection matrix - use display size for coordinate system
		// This ensures our coordinate system matches CSS pixels, not physical pixels
		mat4.ortho(
			this.projectionMatrix,
			0, // left
			displayWidth, // right (use display size, not canvas size)
			displayHeight, // bottom (flipped for screen coordinates)
			0, // top
			-1.0, // near
			1.0, // far
		);
		
		// Update the projection matrix in the current shader if one is active
		// This ensures the shader uses the new dimensions after resize
		if (this.currentShader) {
			this.currentShader.setMatrix4('uProjectionMatrix', this.projectionMatrix);
		}
		
	}

	/**
	 * Clear the canvas with the current clear color
	 */
	public clear(): void {
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}

	/**
	 * Use a shader program for subsequent draw calls
	 */
	public useShader(shader: Shader): void {
		if (this.currentShader !== shader) {
			shader.use();
			this.currentShader = shader;

			// Set current projection and view matrices in shader
			shader.setMatrix4('uProjectionMatrix', this.projectionMatrix);
			shader.setMatrix4('uViewMatrix', this.viewMatrix);
		}
	}

	/**
	 * Helper method to draw a textured or colored quad
	 */
	private drawQuad(
		x: number,
		y: number,
		width: number,
		height: number,
		color: [number, number, number, number],
		texture?: WebGLTexture,
		texCoords?: number[],
		strokeColor?: [number, number, number, number],
		strokeWidth?: number
	): void {
		if (!this.currentShader) {
			console.error('No shader selected');
			return;
		}


		// Center the quad at the correct position
		const centerX = x + width / 2;
		const centerY = y + height / 2;

		// Create a model matrix
		const modelMatrix = mat4.create();
		mat4.translate(modelMatrix, modelMatrix, [centerX, centerY, 0]);
		mat4.scale(modelMatrix, modelMatrix, [width / 2, height / 2, 1]);

		this.currentShader.setMatrix4('uModelMatrix', modelMatrix);
		this.currentShader.setVector4('uColor', color);

		// Set stroke parameters
		if (strokeWidth && strokeWidth > 0) {
			this.currentShader.setVector4('uStrokeColor', strokeColor || [0, 0, 0, 1]);
			this.currentShader.setFloat('uStrokeWidth', strokeWidth);
			this.currentShader.setVector2('uShapeSize', width, height);
		} else {
			this.currentShader.setFloat('uStrokeWidth', 0);
		}

		// Set texture usage
		if (texture && texCoords) {
			this.currentShader.setBool('uUseTexture', true);
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
			this.currentShader.setInt('uTexture', 0);
		} else {
			this.currentShader.setBool('uUseTexture', false);
		}
		
		// Don't set uIsText for non-text rendering to avoid shader errors

		// Always use the pre-allocated quad buffers since they now include texture coords
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadVertexBuffer);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.quadIndexBuffer);
		
		// If custom texture coordinates are provided, we need to use dynamic buffer
		if (texCoords && !(texCoords[0] === 0 && texCoords[1] === 0 && 
			texCoords[2] === 1 && texCoords[3] === 0 &&
			texCoords[4] === 1 && texCoords[5] === 1 &&
			texCoords[6] === 0 && texCoords[7] === 1)) {
			
			// For custom texture coordinates, update the dynamic buffer
			const vertices = new Float32Array([
				// Position    // TexCoord
				-1.0, -1.0,    texCoords[0], texCoords[1], // Bottom left
				 1.0, -1.0,    texCoords[2], texCoords[3], // Bottom right
				 1.0,  1.0,    texCoords[4], texCoords[5], // Top right
				-1.0,  1.0,    texCoords[6], texCoords[7], // Top left
			]);
			
			// Use dynamic buffer for custom texture coords
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.dynamicVertexBuffer);
			this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, vertices);
		}

		// Set up vertex attributes
		const positionAttribLocation = this.gl.getAttribLocation(this.currentShader.getProgram(), 'aPosition');
		const texCoordAttribLocation = this.gl.getAttribLocation(this.currentShader.getProgram(), 'aTexCoord');

		// Always use stride of 16 since we always have texture coordinates now
		const stride = 16; // 4 floats (x,y,u,v)

		// Position attribute (2 floats starting at offset 0)
		if (positionAttribLocation >= 0) {
			this.gl.enableVertexAttribArray(positionAttribLocation);
			this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, stride, 0);
		}

		// Texture coordinate attribute (2 floats starting at offset 8 bytes)
		if (texCoordAttribLocation >= 0) {
			this.gl.enableVertexAttribArray(texCoordAttribLocation);
			this.gl.vertexAttribPointer(texCoordAttribLocation, 2, this.gl.FLOAT, false, stride, 8);
		}

		// Draw the quad
		this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);
		this.performanceMonitor.recordDrawCall(4); // 4 vertices for a quad

		// Clean up vertex arrays
		if (positionAttribLocation >= 0) {
			this.gl.disableVertexAttribArray(positionAttribLocation);
		}
		if (texCoordAttribLocation >= 0) {
			this.gl.disableVertexAttribArray(texCoordAttribLocation);
		}
		
		// Don't unbind buffers - keep them bound for next draw call
		// Only unbind texture if one was used
		if (texture) {
			this.gl.bindTexture(this.gl.TEXTURE_2D, null);
		}
	}

	/**
	 * Draw a rectangle on the screen
	 */
	public drawRectangle(
		x: number,
		y: number,
		width: number,
		height: number,
		color: [number, number, number, number] = [1, 1, 1, 1],
		strokeColor?: [number, number, number, number],
		strokeWidth?: number
	): void {
		this.drawQuad(x, y, width, height, color, undefined, undefined, strokeColor, strokeWidth);
	}

	/**
	 * Draw a line between two points
	 */
	public drawLine(
		startX: number,
		startY: number,
		endX: number,
		endY: number,
		color: [number, number, number, number] = [1, 1, 1, 1],
		lineWidth = 1,
	): void {
		if (!this.currentShader) {
			console.error('No shader selected');
			return;
		}

		// Calculate line direction and length
		const dx = endX - startX;
		const dy = endY - startY;
		const length = Math.sqrt(dx * dx + dy * dy);
		const angle = Math.atan2(dy, dx);

		// Create model matrix for the line
		const modelMatrix = mat4.create();
		// For lines, use the actual coordinates without centering adjustments
		mat4.translate(modelMatrix, modelMatrix, [startX, startY, 0]);
		mat4.rotateZ(modelMatrix, modelMatrix, angle);
		mat4.scale(modelMatrix, modelMatrix, [length, lineWidth / 2, 1]);

		this.currentShader.setMatrix4('uModelMatrix', modelMatrix);
		this.currentShader.setVector4('uColor', color);

		// Use the pre-allocated quad buffers for lines (they're just thin rectangles)
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadVertexBuffer);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.quadIndexBuffer);

		// Set up vertex attributes
		const positionAttribLocation = this.gl.getAttribLocation(
			this.currentShader.getProgram(),
			'aPosition',
		);
		if (positionAttribLocation >= 0) {
			this.gl.enableVertexAttribArray(positionAttribLocation);
			this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 8, 0);
		}

		// Draw the line
		this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

		// Clean up vertex arrays only
		if (positionAttribLocation >= 0) {
			this.gl.disableVertexAttribArray(positionAttribLocation);
		}
	}

	/**
	 * Draw text on the screen using WebGL and font atlas
	 */
	public drawText(
		text: string,
		x: number,
		y: number,
		color: [number, number, number, number] = [1, 1, 1, 1],
		fontSize = 16,
		align: 'left' | 'center' | 'right' = 'left',
		baseline: 'top' | 'middle' | 'bottom' = 'top',
	): void {
		if (!this.fontAtlas) {
			console.warn('FontAtlas not initialized');
			return;
		}
		
		// Initialize text renderer if needed
		if (!this.textRenderer) {
			this.textRenderer = new TextRenderer(this.gl, this.fontAtlas, this.performanceMonitor);
		}

		// Calculate scale factor for font size
		const scale = fontSize / this.fontAtlas.getFontSize();
		
		// Measure text for alignment
		const textMetrics = this.fontAtlas.measureText(text);
		const scaledWidth = textMetrics.width * scale;
		const scaledHeight = textMetrics.height * scale;

		// Calculate starting position based on alignment
		let startX = x;
		if (align === 'center') {
			startX = x - scaledWidth / 2;
		} else if (align === 'right') {
			startX = x - scaledWidth;
		}

		// Calculate vertical position based on baseline
		let startY = y;
		if (baseline === 'middle') {
			startY = y - scaledHeight / 2;
		} else if (baseline === 'bottom') {
			startY = y - scaledHeight;
		}

		if (!this.currentShader) {
			console.error('No shader selected for text rendering');
			return;
		}
		
		// Use TextRenderer to draw text
		this.textRenderer.drawText(this.currentShader, text, startX, startY, color, fontSize);
	}

	/**
	 * Draw a circle on the screen using polygon approximation
	 */
	public drawCircle(
		x: number,
		y: number,
		radius: number,
		fillColor: [number, number, number, number] = [1, 1, 1, 1],
		strokeColor: [number, number, number, number] = [0, 0, 0, 1],
		strokeWidth = 0,
	): void {
		if (!this.currentShader) {
			console.error('No shader selected');
			return;
		}

		const segments = 32; // Number of segments to approximate the circle
		const angleStep = (2 * Math.PI) / segments;

		// Generate vertices for the circle
		const vertices: number[] = [0, 0]; // Center vertex
		for (let i = 0; i <= segments; i++) {
			const angle = i * angleStep;
			const vx = Math.cos(angle);
			const vy = Math.sin(angle);
			vertices.push(vx, vy);
		}

		// Generate indices for triangular fan
		const indices: number[] = [];
		for (let i = 1; i <= segments; i++) {
			indices.push(0, i, i + 1);
		}
		// Close the circle
		indices[indices.length - 1] = 1;

		// Create a model matrix for this circle
		const modelMatrix = mat4.create();
		mat4.translate(modelMatrix, modelMatrix, [x, y, 0]);
		mat4.scale(modelMatrix, modelMatrix, [radius, radius, 1]);

		this.currentShader.setMatrix4('uModelMatrix', modelMatrix);
		this.currentShader.setVector4('uColor', fillColor);
		this.currentShader.setBool('uUseTexture', false);

		// Use dynamic buffers for circle
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.dynamicVertexBuffer);
		this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, new Float32Array(vertices));

		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.dynamicIndexBuffer);
		this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, new Uint16Array(indices));

		// Set up vertex attributes
		const positionAttribLocation = this.gl.getAttribLocation(
			this.currentShader.getProgram(),
			'aPosition',
		);
		this.gl.enableVertexAttribArray(positionAttribLocation);
		this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 0, 0);

		// Draw the filled circle
		this.gl.drawElements(this.gl.TRIANGLES, indices.length, this.gl.UNSIGNED_SHORT, 0);
		this.performanceMonitor.recordDrawCall(vertices.length / 2); // Each vertex has 2 components (x,y)

		// Draw stroke if needed
		if (strokeWidth > 0) {
			// Generate vertices for circle outline
			const outlineVertices: number[] = [];
			for (let i = 0; i <= segments; i++) {
				const angle = i * angleStep;
				const vx = Math.cos(angle);
				const vy = Math.sin(angle);
				outlineVertices.push(vx, vy);
			}

			// Update vertex buffer with outline vertices
			this.gl.bufferData(
				this.gl.ARRAY_BUFFER,
				new Float32Array(outlineVertices),
				this.gl.STATIC_DRAW,
			);

			// Set stroke color and draw as line strip
			this.currentShader.setVector4('uColor', strokeColor);
			this.currentShader.setBool('uUseTexture', false);
			this.gl.lineWidth(strokeWidth);
			this.gl.drawArrays(this.gl.LINE_STRIP, 0, outlineVertices.length / 2);
			this.performanceMonitor.recordDrawCall(outlineVertices.length / 2);
		}

		// Clean up vertex arrays only
		this.gl.disableVertexAttribArray(positionAttribLocation);
	}

	/**
	 * Draw a triangle on the screen
	 */
	public drawTriangle(
		x: number,
		y: number,
		width: number,
		height: number,
		fillColor: [number, number, number, number] = [1, 1, 1, 1],
		strokeColor: [number, number, number, number] = [0, 0, 0, 1],
		strokeWidth = 0,
	): void {
		if (!this.currentShader) {
			console.error('No shader selected');
			return;
		}

		// Create triangle vertices (equilateral triangle pointing up)
		const vertices = new Float32Array([
			0.0,
			1.0, // Top vertex
			-1.0,
			-1.0, // Bottom left
			1.0,
			-1.0, // Bottom right
		]);

		// Create indices for drawing as triangles
		const indices = new Uint16Array([0, 1, 2]);

		// Calculate center position
		const centerX = x + width / 2;
		const centerY = y + height / 2;

		// Create a model matrix for this triangle
		const modelMatrix = mat4.create();
		mat4.translate(modelMatrix, modelMatrix, [centerX, centerY, 0]);
		mat4.scale(modelMatrix, modelMatrix, [width / 2, height / 2, 1]);

		this.currentShader.setMatrix4('uModelMatrix', modelMatrix);
		this.currentShader.setVector4('uColor', fillColor);
		this.currentShader.setBool('uUseTexture', false);

		// Use dynamic buffers for triangle
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.dynamicVertexBuffer);
		this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, vertices);

		// Bind index buffer
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.dynamicIndexBuffer);
		this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, indices);

		// Set up vertex attributes
		const positionAttribLocation = this.gl.getAttribLocation(
			this.currentShader.getProgram(),
			'aPosition',
		);
		this.gl.enableVertexAttribArray(positionAttribLocation);
		this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 0, 0);

		// Draw the filled triangle
		this.gl.drawElements(this.gl.TRIANGLES, 3, this.gl.UNSIGNED_SHORT, 0);
		this.performanceMonitor.recordDrawCall(3); // Triangle has 3 vertices

		// Draw stroke if needed
		if (strokeWidth > 0) {
			this.currentShader.setVector4('uColor', strokeColor);
			this.currentShader.setBool('uUseTexture', false);
			this.gl.lineWidth(strokeWidth);
			this.gl.drawArrays(this.gl.LINE_LOOP, 0, 3);
			this.performanceMonitor.recordDrawCall(3);
		}

		// Clean up vertex arrays only
		this.gl.disableVertexAttribArray(positionAttribLocation);
	}

	/**
	 * Draw a polygon on the screen
	 */
	public drawPolygon(
		x: number,
		y: number,
		width: number,
		height: number,
		points: [number, number][],
		fillColor: [number, number, number, number] = [1, 1, 1, 1],
		strokeColor: [number, number, number, number] = [0, 0, 0, 1],
		strokeWidth = 0,
	): void {
		if (!this.currentShader || points.length < 3) {
			console.error('Invalid polygon parameters');
			return;
		}

		// Convert normalized points to vertex array
		const vertices: number[] = [];
		for (const [px, py] of points) {
			vertices.push(px, py);
		}

		// Triangulate the polygon using ear clipping algorithm
		const indices = this.triangulatePolygon(points);

		// Calculate center position
		const centerX = x + width / 2;
		const centerY = y + height / 2;

		// Create a model matrix for this polygon
		const modelMatrix = mat4.create();
		mat4.translate(modelMatrix, modelMatrix, [centerX, centerY, 0]);
		mat4.scale(modelMatrix, modelMatrix, [width / 2, height / 2, 1]);

		this.currentShader.setMatrix4('uModelMatrix', modelMatrix);
		this.currentShader.setVector4('uColor', fillColor);
		this.currentShader.setBool('uUseTexture', false);

		// Use dynamic buffers for circle
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.dynamicVertexBuffer);
		this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, new Float32Array(vertices));

		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.dynamicIndexBuffer);
		this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, new Uint16Array(indices));

		// Set up vertex attributes
		const positionAttribLocation = this.gl.getAttribLocation(
			this.currentShader.getProgram(),
			'aPosition',
		);
		this.gl.enableVertexAttribArray(positionAttribLocation);
		this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 0, 0);

		// Draw the filled polygon
		this.gl.drawElements(this.gl.TRIANGLES, indices.length, this.gl.UNSIGNED_SHORT, 0);
		this.performanceMonitor.recordDrawCall(points.length); // Polygon vertices

		// Draw stroke if needed
		if (strokeWidth > 0) {
			this.currentShader.setVector4('uColor', strokeColor);
			this.currentShader.setBool('uUseTexture', false);
			this.gl.lineWidth(strokeWidth);
			this.gl.drawArrays(this.gl.LINE_LOOP, 0, points.length);
			this.performanceMonitor.recordDrawCall(points.length);
		}

		// Clean up vertex arrays only
		this.gl.disableVertexAttribArray(positionAttribLocation);
	}

	/**
	 * Simple ear clipping triangulation for convex polygons
	 */
	private triangulatePolygon(points: [number, number][]): number[] {
		const indices: number[] = [];
		const n = points.length;

		// For convex polygons, we can use a simple fan triangulation
		for (let i = 1; i < n - 1; i++) {
			indices.push(0, i, i + 1);
		}

		return indices;
	}

	/**
	 * Get the WebGL rendering context
	 */
	public getContext(): WebGLRenderingContext {
		return this.gl;
	}
	
	/**
	 * Get the font atlas for text measurement
	 */
	public getFontAtlas(): FontAtlas | null {
		return this.fontAtlas;
	}

	/**
	 * Enable scissor testing and set the scissor rectangle
	 * @param x Left edge of the scissor box (in pixels from bottom-left)
	 * @param y Bottom edge of the scissor box (in pixels from bottom-left)
	 * @param width Width of the scissor box
	 * @param height Height of the scissor box
	 */
	public enableScissor(x: number, y: number, width: number, height: number): void {
		// Always flush text before changing scissor state
		if (this.textRenderer && this.textRenderer.hasTextToFlush()) {
			this.flushTextBatch();
		}
		
		this.gl.enable(this.gl.SCISSOR_TEST);
		this.gl.scissor(x, y, width, height);
		
		// Notify text renderer of new state
		if (this.textRenderer) {
			this.textRenderer.notifyScissorStateChange(true, x, y, width, height);
		}
	}

	/**
	 * Disable scissor testing
	 */
	public disableScissor(): void {
		// Always flush text before changing scissor state
		if (this.textRenderer && this.textRenderer.hasTextToFlush()) {
			this.flushTextBatch();
		}
		
		this.gl.disable(this.gl.SCISSOR_TEST);
		
		// Notify text renderer of new state
		if (this.textRenderer) {
			this.textRenderer.notifyScissorStateChange(false);
		}
	}

	/**
	 * Check if scissor testing is currently enabled
	 */
	public isScissorEnabled(): boolean {
		return this.gl.isEnabled(this.gl.SCISSOR_TEST);
	}
	
	/**
	 * Clean up WebGL resources
	 */
	public destroy(): void {
		// Remove resize listener
		window.removeEventListener('resize', this.handleResize);
		
		// Delete reusable buffers
		if (this.quadVertexBuffer) {
			this.gl.deleteBuffer(this.quadVertexBuffer);
			this.quadVertexBuffer = null;
		}
		if (this.quadIndexBuffer) {
			this.gl.deleteBuffer(this.quadIndexBuffer);
			this.quadIndexBuffer = null;
		}
		if (this.dynamicVertexBuffer) {
			this.gl.deleteBuffer(this.dynamicVertexBuffer);
			this.dynamicVertexBuffer = null;
		}
		if (this.dynamicIndexBuffer) {
			this.gl.deleteBuffer(this.dynamicIndexBuffer);
			this.dynamicIndexBuffer = null;
		}
		
		// Clean up font atlas
		if (this.fontAtlas) {
			this.fontAtlas = null;
		}
	}
	
	/**
	 * Enable text batching mode
	 * All text drawn after this will be batched until flushTextBatch() is called
	 */
	public beginTextBatch(): void {
		if (this.textRenderer) {
			this.textRenderer.beginBatch();
		}
	}
	
	/**
	 * Disable text batching mode
	 */
	public endTextBatch(): void {
		if (this.textRenderer) {
			this.textRenderer.endBatch();
		}
	}
	
	/**
	 * Flush all batched text in a single draw call
	 */
	public flushTextBatch(): void {
		if (this.textRenderer && this.currentShader) {
			this.textRenderer.flush(
				this.currentShader,
				mat4.create(), // Identity matrix for model
				this.viewMatrix,
				this.projectionMatrix
			);
		}
	}

	/**
	 * Check if there's any text queued to be flushed
	 */
	public hasTextToFlush(): boolean {
		return this.textRenderer ? this.textRenderer.hasTextToFlush() : false;
	}
}
