import { mat4 } from 'gl-matrix';
import { Shader } from './Shader';
import { FontAtlas } from './FontAtlas';

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

	constructor(canvasId: string) {
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
		window.addEventListener('resize', () => this.resize());

		// Set default WebGL state
		this.gl.enable(this.gl.BLEND);
		this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
		this.gl.clearColor(0.0, 0.0, 0.0, 1.0);

		// Initialize font atlas
		this.fontAtlas = new FontAtlas(this.gl);
	}

	/**
	 * Resize canvas and viewport when window size changes
	 */
	private resize(): void {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

		// Update projection matrix - use pixel coordinates directly
		mat4.ortho(
			this.projectionMatrix,
			0, // left
			this.canvas.width, // right
			this.canvas.height, // bottom (flipped for screen coordinates)
			0, // top
			-1.0, // near
			1.0, // far
		);
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
		texCoords?: number[]
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

		// Set texture usage
		if (texture && texCoords) {
			this.currentShader.setBool('uUseTexture', true);
			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
			this.currentShader.setInt('uTexture', 0);
		} else {
			this.currentShader.setBool('uUseTexture', false);
		}

		// Create vertices with position and texture coordinates
		// Order: bottom-left, bottom-right, top-right, top-left (matching indices)
		const vertices = new Float32Array([
			// Position    // TexCoord
			-1.0, -1.0,    texCoords?.[0] ?? 0.0, texCoords?.[1] ?? 0.0, // Bottom left
			 1.0, -1.0,    texCoords?.[2] ?? 1.0, texCoords?.[3] ?? 0.0, // Bottom right
			 1.0,  1.0,    texCoords?.[4] ?? 1.0, texCoords?.[5] ?? 1.0, // Top right
			-1.0,  1.0,    texCoords?.[6] ?? 0.0, texCoords?.[7] ?? 1.0, // Top left
		]);

		// Create indices
		const indices = new Uint16Array([
			0, 1, 2, // First triangle
			0, 2, 3, // Second triangle
		]);

		// Create and bind vertex buffer
		const vertexBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

		// Create and bind index buffer
		const indexBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indices, this.gl.STATIC_DRAW);

		// Set up vertex attributes
		const positionAttribLocation = this.gl.getAttribLocation(this.currentShader.getProgram(), 'aPosition');
		const texCoordAttribLocation = this.gl.getAttribLocation(this.currentShader.getProgram(), 'aTexCoord');

		// Position attribute (2 floats starting at offset 0)
		if (positionAttribLocation >= 0) {
			this.gl.enableVertexAttribArray(positionAttribLocation);
			this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 16, 0);
		}

		// Texture coordinate attribute (2 floats starting at offset 8 bytes)
		if (texCoordAttribLocation >= 0) {
			this.gl.enableVertexAttribArray(texCoordAttribLocation);
			this.gl.vertexAttribPointer(texCoordAttribLocation, 2, this.gl.FLOAT, false, 16, 8);
		}

		// Draw the quad
		this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

		// Clean up
		if (positionAttribLocation >= 0) {
			this.gl.disableVertexAttribArray(positionAttribLocation);
		}
		if (texCoordAttribLocation >= 0) {
			this.gl.disableVertexAttribArray(texCoordAttribLocation);
		}
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
		this.gl.deleteBuffer(vertexBuffer);
		this.gl.deleteBuffer(indexBuffer);

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
	): void {
		this.drawQuad(x, y, width, height, color);
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

		// Create line vertices as a rectangle
		const vertices = new Float32Array([
			0.0,
			-1.0, // Bottom left
			1.0,
			-1.0, // Bottom right
			1.0,
			1.0, // Top right
			0.0,
			1.0, // Top left
		]);

		// Create indices
		const indices = new Uint16Array([
			0,
			1,
			2, // First triangle
			0,
			2,
			3, // Second triangle
		]);

		// Create and bind vertex buffer
		const vertexBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

		// Create and bind index buffer
		const indexBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indices, this.gl.STATIC_DRAW);

		// Set up vertex attributes
		const positionAttribLocation = this.gl.getAttribLocation(
			this.currentShader.getProgram(),
			'aPosition',
		);
		this.gl.enableVertexAttribArray(positionAttribLocation);
		this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 0, 0);

		// Draw the line
		this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

		// Clean up
		this.gl.disableVertexAttribArray(positionAttribLocation);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
		this.gl.deleteBuffer(vertexBuffer);
		this.gl.deleteBuffer(indexBuffer);
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

		// Get font atlas texture
		const texture = this.fontAtlas.getTexture();
		if (!texture) {
			console.warn('Font atlas texture not available');
			return;
		}

		// Render each character
		let currentX = startX;
		for (let i = 0; i < text.length; i++) {
			const char = text[i];
			const charInfo = this.fontAtlas.getCharacter(char);
			
			if (!charInfo) {
				// Skip unknown characters
				continue;
			}

			// Calculate character dimensions using atlas dimensions
			const atlasSize = this.fontAtlas.getAtlasSize();
			const charPixelWidth = charInfo.width * atlasSize;
			const charPixelHeight = charInfo.height * atlasSize;
			const charWidth = charPixelWidth * scale;
			const charHeight = charPixelHeight * scale;

			// Texture coordinates from font atlas (normalized 0-1)
			const u1 = charInfo.x;
			const v1 = charInfo.y;
			const u2 = charInfo.x + charInfo.width;
			const v2 = charInfo.y + charInfo.height;
			
			
			// Map atlas coordinates to quad vertices - flip Y to fix upside down
			const texCoords = [
				u1, v1, // Bottom left vertex (was v2, now v1 to flip)
				u2, v1, // Bottom right vertex (was v2, now v1 to flip)
				u2, v2, // Top right vertex (was v1, now v2 to flip)
				u1, v2, // Top left vertex (was v1, now v2 to flip)
			];

			// Draw the character quad
			this.drawQuad(
				currentX + charInfo.offsetX * scale,
				startY + charInfo.offsetY * scale,
				charWidth,
				charHeight,
				color,
				texture,
				texCoords
			);

			// Advance to next character position
			currentX += charInfo.advance * scale;
		}
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

		// Create and bind vertex buffer
		const vertexBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);

		// Create and bind index buffer
		const indexBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), this.gl.STATIC_DRAW);

		// Set up vertex attributes
		const positionAttribLocation = this.gl.getAttribLocation(
			this.currentShader.getProgram(),
			'aPosition',
		);
		this.gl.enableVertexAttribArray(positionAttribLocation);
		this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 0, 0);

		// Draw the filled circle
		this.gl.drawElements(this.gl.TRIANGLES, indices.length, this.gl.UNSIGNED_SHORT, 0);

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
			this.gl.lineWidth(strokeWidth);
			this.gl.drawArrays(this.gl.LINE_STRIP, 0, outlineVertices.length / 2);
		}

		// Clean up
		this.gl.disableVertexAttribArray(positionAttribLocation);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
		this.gl.deleteBuffer(vertexBuffer);
		this.gl.deleteBuffer(indexBuffer);
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

		// Create and bind vertex buffer
		const vertexBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

		// Create and bind index buffer
		const indexBuffer = this.gl.createBuffer();
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indices, this.gl.STATIC_DRAW);

		// Set up vertex attributes
		const positionAttribLocation = this.gl.getAttribLocation(
			this.currentShader.getProgram(),
			'aPosition',
		);
		this.gl.enableVertexAttribArray(positionAttribLocation);
		this.gl.vertexAttribPointer(positionAttribLocation, 2, this.gl.FLOAT, false, 0, 0);

		// Draw the filled triangle
		this.gl.drawElements(this.gl.TRIANGLES, 3, this.gl.UNSIGNED_SHORT, 0);

		// Draw stroke if needed
		if (strokeWidth > 0) {
			this.currentShader.setVector4('uColor', strokeColor);
			this.gl.lineWidth(strokeWidth);
			this.gl.drawArrays(this.gl.LINE_LOOP, 0, 3);
		}

		// Clean up
		this.gl.disableVertexAttribArray(positionAttribLocation);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
		this.gl.deleteBuffer(vertexBuffer);
		this.gl.deleteBuffer(indexBuffer);
	}

	/**
	 * Get the WebGL rendering context
	 */
	public getContext(): WebGLRenderingContext {
		return this.gl;
	}

	/**
	 * Enable scissor testing and set the scissor rectangle
	 * @param x Left edge of the scissor box (in pixels from bottom-left)
	 * @param y Bottom edge of the scissor box (in pixels from bottom-left)
	 * @param width Width of the scissor box
	 * @param height Height of the scissor box
	 */
	public enableScissor(x: number, y: number, width: number, height: number): void {
		this.gl.enable(this.gl.SCISSOR_TEST);
		this.gl.scissor(x, y, width, height);
	}

	/**
	 * Disable scissor testing
	 */
	public disableScissor(): void {
		this.gl.disable(this.gl.SCISSOR_TEST);
	}

	/**
	 * Check if scissor testing is currently enabled
	 */
	public isScissorEnabled(): boolean {
		return this.gl.isEnabled(this.gl.SCISSOR_TEST);
	}
}
