export interface ProgramSources {
	vertex: string;
	fragment: string;
}

/**
 * Compiles and links a GLSL ES 3.00 program, throwing with the driver's log on
 * failure.
 *
 * Status is read here, at creation, and never again (R15.10): a status query
 * is a synchronous round trip through the GPU process, so it belongs to
 * initialisation and to context restore, not to the frame. Attribute locations
 * are fixed in the source with `layout(location = n)`, so nothing asks the
 * program where an attribute went either.
 */
export function compileProgram(gl: WebGL2RenderingContext, { vertex, fragment }: ProgramSources): WebGLProgram {
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertex);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragment);

	const program = gl.createProgram();
	if (!program) throw new Error('Failed to create shader program');
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const info = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`Could not link shader program: ${info}`);
	}
	return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Failed to create shader');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const info = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Could not compile shader: ${info}`);
	}
	return shader;
}
