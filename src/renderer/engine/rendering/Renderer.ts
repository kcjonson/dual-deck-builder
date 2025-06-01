import { mat4 } from 'gl-matrix';
import { Shader } from './Shader';

/**
 * Main WebGL renderer class that abstracts WebGL operations
 */
export class Renderer {
	private canvas: HTMLCanvasElement;
	private gl: WebGLRenderingContext;
	private currentShader: Shader | null = null;
	private projectionMatrix: mat4;
	private viewMatrix: mat4;
	private ctx2d: CanvasRenderingContext2D | null = null;

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
		this.clear2DCanvas(); // Also clear the 2D canvas used for text
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
	 * Draw a rectangle on the screen
	 */
	public drawRectangle(
		x: number,
		y: number,
		width: number,
		height: number,
		color: [number, number, number, number] = [1, 1, 1, 1],
	): void {
		if (!this.currentShader) {
			console.error('No shader selected');
			return;
		}

		// Center the rectangle at the correct position
		// In pixel coordinates, we want the x,y to be the top-left corner
		const centerX = x + width / 2;
		const centerY = y + height / 2;

		// Create a model matrix for this rectangle
		const modelMatrix = mat4.create();
		mat4.translate(modelMatrix, modelMatrix, [centerX, centerY, 0]);
		mat4.scale(modelMatrix, modelMatrix, [width / 2, height / 2, 1]);

		this.currentShader.setMatrix4('uModelMatrix', modelMatrix);
		this.currentShader.setVector4('uColor', color);

		// Create rectangle vertices (1x1 quad from -1 to 1 in NDC)
		const vertices = new Float32Array([
			-1.0,
			-1.0, // Bottom left
			1.0,
			-1.0, // Bottom right
			1.0,
			1.0, // Top right
			-1.0,
			1.0, // Top left
		]);

		// Create indices for drawing as triangles
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

		// Draw the rectangle
		this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);

		// Clean up
		this.gl.disableVertexAttribArray(positionAttribLocation);
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
		this.gl.deleteBuffer(vertexBuffer);
		this.gl.deleteBuffer(indexBuffer);
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
	 * Draw text on the screen using HTML Canvas API as a fallback
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
		// Create a 2D context if we don't already have one
		if (!this.ctx2d) {
			// Create a 2D canvas overlay for text rendering
			const canvas2d = document.createElement('canvas');
			canvas2d.style.position = 'absolute';
			canvas2d.style.left = '0';
			canvas2d.style.top = '0';
			canvas2d.style.pointerEvents = 'none'; // Make it non-interactive
			canvas2d.width = window.innerWidth;
			canvas2d.height = window.innerHeight;

			// Get the WebGL canvas and insert our 2D canvas right after it
			const webglCanvas = this.canvas;
			if (webglCanvas.parentNode) {
				webglCanvas.parentNode.insertBefore(canvas2d, webglCanvas.nextSibling);
			} else {
				document.body.appendChild(canvas2d);
			}

			// Store the context
			this.ctx2d = canvas2d.getContext('2d');

			// Resize the 2D canvas when window resizes
			window.addEventListener('resize', () => {
				if (this.ctx2d) {
					const canvas = this.ctx2d.canvas;
					canvas.width = window.innerWidth;
					canvas.height = window.innerHeight;
				}
			});
		}

		if (!this.ctx2d) return;

		// Set up the text styling
		this.ctx2d.font = `${fontSize}px Arial`;
		this.ctx2d.fillStyle = `rgba(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255}, ${
			color[3]
		})`;
		this.ctx2d.textAlign = align;
		this.ctx2d.textBaseline = baseline;

		// Draw the text with proper alignment
		this.ctx2d.fillText(text, x, y);
	}

	/**
	 * Clear the 2D canvas used for text rendering
	 * This should be called at the beginning of each frame
	 */
	private clear2DCanvas(): void {
		if (this.ctx2d) {
			this.ctx2d.clearRect(0, 0, this.ctx2d.canvas.width, this.ctx2d.canvas.height);
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
}
