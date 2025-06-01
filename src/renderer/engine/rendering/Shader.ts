/**
 * Shader class for compiling and using WebGL shaders
 */
export class Shader {
	private gl: WebGLRenderingContext;
	private program: WebGLProgram;

	/**
	 * Create a new shader program from vertex and fragment shader sources
	 * @param gl WebGL rendering context
	 * @param vertexSource GLSL source for vertex shader
	 * @param fragmentSource GLSL source for fragment shader
	 */
	constructor(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
		this.gl = gl;

		// Compile shaders
		const vertexShader = this.compileShader(vertexSource, gl.VERTEX_SHADER);
		const fragmentShader = this.compileShader(fragmentSource, gl.FRAGMENT_SHADER);

		// Create and link program
		this.program = this.createProgram(vertexShader, fragmentShader);

		// Delete shaders after linking
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
	}

	/**
	 * Compile a shader from source
	 * @param source GLSL source code
	 * @param type Shader type (VERTEX_SHADER or FRAGMENT_SHADER)
	 * @returns Compiled shader
	 */
	private compileShader(source: string, type: number): WebGLShader {
		const shader = this.gl.createShader(type);
		if (!shader) {
			throw new Error('Failed to create shader');
		}

		this.gl.shaderSource(shader, source);
		this.gl.compileShader(shader);

		// Check for compilation errors
		if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
			const info = this.gl.getShaderInfoLog(shader);
			this.gl.deleteShader(shader);
			throw new Error(`Could not compile shader: ${info}`);
		}

		return shader;
	}

	/**
	 * Create and link a shader program
	 * @param vertexShader Compiled vertex shader
	 * @param fragmentShader Compiled fragment shader
	 * @returns Linked program
	 */
	private createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram {
		const program = this.gl.createProgram();
		if (!program) {
			throw new Error('Failed to create shader program');
		}

		this.gl.attachShader(program, vertexShader);
		this.gl.attachShader(program, fragmentShader);
		this.gl.linkProgram(program);

		// Check for linking errors
		if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
			const info = this.gl.getProgramInfoLog(program);
			this.gl.deleteProgram(program);
			throw new Error(`Could not link shader program: ${info}`);
		}

		return program;
	}

	/**
	 * Use this shader program for rendering
	 */
	public use(): void {
		this.gl.useProgram(this.program);
	}

	/**
	 * Get the WebGL program
	 */
	public getProgram(): WebGLProgram {
		return this.program;
	}

	/**
	 * Set a uniform float value
	 */
	public setFloat(name: string, value: number): void {
		const location = this.gl.getUniformLocation(this.program, name);
		this.gl.uniform1f(location, value);
	}

	/**
	 * Set a uniform int value
	 */
	public setInt(name: string, value: number): void {
		const location = this.gl.getUniformLocation(this.program, name);
		this.gl.uniform1i(location, value);
	}

	/**
	 * Set a uniform bool value
	 */
	public setBool(name: string, value: boolean): void {
		const location = this.gl.getUniformLocation(this.program, name);
		this.gl.uniform1i(location, value ? 1 : 0);
	}

	/**
	 * Set a uniform vec2 value
	 */
	public setVector2(name: string, x: number, y: number): void {
		const location = this.gl.getUniformLocation(this.program, name);
		this.gl.uniform2f(location, x, y);
	}

	/**
	 * Set a uniform vec3 value
	 */
	public setVector3(name: string, value: [number, number, number]): void {
		const location = this.gl.getUniformLocation(this.program, name);
		this.gl.uniform3f(location, value[0], value[1], value[2]);
	}

	/**
	 * Set a uniform vec4 value
	 */
	public setVector4(name: string, value: [number, number, number, number]): void {
		const location = this.gl.getUniformLocation(this.program, name);
		this.gl.uniform4f(location, value[0], value[1], value[2], value[3]);
	}

	/**
	 * Set a uniform matrix4 value
	 */
	public setMatrix4(name: string, value: Float32Array | number[]): void {
		const location = this.gl.getUniformLocation(this.program, name);
		this.gl.uniformMatrix4fv(location, false, value);
	}
}
