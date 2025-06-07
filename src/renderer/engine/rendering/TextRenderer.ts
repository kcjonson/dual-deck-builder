import { FontAtlas } from './FontAtlas';
import { Shader } from './Shader';
import { PerformanceMonitor } from './PerformanceMonitor';
import { mat4 } from 'gl-matrix';

/**
 * Represents a single text entry in the batch
 */
interface TextEntry {
	text: string;
	x: number;
	y: number;
	color: [number, number, number, number];
	fontSize: number;
}

/**
 * TextRenderer handles both immediate and batched text rendering
 * Batched mode dramatically reduces draw calls from one-per-character to one-per-frame
 */
export class TextRenderer {
	private gl: WebGLRenderingContext;
	private fontAtlas: FontAtlas;
	private performanceMonitor: PerformanceMonitor;
	
	// Batch mode properties
	private batchMode = false;
	private vertexBuffer: WebGLBuffer | null = null;
	private indexBuffer: WebGLBuffer | null = null;
	private maxCharacters: number;
	private vertexData: Float32Array | null = null;
	private indexData: Uint16Array | null = null;
	private currentVertex = 0;
	private characterCount = 0;
	// Group entries by color to minimize shader uniform changes
	private entriesByColor: Map<string, TextEntry[]> = new Map();
	
	/**
	 * Create a new text renderer
	 * @param gl WebGL context
	 * @param fontAtlas Font atlas for character data
	 * @param performanceMonitor Performance tracking
	 * @param maxCharacters Maximum characters to batch (default 10000)
	 */
	constructor(
		gl: WebGLRenderingContext,
		fontAtlas: FontAtlas,
		performanceMonitor: PerformanceMonitor,
		maxCharacters = 10000
	) {
		this.gl = gl;
		this.fontAtlas = fontAtlas;
		this.performanceMonitor = performanceMonitor;
		this.maxCharacters = maxCharacters;
	}
	
	/**
	 * Enable batch mode - must call flush() to render
	 */
	public beginBatch(): void {
		if (this.batchMode) return;
		
		this.batchMode = true;
		
		// Initialize batch buffers if not already created
		if (!this.vertexBuffer) {
			this.initializeBatchBuffers();
		}
		
		this.clear();
	}
	
	/**
	 * Disable batch mode - return to immediate rendering
	 */
	public endBatch(): void {
		this.batchMode = false;
	}
	
	/**
	 * Initialize buffers for batch rendering
	 */
	private initializeBatchBuffers(): void {
		// Create vertex buffer
		// Each character needs 4 vertices, each vertex has position (2) + texCoord (2) = 4 floats
		const vertexSize = 4; // x, y, u, v
		const verticesPerChar = 4;
		this.vertexData = new Float32Array(this.maxCharacters * verticesPerChar * vertexSize);
		
		const buffer = this.gl.createBuffer();
		if (!buffer) throw new Error('Failed to create vertex buffer');
		this.vertexBuffer = buffer;
		
		// Create index buffer
		// Each character needs 6 indices (2 triangles)
		this.indexData = new Uint16Array(this.maxCharacters * 6);
		
		const indexBuffer = this.gl.createBuffer();
		if (!indexBuffer) throw new Error('Failed to create index buffer');
		this.indexBuffer = indexBuffer;
		
		// Pre-fill index buffer with quad patterns
		for (let i = 0; i < this.maxCharacters; i++) {
			const baseVertex = i * 4;
			const baseIndex = i * 6;
			
			// Triangle 1: 0, 1, 2
			this.indexData[baseIndex + 0] = baseVertex + 0;
			this.indexData[baseIndex + 1] = baseVertex + 1;
			this.indexData[baseIndex + 2] = baseVertex + 2;
			
			// Triangle 2: 0, 2, 3
			this.indexData[baseIndex + 3] = baseVertex + 0;
			this.indexData[baseIndex + 4] = baseVertex + 2;
			this.indexData[baseIndex + 5] = baseVertex + 3;
		}
		
		// Upload index data once (it never changes)
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, this.indexData, this.gl.STATIC_DRAW);
	}
	
	/**
	 * Draw text (immediate or batched depending on mode)
	 * @param shader Current shader
	 * @param text Text to render
	 * @param x X position
	 * @param y Y position
	 * @param color Text color
	 * @param fontSize Font size
	 */
	public drawText(
		shader: Shader,
		text: string,
		x: number,
		y: number,
		color: [number, number, number, number] = [1, 1, 1, 1],
		fontSize = 16
	): void {
		// Track text characters
		this.performanceMonitor.recordTextCharacters(text.length);
		
		if (this.batchMode) {
			// Add to batch, grouped by color
			const colorKey = color.join(',');
			if (!this.entriesByColor.has(colorKey)) {
				this.entriesByColor.set(colorKey, []);
			}
			this.entriesByColor.get(colorKey)!.push({ text, x, y, color, fontSize });
		} else {
			// Immediate mode - render each character now
			this.drawTextImmediate(shader, text, x, y, color, fontSize);
		}
	}
	
	/**
	 * Immediate mode text rendering (current implementation)
	 */
	private drawTextImmediate(
		shader: Shader,
		text: string,
		x: number,
		y: number,
		color: [number, number, number, number],
		fontSize: number
	): void {
		// Calculate scale from font size
		const baseSize = this.fontAtlas.getFontSize();
		const scale = fontSize / baseSize;
		
		// Get font atlas texture
		const texture = this.fontAtlas.getTexture();
		if (!texture) {
			console.warn('Font atlas texture not available');
			return;
		}
		
		// Render each character
		let currentX = x;
		const atlasSize = this.fontAtlas.getAtlasSize();
		
		for (let i = 0; i < text.length; i++) {
			const char = text[i];
			const charInfo = this.fontAtlas.getCharacter(char);
			
			if (!charInfo) continue;
			
			// Calculate character dimensions
			const charPixelWidth = charInfo.width * atlasSize;
			const charPixelHeight = charInfo.height * atlasSize;
			const charWidth = charPixelWidth * scale;
			const charHeight = charPixelHeight * scale;
			
			// Texture coordinates
			const u1 = charInfo.x;
			const v1 = charInfo.y;
			const u2 = charInfo.x + charInfo.width;
			const v2 = charInfo.y + charInfo.height;
			
			// Map atlas coordinates to quad vertices (with Y flipped)
			const texCoords = [
				u1, v2, // Bottom left (v2 for bottom)
				u2, v2, // Bottom right (v2 for bottom)
				u2, v1, // Top right (v1 for top)
				u1, v1, // Top left (v1 for top)
			];
			
			// Calculate position
			const pixelX = Math.round(currentX + charInfo.offsetX * scale);
			const pixelY = Math.round(y + charInfo.offsetY * scale);
			
			// Draw character using existing drawQuad method
			this.drawQuad(
				shader,
				pixelX,
				pixelY,
				charWidth,
				charHeight,
				color,
				texture,
				texCoords
			);
			
			// Advance to next character
			currentX += charInfo.advance * scale;
		}
	}
	
	/**
	 * Draw a single quad (used by immediate mode)
	 * This is a simplified version of Renderer.drawQuad
	 */
	private drawQuad(
		shader: Shader,
		x: number,
		y: number,
		width: number,
		height: number,
		color: [number, number, number, number],
		texture: WebGLTexture,
		texCoords: number[]
	): void {
		// Create model matrix
		const modelMatrix = mat4.create();
		mat4.translate(modelMatrix, modelMatrix, [x + width / 2, y + height / 2, 0]);
		mat4.scale(modelMatrix, modelMatrix, [width / 2, height / 2, 1]);
		
		shader.setMatrix4('uModelMatrix', modelMatrix);
		shader.setVector4('uColor', color);
		shader.setBool('uUseTexture', true);
		shader.setFloat('uStrokeWidth', 0);
		
		// Bind texture
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		shader.setInt('uTexture', 0);
		
		// Create vertices with custom texture coordinates
		const vertices = new Float32Array([
			// Position    // TexCoord
			-1.0, -1.0,    texCoords[0], texCoords[1], // Bottom left
			 1.0, -1.0,    texCoords[2], texCoords[3], // Bottom right
			 1.0,  1.0,    texCoords[4], texCoords[5], // Top right
			-1.0,  1.0,    texCoords[6], texCoords[7], // Top left
		]);
		
		// Create separate buffers for immediate mode if needed
		let immediateVertexBuffer = this.gl.createBuffer();
		if (!immediateVertexBuffer) throw new Error('Failed to create immediate vertex buffer');
		
		let immediateIndexBuffer = this.gl.createBuffer();
		if (!immediateIndexBuffer) throw new Error('Failed to create immediate index buffer');
		
		// Upload indices once
		const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, immediateIndexBuffer);
		this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indices, this.gl.STATIC_DRAW);
		
		// Update vertex data
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, immediateVertexBuffer);
		this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.DYNAMIC_DRAW);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, immediateIndexBuffer);
		
		// Set up attributes
		const positionAttrib = this.gl.getAttribLocation(shader.getProgram(), 'aPosition');
		const texCoordAttrib = this.gl.getAttribLocation(shader.getProgram(), 'aTexCoord');
		
		if (positionAttrib >= 0) {
			this.gl.enableVertexAttribArray(positionAttrib);
			this.gl.vertexAttribPointer(positionAttrib, 2, this.gl.FLOAT, false, 16, 0);
		}
		
		if (texCoordAttrib >= 0) {
			this.gl.enableVertexAttribArray(texCoordAttrib);
			this.gl.vertexAttribPointer(texCoordAttrib, 2, this.gl.FLOAT, false, 16, 8);
		}
		
		// Draw
		this.gl.drawElements(this.gl.TRIANGLES, 6, this.gl.UNSIGNED_SHORT, 0);
		this.performanceMonitor.recordDrawCall(4);
		
		// Clean up
		if (positionAttrib >= 0) {
			this.gl.disableVertexAttribArray(positionAttrib);
		}
		if (texCoordAttrib >= 0) {
			this.gl.disableVertexAttribArray(texCoordAttrib);
		}
		
		// Delete immediate mode buffers
		this.gl.deleteBuffer(immediateVertexBuffer);
		this.gl.deleteBuffer(immediateIndexBuffer);
	}
	
	/**
	 * Build the vertex buffer for a specific color group
	 * @param entries Text entries with the same color
	 * @param startVertex Starting vertex index in the buffer
	 * @returns Number of characters added
	 */
	private buildVertexBufferForColor(entries: TextEntry[], startVertex: number): number {
		if (!this.vertexData) return 0;
		
		let vertexIndex = startVertex;
		let charCount = 0;
		const atlasSize = this.fontAtlas.getAtlasSize();
		
		for (const entry of entries) {
			const { text, x, y, fontSize } = entry;
			
			// Calculate scale from font size
			const baseSize = this.fontAtlas.getFontSize();
			const scale = fontSize / baseSize;
			
			// Render each character
			let currentX = x;
			for (let i = 0; i < text.length; i++) {
				const char = text[i];
				const charInfo = this.fontAtlas.getCharacter(char);
				
				if (!charInfo) continue;
				
				// Skip if we've reached max characters
				if (vertexIndex / 16 >= this.maxCharacters) {
					console.warn('TextRenderer: Max characters reached');
					return charCount;
				}
				
				// Calculate character dimensions
				const charPixelWidth = charInfo.width * atlasSize;
				const charPixelHeight = charInfo.height * atlasSize;
				const charWidth = charPixelWidth * scale;
				const charHeight = charPixelHeight * scale;
				
				// Calculate position
				const pixelX = Math.round(currentX + charInfo.offsetX * scale);
				const pixelY = Math.round(y + charInfo.offsetY * scale);
				
				// Texture coordinates
				const u1 = charInfo.x;
				const v1 = charInfo.y;
				const u2 = charInfo.x + charInfo.width;
				const v2 = charInfo.y + charInfo.height;
				
				// Add vertices for this character (4 vertices, each with x,y,u,v)
				const baseIndex = vertexIndex;
				
				// Bottom left
				this.vertexData[baseIndex + 0] = pixelX;
				this.vertexData[baseIndex + 1] = pixelY + charHeight;
				this.vertexData[baseIndex + 2] = u1;
				this.vertexData[baseIndex + 3] = v2; // Flipped: use v2 for bottom
				
				// Bottom right
				this.vertexData[baseIndex + 4] = pixelX + charWidth;
				this.vertexData[baseIndex + 5] = pixelY + charHeight;
				this.vertexData[baseIndex + 6] = u2;
				this.vertexData[baseIndex + 7] = v2; // Flipped: use v2 for bottom
				
				// Top right
				this.vertexData[baseIndex + 8] = pixelX + charWidth;
				this.vertexData[baseIndex + 9] = pixelY;
				this.vertexData[baseIndex + 10] = u2;
				this.vertexData[baseIndex + 11] = v1; // Flipped: use v1 for top
				
				// Top left
				this.vertexData[baseIndex + 12] = pixelX;
				this.vertexData[baseIndex + 13] = pixelY;
				this.vertexData[baseIndex + 14] = u1;
				this.vertexData[baseIndex + 15] = v1; // Flipped: use v1 for top
				
				vertexIndex += 16; // 4 vertices * 4 components each
				charCount++;
				
				// Advance to next character position
				currentX += charInfo.advance * scale;
			}
		}
		
		return charCount;
	}
	
	/**
	 * Execute the batch - render all accumulated text in one draw call
	 * @param shader Shader to use
	 * @param modelMatrix Model matrix for positioning
	 * @param viewMatrix View matrix
	 * @param projectionMatrix Projection matrix
	 */
	public flush(
		shader: Shader,
		modelMatrix: Float32Array | number[],
		viewMatrix: Float32Array | number[],
		projectionMatrix: Float32Array | number[]
	): void {
		if (!this.batchMode || this.entriesByColor.size === 0) return;
		if (!this.vertexBuffer || !this.indexBuffer || !this.vertexData) return;
		
		// Use the shader
		shader.use();
		
		// Set matrices
		shader.setMatrix4('uModelMatrix', modelMatrix);
		shader.setMatrix4('uViewMatrix', viewMatrix);
		shader.setMatrix4('uProjectionMatrix', projectionMatrix);
		
		// Set texture uniforms
		shader.setBool('uUseTexture', true);
		shader.setFloat('uStrokeWidth', 0); // No stroke for text
		
		// Bind font atlas texture
		const texture = this.fontAtlas.getTexture();
		if (!texture) {
			console.warn('Font atlas texture not available');
			return;
		}
		
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		shader.setInt('uTexture', 0);
		
		// Bind buffers
		this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
		this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
		
		// Pre-allocate vertex buffer
		this.gl.bufferData(this.gl.ARRAY_BUFFER, this.maxCharacters * 16 * 4, this.gl.DYNAMIC_DRAW);
		
		// Set up vertex attributes
		const stride = 16; // 4 floats per vertex (x, y, u, v)
		const positionAttrib = this.gl.getAttribLocation(shader.getProgram(), 'aPosition');
		const texCoordAttrib = this.gl.getAttribLocation(shader.getProgram(), 'aTexCoord');
		
		if (positionAttrib >= 0) {
			this.gl.enableVertexAttribArray(positionAttrib);
			this.gl.vertexAttribPointer(positionAttrib, 2, this.gl.FLOAT, false, stride, 0);
		}
		
		if (texCoordAttrib >= 0) {
			this.gl.enableVertexAttribArray(texCoordAttrib);
			this.gl.vertexAttribPointer(texCoordAttrib, 2, this.gl.FLOAT, false, stride, 8);
		}
		
		// Render each color group separately
		let totalDrawCalls = 0;
		let totalVertices = 0;
		
		for (const [colorKey, entries] of this.entriesByColor) {
			if (entries.length === 0) continue;
			
			// Parse color from key
			const color = colorKey.split(',').map(parseFloat) as [number, number, number, number];
			
			// Build vertex buffer for this color group
			this.currentVertex = 0;
			const charCount = this.buildVertexBufferForColor(entries, 0);
			
			if (charCount === 0) continue;
			
			// Set color uniform for this batch
			shader.setVector4('uColor', color);
			
			// Upload vertex data for this color group
			this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.vertexData.subarray(0, charCount * 16));
			
			// Draw all characters of this color
			const indexCount = charCount * 6; // 6 indices per character
			this.gl.drawElements(this.gl.TRIANGLES, indexCount, this.gl.UNSIGNED_SHORT, 0);
			
			totalDrawCalls++;
			totalVertices += charCount * 4; // 4 vertices per character
		}
		
		// Record draw calls (one per color group)
		for (let i = 0; i < totalDrawCalls; i++) {
			this.performanceMonitor.recordDrawCall(totalVertices / totalDrawCalls);
		}
		
		// Clean up
		if (positionAttrib >= 0) {
			this.gl.disableVertexAttribArray(positionAttrib);
		}
		if (texCoordAttrib >= 0) {
			this.gl.disableVertexAttribArray(texCoordAttrib);
		}
		
		// Clear for next frame
		this.clear();
	}
	
	/**
	 * Clear the batch for the next frame
	 */
	public clear(): void {
		this.entriesByColor.clear();
		this.currentVertex = 0;
		this.characterCount = 0;
	}
}