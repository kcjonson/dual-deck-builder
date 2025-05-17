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
    
    // Update projection matrix
    const aspectRatio = this.canvas.width / this.canvas.height;
    mat4.ortho(
      this.projectionMatrix,
      -aspectRatio, // left
      aspectRatio,  // right
      -1.0,         // bottom
      1.0,          // top
      -1.0,         // near
      1.0           // far
    );
  }

  /**
   * Clear the canvas with the current clear color
   */
  public clear(): void {
    console.log('Renderer: Clearing canvas');
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
   * Draw a rectangle on the screen
   */
  public drawRectangle(
    x: number, 
    y: number, 
    width: number, 
    height: number, 
    color: [number, number, number, number] = [1, 1, 1, 1]
  ): void {
    if (!this.currentShader) {
      console.error('No shader selected');
      return;
    }

    // Create a model matrix for this rectangle
    const modelMatrix = mat4.create();
    mat4.translate(modelMatrix, modelMatrix, [x, y, 0]);
    mat4.scale(modelMatrix, modelMatrix, [width / 2, height / 2, 1]);

    this.currentShader.setMatrix4('uModelMatrix', modelMatrix);
    this.currentShader.setVector4('uColor', color);

    // Create rectangle vertices
    const vertices = new Float32Array([
      -1.0, -1.0,  // Bottom left
       1.0, -1.0,  // Bottom right
       1.0,  1.0,  // Top right
      -1.0,  1.0   // Top left
    ]);

    // Create indices for drawing as triangles
    const indices = new Uint16Array([
      0, 1, 2,  // First triangle
      0, 2, 3   // Second triangle
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
    lineWidth: number = 1
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
    mat4.translate(modelMatrix, modelMatrix, [startX, startY, 0]);
    mat4.rotateZ(modelMatrix, modelMatrix, angle);
    mat4.scale(modelMatrix, modelMatrix, [length / 2, lineWidth / 2, 1]);

    this.currentShader.setMatrix4('uModelMatrix', modelMatrix);
    this.currentShader.setVector4('uColor', color);

    // Create line vertices as a rectangle
    const vertices = new Float32Array([
      0.0, -1.0,    // Bottom left
      1.0, -1.0,    // Bottom right
      1.0,  1.0,    // Top right
      0.0,  1.0     // Top left
    ]);

    // Create indices
    const indices = new Uint16Array([
      0, 1, 2,  // First triangle
      0, 2, 3   // Second triangle
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
   * Draw text on the screen (basic implementation - for complex text, you'd use texture fonts)
   */
  public drawText(
    text: string, 
    x: number, 
    y: number, 
    color: [number, number, number, number] = [1, 1, 1, 1],
    fontSize: number = 16
  ): void {
    // For now, use HTML Canvas API to draw text
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    
    ctx.font = `${fontSize}px Arial`;
    const textWidth = ctx.measureText(text).width;
    
    // Create a texture from the text
    const textCanvas = document.createElement('canvas');
    textCanvas.width = textWidth;
    textCanvas.height = fontSize * 1.5;
    
    const textCtx = textCanvas.getContext('2d');
    if (!textCtx) return;
    
    textCtx.font = `${fontSize}px Arial`;
    textCtx.fillStyle = `rgba(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255}, ${color[3]})`;
    textCtx.fillText(text, 0, fontSize);
    
    // Create texture from the canvas
    const texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      textCanvas
    );
    
    // Set texture parameters
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    
    // Draw as a textured rectangle
    // Implementation would use a textured quad shader
    // For now, this is a placeholder - you would need to implement a textured shader
    console.log('Text rendering not fully implemented');
    
    // Clean up
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.gl.deleteTexture(texture);
  }

  /**
   * Get the WebGL rendering context
   */
  public getContext(): WebGLRenderingContext {
    return this.gl;
  }
}
